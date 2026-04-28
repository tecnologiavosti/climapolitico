// Edge function: Coleta automática do Reddit via PullPush API (api.pullpush.io).
// Substitui RSS-Bridge (instâncias públicas que ficaram offline / DNS dead).
// PullPush é um arquivo público gratuito do Pushshift, acessível de IPs de cloud.
// Disparada por cron a cada 30 minutos para todos os candidatos ativos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PULLPUSH_BASE = "https://api.pullpush.io/reddit/search";
const PER_QUERY = 50; // posts + 50 comments por candidato

interface Candidate {
  id: string;
  full_name: string;
  user_id: string;
}

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

async function fetchPullPush(kind: "submission" | "comment", query: string): Promise<any[]> {
  const url = `${PULLPUSH_BASE}/${kind}/?q=${encodeURIComponent(query)}&size=${PER_QUERY}&sort=desc&sort_type=created_utc`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0 (+lovable)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`[REDDIT-CRON] pullpush ${kind} HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } catch (e) {
    console.warn(`[REDDIT-CRON] pullpush ${kind} falhou:`, (e as Error).message);
    return [];
  }
}

async function collectRedditForCandidate(
  supabase: ReturnType<typeof createClient>,
  candidate: Candidate,
): Promise<{ collected: number; skipped: number; raw: number }> {
  const query = `"${candidate.full_name}"`;

  const [posts, comments] = await Promise.all([
    fetchPullPush("submission", query),
    fetchPullPush("comment", query),
  ]);

  const items: Array<{ kind: string; text: string; author: string; url: string; created: string; score: number; replies: number }> = [];

  for (const p of posts) {
    const text = `${p.title || ""}\n${p.selftext || ""}`.trim();
    const url = p.permalink ? `https://reddit.com${p.permalink}` : (p.url || "");
    if (!text || !url) continue;
    items.push({
      kind: "post",
      text: text.slice(0, 4000),
      author: p.author || "Reddit user",
      url,
      created: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : new Date().toISOString(),
      score: Number(p.score || 0),
      replies: Number(p.num_comments || 0),
    });
  }
  for (const c of comments) {
    const text = (c.body || "").trim();
    const url = c.permalink ? `https://reddit.com${c.permalink}` : (c.link_permalink || "");
    if (!text || !url || text === "[removed]" || text === "[deleted]") continue;
    items.push({
      kind: "comment",
      text: text.slice(0, 4000),
      author: c.author || "Reddit user",
      url,
      created: c.created_utc ? new Date(c.created_utc * 1000).toISOString() : new Date().toISOString(),
      score: Number(c.score || 0),
      replies: 0,
    });
  }

  if (items.length === 0) {
    console.log(`[REDDIT-CRON] ${candidate.full_name}: 0 itens (PullPush)`);
    return { collected: 0, skipped: 0, raw: 0 };
  }

  let skipped = 0;
  const rows: any[] = [];
  for (const it of items) {
    if (!semanticMatch(it.text, candidate.full_name)) { skipped++; continue; }
    rows.push({
      candidate_id: candidate.id,
      user_id: candidate.user_id,
      social_network: "Reddit",
      interaction_type: it.kind,
      comment_text: it.text,
      comment_author: it.author,
      author_profile_url: it.url,
      original_posted_at: it.created,
      collected_at: new Date().toISOString(),
      likes_count: Math.max(0, it.score),
      replies_count: it.replies,
      shares_count: 0,
    });
  }

  if (rows.length === 0) {
    console.log(`[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=0 skipped=${skipped}`);
    return { collected: 0, skipped, raw: items.length };
  }

  // Dedup por author_profile_url
  const urls = rows.map((r) => r.author_profile_url);
  const { data: existing } = await supabase
    .from("social_interactions")
    .select("author_profile_url")
    .eq("candidate_id", candidate.id)
    .eq("social_network", "Reddit")
    .in("author_profile_url", urls);
  const existingSet = new Set((existing ?? []).map((e: any) => e.author_profile_url));
  const fresh = rows.filter((r) => !existingSet.has(r.author_profile_url));

  if (fresh.length === 0) {
    console.log(`[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=0 (dups)`);
    return { collected: 0, skipped, raw: items.length };
  }

  const { error } = await supabase.from("social_interactions").insert(fresh);
  if (error) {
    console.error(`[REDDIT-CRON] insert falhou ${candidate.full_name}: ${error.message}`);
    return { collected: 0, skipped, raw: items.length };
  }

  console.log(`[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=${fresh.length} skipped=${skipped}`);
  return { collected: fresh.length, skipped, raw: items.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const { data: candidates, error } = await supabase
      .from("candidates")
      .select("id, full_name, user_id")
      .eq("status", "active");
    if (error) throw error;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhum candidato ativo." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalCollected = 0;
    const results: any[] = [];
    for (const c of candidates as Candidate[]) {
      const r = await collectRedditForCandidate(supabase, c);
      totalCollected += r.collected;
      results.push({ candidate: c.full_name, ...r });
      await new Promise((res) => setTimeout(res, 1200));
    }

    return new Response(
      JSON.stringify({ success: true, total_collected: totalCollected, candidates_processed: candidates.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[REDDIT-CRON] erro fatal:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
