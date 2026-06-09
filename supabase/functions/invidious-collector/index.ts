// Coletor Invidious (mirror público do YouTube) - usado quando keys oficiais YT estão exauridas
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { INVIDIOUS_MIRRORS, fetchFromMirrors } from "../_shared/scrape-utils.ts";
import { isPoliticalCandidateContent } from "../_shared/political-content.ts";
import { cleanContent } from "../_shared/clean-content.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function searchVideos(q: string): Promise<any[]> {
  const result = await fetchFromMirrors(
    INVIDIOUS_MIRRORS,
    (base) => `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video&sort_by=upload_date&region=BR`,
    { timeoutMs: 12000 },
  );
  if (!result) return [];
  try {
    const d = await result.response.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

async function getComments(videoId: string): Promise<any[]> {
  const result = await fetchFromMirrors(
    INVIDIOUS_MIRRORS,
    (base) => `${base}/api/v1/comments/${videoId}?sort_by=top`,
    { timeoutMs: 12000 },
  );
  if (!result) return [];
  try {
    const d = await result.response.json();
    return d?.comments || [];
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
      const videos = await searchVideos(c.full_name);
      for (const v of videos.slice(0, 15)) {
        const vid = v.videoId;
        if (!vid) continue;
        const videoText = `${v.title || ""} ${v.description || ""} ${v.author || ""}`;
        if (!isPoliticalCandidateContent(videoText, c.full_name)) continue;
        // grava o vídeo
        const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
        const { data: vexist } = await supabase
          .from("social_interactions").select("id")
          .eq("candidate_id", c.id).eq("social_network", "youtube")
          .eq("author_profile_url", videoUrl).maybeSingle();
        if (!vexist) {
          const { error } = await supabase.from("social_interactions").insert({
            user_id: c.user_id, candidate_id: c.id, social_network: "youtube",
            platform: "youtube",
            interaction_type: "video",
            comment_text: `${v.title}\n${(v.description || "").slice(0, 1000)}`,
            comment_author: v.author || "YouTube",
            author_profile_url: videoUrl,
            post_url: videoUrl,
            post_title: v.title || null,
            post_description: (v.description || "").slice(0, 1000) || null,
            thumbnail_url: v.videoThumbnails?.[0]?.url || null,
            author_name: v.author || "YouTube",
            author_handle: v.authorId || null,
            post_id: vid,
            engagement_score: Number(v.viewCount || 0) || 0,
            sentiment_label: "Neutro", sentiment_score: 0.5,
            likes_count: v.viewCount || 0, replies_count: 0, shares_count: 0,
            collected_at: new Date().toISOString(),
            original_posted_at: v.published ? new Date(v.published * 1000).toISOString() : null,
          });
          if (!error) totalInserted++;
        }
        // comentários
        const comments = await getComments(vid);
        for (const cm of comments.slice(0, 30)) {
          const url = `${videoUrl}&lc=${cm.commentId || crypto.randomUUID()}`;
          const text = (cm.content || "").slice(0, 4000);
          if (!text || text.length < 5) continue;
          if (!isPoliticalCandidateContent(`${text} ${videoText}`, c.full_name)) continue;
          const { data: cexist } = await supabase
            .from("social_interactions").select("id")
            .eq("candidate_id", c.id).eq("social_network", "youtube")
            .eq("author_profile_url", url).maybeSingle();
          if (cexist) continue;
          const { error } = await supabase.from("social_interactions").insert({
            user_id: c.user_id, candidate_id: c.id, social_network: "youtube",
            platform: "youtube",
            interaction_type: "comment", comment_text: text,
            comment_author: cm.author || "anon", author_profile_url: url,
            post_url: videoUrl, post_title: v.title || null,
            post_description: (v.description || "").slice(0, 1000) || null,
            thumbnail_url: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
            author_name: v.author || "YouTube",
            author_handle: v.authorId || null,
            post_id: vid,
            engagement_score: Number(cm.likeCount || 0) || 0,
            sentiment_label: "Neutro", sentiment_score: 0.5,
            likes_count: cm.likeCount || 0, replies_count: 0, shares_count: 0,
            collected_at: new Date().toISOString(),
            original_posted_at: cm.published ? new Date(cm.published * 1000).toISOString() : null,
          });
          if (!error) totalInserted++;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    try { await supabase.rpc("record_collector_call", { _name: "invidious", _items: totalInserted, _had_error: false }); } catch (_) {}
    return new Response(JSON.stringify({ success: true, total_inserted: totalInserted, candidates: candidates.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[INVIDIOUS]", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
