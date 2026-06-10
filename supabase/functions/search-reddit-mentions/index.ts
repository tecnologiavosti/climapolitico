// Edge function: coleta manual de menções do Reddit para 1 candidato.
// Fontes: PullPush (global + 9 subreddits BR) + Arctic Shift (histórico 90d).
// Reddit oficial bloqueia IPs de cloud.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enrichRecordLocation } from "../_shared/infer-location.ts";
import { newPipelineRecorder } from "../_shared/pipeline-metrics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PULLPUSH_BASE = "https://api.pullpush.io/reddit/search";
const ARCTIC_SHIFT_BASE = "https://arctic-shift.photon-reddit.com/api";

const BR_SUBREDDITS = [
  // Política geral
  "brasil", "brasilivre", "BrasilSimulator", "AgendaBrasil", "politica", "lutabrasileira",
  "BrasildoB", "noticias", "InternetBrasil", "investimentos",
  "PoliticaBrasil", "CongressoNacional", "EleicoesBrasil",
  // Direita / Conservadores
  "conservadores", "Bolsonaro", "DireitaBrasileira", "LiberalismoBR",
  "PartidoNovoOficial", "BrazilianConservatives",
  // Esquerda / Progressistas
  "esquerda", "PTBrasil", "PSOLoficial", "Lula", "EsquerdaBR",
  // Regionais (capitais e estados)
  "saopaulo", "riodejaneiro", "minasgerais", "bahia", "ceara", "pernambuco",
  "parana", "riograndedosul", "brasilia", "nordeste",
  "amazonas", "para", "santacatarina", "goias", "espiritosanto",
  "maranhao", "piaui", "alagoas", "sergipe",
  "Florianopolis", "PortoAlegre", "BeloHorizonte", "Salvador",
  "Curitiba", "Recife", "Fortaleza",
  // Temáticos
  "economy_brazil", "direito", "jornalismo", "upheaval",
  "EconomiaBrasil", "DireitoBrasil",
];

function semanticMatch(text: string, fullName: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  if (parts.length >= 2) {
    return t.includes(`${parts[0]} ${parts[parts.length - 1]}`) || t.includes(norm(fullName));
  }
  return t.includes(parts[0]);
}

// ===== L2.b: fallback Reddit oficial (.json + .rss) com retry exponencial =====
const USER_AGENTS = [
  "ClimaPolitico/1.0 (by /u/clima_politico)",
  "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0; +https://climapolitico.com.br)",
  "ClimaPolitico-Monitor/1.1 (research)",
];
const RETRY_BACKOFFS_MS = [1000, 3000, 9000];

async function fetchWithRetry(url: string, timeoutMs = 15000): Promise<Response | null> {
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          "Accept": "application/json, application/rss+xml, */*",
          "User-Agent": USER_AGENTS[attempt % USER_AGENTS.length],
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) return r;
      lastErr = `HTTP ${r.status}`;
      if (r.status !== 429 && r.status !== 503) return null;
    } catch (e) {
      lastErr = (e as Error).message;
      if (!lastErr.toLowerCase().includes("timeout") && !lastErr.toLowerCase().includes("timed out")) return null;
    }
    if (attempt < RETRY_BACKOFFS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFFS_MS[attempt] + Math.floor(Math.random() * 500)));
    }
  }
  console.warn(`[REDDIT] fetchWithRetry esgotado: ${url} → ${lastErr}`);
  return null;
}

async function fetchPullPush(
  kind: "submission" | "comment",
  query: string,
  size = 50,
  subreddit?: string,
): Promise<any[]> {
  const params = new URLSearchParams({
    q: query, size: String(size), sort: "desc", sort_type: "created_utc",
  });
  if (subreddit) params.set("subreddit", subreddit);
  const url = `${PULLPUSH_BASE}/${kind}/?${params.toString()}`;
  const res = await fetchWithRetry(url, 20000);
  if (!res) return [];
  try {
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } catch { return []; }
}

async function fetchArcticShift(kind: "posts" | "comments", query: string): Promise<any[]> {
  const after = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
  const url = `${ARCTIC_SHIFT_BASE}/${kind}/search?q=${encodeURIComponent(query)}&limit=200&after=${after}`;
  const res = await fetchWithRetry(url, 25000);
  if (!res) return [];
  try {
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } catch { return []; }
}

