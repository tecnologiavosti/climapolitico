// Edge function: coleta DEDICADA do Bluesky via AppView pública (sem auth).
// Diferente do search-twitter-mentions, este NÃO mistura com Twitter — grava
// como social_network='bluesky' e pagina profundamente (até 500 posts/candidato).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APPVIEW = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const UA = "ClimaPolitico/1.0 (+lovable)";

interface BskyPost {
  uri: string;
  cid: string;
  url: string;
  text: string;
  author: string;
  authorUrl: string;
  postedAt: string;
  likes: number;
  replies: number;
  reposts: number;
}

function postUrl(p: any): string {
  const handle = p?.author?.handle;
  const rkey = p?.uri?.split("/").pop();
  if (handle && rkey) return `https://bsky.app/profile/${handle}/post/${rkey}`;
  return p?.uri || "";
}

async function searchPage(q: string, cursor?: string, lang = "pt"): Promise<{ posts: BskyPost[]; cursor?: string }> {
  const params = new URLSearchParams({ q, limit: "100", sort: "latest", lang });
  if (cursor) params.set("cursor", cursor);
  try {
    const r = await fetch(`${APPVIEW}?${params}`, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      console.warn(`[BSKY] HTTP ${r.status}`);
      return { posts: [] };
    }
    const j = await r.json();
    const posts: BskyPost[] = (j?.posts || []).map((p: any) => ({
      uri: p.uri,
      cid: p.cid,
      url: postUrl(p),
      text: p?.record?.text || "",
      author: p?.author?.handle || p?.author?.did || "anon",
      authorUrl: p?.author?.handle ? `https://bsky.app/profile/${p.author.handle}` : "",
      postedAt: p?.record?.createdAt || p?.indexedAt || new Date().toISOString(),
      likes: p?.likeCount || 0,
      replies: p?.replyCount || 0,
      reposts: p?.repostCount || 0,
    }));
    return { posts, cursor: j?.cursor };
  } catch (e) {
    console.warn("[BSKY] search erro:", (e as Error).message);
    return { posts: [] };
  }
}

async function deepSearch(query: string, maxPosts = 500): Promise<BskyPost[]> {
  const out = new Map<string, BskyPost>();
  let cursor: string | undefined;
  for (let page = 0; page < 10 && out.size < maxPosts; page++) {
    const { posts, cursor: nxt } = await searchPage(query, cursor);
    if (posts.length === 0) break;
    for (const p of posts) out.set(p.uri, p);
    if (!nxt) break;
    cursor = nxt;
    await new Promise((r) => setTimeout(r, 300));
  }
  return Array.from(out.values());
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
    const targetId = body.candidateId as string | undefined;
    const maxPosts = Math.min(Number(body.maxPosts) || 300, 600);

    let candidates: Array<{ id: string; full_name: string; user_id: string }> = [];
    if (targetId) {
      const { data } = await supabase.from("candidates")
        .select("id, full_name, user_id").eq("id", targetId).maybeSingle();
      if (data) candidates = [data as any];
    } else {
      const { data } = await supabase.from("candidates")
        .select("id, full_name, user_id").eq("status", "active").limit(200);
      candidates = (data || []) as any[];
    }

    let totalInserted = 0;
    let totalCollected = 0;
    const details: Array<{ name: string; collected: number; inserted: number }> = [];

    for (const c of candidates) {
      // Quoted query → exato
      const posts = await deepSearch(`"${c.full_name}"`, maxPosts);
      totalCollected += posts.length;
      let inserted = 0;
      for (const p of posts) {
        if (!p.text || p.text.length < 5) continue;
        const { data: existing } = await supabase
          .from("social_interactions")
          .select("id")
          .eq("candidate_id", c.id)
          .eq("social_network", "bluesky")
          .eq("author_profile_url", p.url)
          .maybeSingle();
        if (existing) continue;

        const { error } = await supabase.from("social_interactions").insert({
          user_id: c.user_id,
          candidate_id: c.id,
          social_network: "bluesky",
          interaction_type: "post",
          comment_text: p.text.slice(0, 4000),
          comment_author: p.author,
          author_profile_url: p.url,
          sentiment_label: null,
          sentiment_score: null,
          likes_count: p.likes,
          replies_count: p.replies,
          shares_count: p.reposts,
          collected_at: new Date().toISOString(),
          original_posted_at: p.postedAt,
        });
        if (!error) inserted++;
      }
      totalInserted += inserted;
      details.push({ name: c.full_name, collected: posts.length, inserted });
      await new Promise((r) => setTimeout(r, 500));
    }

    try {
      await supabase.rpc("record_collector_call", {
        _name: "bluesky", _items: totalInserted, _had_error: false,
      });
    } catch (_) {}

    return new Response(JSON.stringify({
      success: true,
      candidates_processed: candidates.length,
      total_collected: totalCollected,
      total_inserted: totalInserted,
      details,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[BSKY-DEEP] erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
