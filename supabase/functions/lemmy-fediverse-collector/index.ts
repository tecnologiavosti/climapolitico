// Coletor Lemmy (Fediverso Reddit-like) - sem API key, federa entre múltiplas instâncias
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { LEMMY_INSTANCES, resilientFetch, safeSlug } from "../_shared/scrape-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LemmyPost {
  post: { id: number; name: string; body?: string; published: string; ap_id: string };
  creator: { name: string; actor_id: string };
  counts: { score: number; comments: number };
}

async function searchLemmy(instance: string, q: string): Promise<LemmyPost[]> {
  const url = `https://${instance}/api/v3/search?q=${encodeURIComponent(q)}&type_=Posts&sort=New&limit=50`;
  const r = await resilientFetch(url, { timeoutMs: 12000 });
  if (!r) return [];
  try {
    const d = await r.json();
    return (d?.posts || []) as LemmyPost[];
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
      const queries = [c.full_name, safeSlug(c.full_name).replace(/-/g, " ")];
      const seenUrls = new Set<string>();
      for (const inst of LEMMY_INSTANCES) {
        for (const q of queries) {
          const posts = await searchLemmy(inst, q);
          for (const p of posts) {
            if (seenUrls.has(p.post.ap_id)) continue;
            seenUrls.add(p.post.ap_id);
            const text = `${p.post.name}\n${p.post.body || ""}`.slice(0, 4000);
            const { data: existing } = await supabase
              .from("social_interactions").select("id")
              .eq("candidate_id", c.id).eq("social_network", "lemmy")
              .eq("author_profile_url", p.post.ap_id).maybeSingle();
            if (existing) continue;
            const { error } = await supabase.from("social_interactions").insert({
              user_id: c.user_id, candidate_id: c.id, social_network: "lemmy",
              interaction_type: "post", comment_text: text,
              comment_author: p.creator.name, author_profile_url: p.post.ap_id,
              sentiment_label: "Neutro", sentiment_score: 0.5,
              likes_count: p.counts.score || 0, replies_count: p.counts.comments || 0,
              shares_count: 0, collected_at: new Date().toISOString(),
              original_posted_at: p.post.published,
            });
            if (!error) totalInserted++;
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }
    try { await supabase.rpc("record_collector_call", { _name: "lemmy", _items: totalInserted, _had_error: false }); } catch (_) {}
    return new Response(JSON.stringify({ success: true, total_inserted: totalInserted, candidates: candidates.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[LEMMY]", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
