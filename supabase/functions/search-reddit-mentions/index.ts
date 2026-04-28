// Edge function: coleta manual de menções do Reddit para 1 candidato.
// Usa PullPush API (api.pullpush.io) — funciona em IPs de cloud (Reddit oficial bloqueia).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PULLPUSH_BASE = "https://api.pullpush.io/reddit/search";

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

async function fetchPullPush(kind: "submission" | "comment", query: string, size = 50): Promise<any[]> {
  const url = `${PULLPUSH_BASE}/${kind}/?q=${encodeURIComponent(query)}&size=${size}&sort=desc&sort_type=created_utc`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0 (+lovable)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`[REDDIT] pullpush ${kind} HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } catch (e) {
    console.warn(`[REDDIT] pullpush ${kind} falhou:`, (e as Error).message);
    return [];
  }
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

    // Recupera user_id
    const { data: cand } = await supabase
      .from("candidates").select("user_id").eq("id", candidateId).maybeSingle();
    if (!cand) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = cand.user_id as string;

    const query = `"${candidateName}"`;
    const [posts, comments] = await Promise.all([
      fetchPullPush("submission", query, 50),
      fetchPullPush("comment", query, 50),
    ]);

    const items: any[] = [];
    for (const p of posts) {
      const text = `${p.title || ""}\n${p.selftext || ""}`.trim();
      const url = p.permalink ? `https://reddit.com${p.permalink}` : (p.url || "");
      if (!text || !url) continue;
      if (!semanticMatch(text, candidateName)) continue;
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
    for (const c of comments) {
      const text = (c.body || "").trim();
      const url = c.permalink ? `https://reddit.com${c.permalink}` : (c.link_permalink || "");
      if (!text || !url || text === "[removed]" || text === "[deleted]") continue;
      if (!semanticMatch(text, candidateName)) continue;
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

    if (items.length === 0) {
      return new Response(JSON.stringify({ collected: 0, message: "Nenhuma menção nova" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Dedup
    const urls = items.map((r) => r.author_profile_url);
    const { data: existing } = await supabase
      .from("social_interactions").select("author_profile_url")
      .eq("candidate_id", candidateId).eq("social_network", "Reddit").in("author_profile_url", urls);
    const existingSet = new Set((existing ?? []).map((e: any) => e.author_profile_url));
    const fresh = items.filter((r) => !existingSet.has(r.author_profile_url));

    if (fresh.length === 0) {
      return new Response(JSON.stringify({ collected: 0, message: "Todos duplicados" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase.from("social_interactions").insert(fresh);
    if (error) throw error;

    return new Response(JSON.stringify({ collected: fresh.length, raw: items.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[REDDIT] erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