// Fallback: Reddit oficial via .json (sem OAuth)
async function fetchRedditJson(subreddit: string, query: string): Promise<any[]> {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=new&limit=100&t=month`;
  const res = await fetchWithRetry(url, 15000);
  if (!res) return [];
  try {
    const json = await res.json();
    const children = json?.data?.children;
    if (!Array.isArray(children)) return [];
    return children.map((c: any) => c?.data).filter(Boolean);
  } catch { return []; }
}

// Fallback adicional: novos posts via .json do feed (sem busca)
async function fetchRedditNewJson(subreddit: string): Promise<any[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100`;
  const res = await fetchWithRetry(url, 15000);
  if (!res) return [];
  try {
    const json = await res.json();
    const children = json?.data?.children;
    if (!Array.isArray(children)) return [];
    return children.map((c: any) => c?.data).filter(Boolean);
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const candidateId: string | undefined = body.candidateId;
    const candidateName: string | undefined = body.candidateName;
    if (!candidateId || !candidateName) {
      return new Response(JSON.stringify({ error: "candidateId e candidateName são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cand } = await supabase
      .from("candidates").select("user_id").eq("id", candidateId).maybeSingle();
    if (!cand) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = cand.user_id as string;

    const rec = newPipelineRecorder("reddit", candidateId);
    const query = `"${candidateName}"`;

    const tasks: Promise<any[]>[] = [
      fetchPullPush("submission", query, 50),
      fetchPullPush("comment", query, 50),
    ];
    for (const sr of BR_SUBREDDITS) {
      tasks.push(fetchPullPush("submission", query, 30, sr));
    }
    tasks.push(fetchArcticShift("posts", candidateName));
    tasks.push(fetchArcticShift("comments", candidateName));

    // L2.b: Fallback Reddit oficial (.json) — subreddits BR + busca por query
    const redditFallback: Promise<any[]>[] = [];
    for (const sr of BR_SUBREDDITS) {
      redditFallback.push(fetchRedditJson(sr, candidateName));
    }
    // Top 8 subreddits mais ativos também via /new (cobertura adicional sem busca)
    for (const sr of BR_SUBREDDITS.slice(0, 8)) {
      redditFallback.push(fetchRedditNewJson(sr));
    }

    const [results, fallbackResults] = await Promise.all([
      Promise.all(tasks),
      Promise.allSettled(redditFallback).then((rs) => rs.map((r) => r.status === "fulfilled" ? r.value : [])),
    ]);

    const pullpushCount = results.flat().length;
    const fallbackCount = fallbackResults.flat().length;
    rec.addCollected(pullpushCount, "pullpush_arctic");
    rec.addCollected(fallbackCount, "reddit_json_fallback");

    const allPosts = [
      ...results[0],
      ...results.slice(2, 2 + BR_SUBREDDITS.length).flat(),
      ...results[results.length - 2],
      ...fallbackResults.flat(),
    ];
    const allComments = [...results[1], ...results[results.length - 1]];
    console.log(`[REDDIT] PullPush=${pullpushCount} Fallback=${fallbackCount}`);

    const items: any[] = [];
    for (const p of allPosts) {
      const text = `${p.title || ""}\n${p.selftext || ""}`.trim();
      const url = p.permalink ? `https://reddit.com${p.permalink}` : (p.url || "");
      if (!text || !url) { rec.addFiltered(1, "invalid_payload"); continue; }
      if (!semanticMatch(text, candidateName)) { rec.addFiltered(1, "semantic_mismatch"); continue; }
      rec.addParsed(1);
      items.push({
        candidate_id: candidateId, user_id: userId, social_network: "Reddit", interaction_type: "post",
        comment_text: text.slice(0, 4000),
        comment_author: p.author || "Reddit user",
        author_profile_url: url,
        original_posted_at: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : new Date().toISOString(),
        collected_at: new Date().toISOString(),
        likes_count: Math.max(0, Number(p.score || 0)),
        replies_count: Number(p.num_comments || 0), shares_count: 0,
      });
    }
    for (const c of allComments) {
      const text = (c.body || "").trim();
      const url = c.permalink ? `https://reddit.com${c.permalink}` : (c.link_permalink || "");
      if (!text || !url || text === "[removed]" || text === "[deleted]") { rec.addFiltered(1, "invalid_payload"); continue; }
      if (!semanticMatch(text, candidateName)) { rec.addFiltered(1, "semantic_mismatch"); continue; }
      rec.addParsed(1);
      items.push({
        candidate_id: candidateId, user_id: userId, social_network: "Reddit", interaction_type: "comment",
        comment_text: text.slice(0, 4000),
        comment_author: c.author || "Reddit user",
        author_profile_url: url,
        original_posted_at: c.created_utc ? new Date(c.created_utc * 1000).toISOString() : new Date().toISOString(),
        collected_at: new Date().toISOString(),
        likes_count: Math.max(0, Number(c.score || 0)), replies_count: 0, shares_count: 0,
      });
    }

    // Dedup interno por URL
    const byUrl = new Map<string, any>();
    for (const it of items) byUrl.set(it.author_profile_url, it);
    const dedupedLocal = [...byUrl.values()];
    rec.addDeduped(items.length - dedupedLocal.length, "local");

    if (dedupedLocal.length === 0) {
      await rec.flush();
      return new Response(JSON.stringify({ collected: 0, message: "Nenhuma menção nova" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Dedup contra DB em chunks
    const urls = dedupedLocal.map((r) => r.author_profile_url);
    const existingSet = new Set<string>();
    for (let i = 0; i < urls.length; i += 100) {
      const chunk = urls.slice(i, i + 100);
      const { data: existing } = await supabase
        .from("social_interactions").select("author_profile_url")
        .eq("candidate_id", candidateId).eq("social_network", "Reddit").in("author_profile_url", chunk);
      (existing ?? []).forEach((e: any) => existingSet.add(e.author_profile_url));
    }
    const fresh = dedupedLocal.filter((r) => !existingSet.has(r.author_profile_url));
    rec.addDeduped(dedupedLocal.length - fresh.length, "db");

    if (fresh.length === 0) {
      await rec.flush();
      return new Response(JSON.stringify({ collected: 0, message: "Todos duplicados" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const freshEnriched = fresh.map((r) => enrichRecordLocation(r));
    const { error } = await supabase.from("social_interactions").insert(freshEnriched);
    if (error) { rec.setError(error.message); await rec.flush(); throw error; }
    rec.addInserted(fresh.length);
    await rec.flush();

    return new Response(JSON.stringify({ collected: fresh.length, raw: dedupedLocal.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[REDDIT] erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
