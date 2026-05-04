// Coletor Tumblr - busca por tag/nome via endpoint público (sem API key)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resilientFetch, safeSlug } from "../_shared/scrape-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function searchTag(tag: string): Promise<any[]> {
  // Endpoint público SVC do tumblr usado pela busca web
  const url = `https://www.tumblr.com/svc/search/blog_search?q=${encodeURIComponent(tag)}&context=search&limit=30`;
  const r = await resilientFetch(url, {
    timeoutMs: 12000,
    headers: { "X-Requested-With": "XMLHttpRequest", "Referer": "https://www.tumblr.com/search" },
  });
  if (!r) return [];
  try {
    const d = await r.json();
    return d?.response?.blogs || [];
  } catch { return []; }
}

async function getBlogPosts(blogName: string, q: string): Promise<any[]> {
  // Endpoint público do tema padrão tumblr
  const url = `https://${blogName}.tumblr.com/api/read/json?type=text&num=20&filter=text&search=${encodeURIComponent(q)}`;
  const r = await resilientFetch(url, { timeoutMs: 12000 });
  if (!r) return [];
  try {
    const txt = await r.text();
    // Tumblr retorna JSONP: var tumblr_api_read = {...};
    const m = txt.match(/=\s*(\{[\s\S]*\});?\s*$/);
    if (!m) return [];
    const d = JSON.parse(m[1]);
    return d?.posts || [];
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const targetId = body.candidateId as string | undefined;

    let candidates: any[] = [];
    if (targetId) {
      const { data } = await supabase.from("candidates").select("id, full_name, user_id").eq("id", targetId).maybeSingle();
      if (data) candidates = [data];
    } else {
      const { data } = await supabase.from("candidates").select("id, full_name, user_id").eq("status", "active").limit(200);
      candidates = data || [];
    }

    let totalInserted = 0;
    for (const c of candidates) {
      const blogs = await searchTag(c.full_name);
      for (const b of blogs.slice(0, 8)) {
        const blogName = b.name || b.tumblelog;
        if (!blogName) continue;
        const posts = await getBlogPosts(blogName, c.full_name);
        for (const p of posts.slice(0, 15)) {
          const text = (p["regular-body"] || p["regular-title"] || p.body || "").replace(/<[^>]+>/g, "").trim().slice(0, 4000);
          if (!text || text.length < 20) continue;
          const url = p.url || p["url-with-slug"];
          if (!url) continue;
          const { data: existing } = await supabase
            .from("social_interactions").select("id")
            .eq("candidate_id", c.id).eq("social_network", "tumblr")
            .eq("author_profile_url", url).maybeSingle();
          if (existing) continue;
          const { error } = await supabase.from("social_interactions").insert({
            user_id: c.user_id, candidate_id: c.id, social_network: "tumblr",
            interaction_type: "post", comment_text: text,
            comment_author: blogName, author_profile_url: url,
            sentiment_label: "Neutro", sentiment_score: 0.5,
            likes_count: p["note-count"] || 0, replies_count: 0, shares_count: 0,
            collected_at: new Date().toISOString(),
            original_posted_at: p["date-gmt"] ? new Date(p["date-gmt"] + " UTC").toISOString() : null,
          });
          if (!error) totalInserted++;
        }
        await new Promise(r => setTimeout(r, 600));
      }
    }
    try { await supabase.rpc("record_collector_call", { _name: "tumblr", _items: totalInserted, _had_error: false }); } catch (_) {}
    return new Response(JSON.stringify({ success: true, total_inserted: totalInserted, candidates: candidates.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[TUMBLR]", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
