// Cron poller — verifica apify_runs com status='running', baixa items quando SUCCEEDED,
// grava em social_posts (SSOT da feature) e em social_interactions (para os dashboards).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIFY_BASE = "https://api.apify.com/v2";
const MAX_RUN_AGE_MIN = 30; // após isso, marcar como timeout

async function getRunStatus(runId: string, token: string) {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`);
  if (!res.ok) return null;
  const j = await res.json();
  return j?.data?.status as string | undefined;
}

async function getRunItems(runId: string, token: string) {
  const res = await fetch(
    `${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${token}&clean=true&format=json`,
  );
  if (!res.ok) return [];
  return await res.json();
}

function normalizeIG(item: any) {
  return {
    post_id: item.id || item.shortCode || item.url,
    author: item.ownerUsername ?? "",
    content: item.caption ?? "",
    likes: Number(item.likesCount ?? 0) || 0,
    comments_count: Number(item.commentsCount ?? 0) || 0,
    shares_count: 0,
    url: item.url ?? (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null),
    posted_at: item.timestamp ?? null,
    type: "post" as const,
    latestComments: Array.isArray(item.latestComments) ? item.latestComments : [],
  };
}
function normalizeFB(item: any) {
  return {
    post_id: item.postId || item.id || item.url || item.postUrl,
    author: item.user?.name ?? item.pageName ?? "",
    content: item.text ?? item.message ?? "",
    likes: Number(item.likes ?? item.likesCount ?? 0) || 0,
    comments_count: Number(item.comments ?? item.commentsCount ?? 0) || 0,
    shares_count: Number(item.shares ?? item.sharesCount ?? 0) || 0,
    url: item.url ?? item.postUrl ?? null,
    posted_at: item.time ?? item.timestamp ?? null,
    type: "post" as const,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
  if (!APIFY_TOKEN) {
    return new Response(JSON.stringify({ error: "APIFY_API_TOKEN não configurado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: runs } = await supabase
    .from("apify_runs")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(40);

  if (!runs?.length) {
    return new Response(JSON.stringify({ message: "Nenhum run em execução.", processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  let finished = 0, failed = 0, stillRunning = 0, totalItems = 0;

  for (const r of runs) {
    if (!r.run_id) continue;

    const ageMin = (now - new Date(r.created_at).getTime()) / 60_000;
    const status = await getRunStatus(r.run_id, APIFY_TOKEN);

    if (!status || status === "RUNNING" || status === "READY") {
      if (ageMin > MAX_RUN_AGE_MIN) {
        await supabase.from("apify_runs").update({
          status: "timeout", finished_at: new Date().toISOString(),
          error_message: `Run excedeu ${MAX_RUN_AGE_MIN} min`,
        }).eq("id", r.id);
        failed++;
      } else {
        stillRunning++;
      }
      continue;
    }

    if (status !== "SUCCEEDED") {
      await supabase.from("apify_runs").update({
        status: "failed", finished_at: new Date().toISOString(),
        error_message: `Apify status: ${status}`,
      }).eq("id", r.id);
      failed++;
      continue;
    }

    // SUCCEEDED → baixa items
    const items = await getRunItems(r.run_id, APIFY_TOKEN);
    const posts: any[] = [];
    const interactions: any[] = [];

    for (const raw of items) {
      const n = r.platform === "instagram" ? normalizeIG(raw) : normalizeFB(raw);
      if (!n.post_id) continue;

      posts.push({
        user_id: r.user_id, candidate_id: r.candidate_id, apify_run_id: r.id,
        platform: r.platform, post_id: String(n.post_id), author: n.author,
        content: n.content, likes: n.likes, comments_count: n.comments_count,
        shares_count: n.shares_count, url: n.url, posted_at: n.posted_at, type: "post",
      });

      interactions.push({
        candidate_id: r.candidate_id, user_id: r.user_id,
        social_network: r.platform, interaction_type: "post",
        comment_text: n.content, comment_author: n.author,
        author_profile_url: r.platform === "instagram"
          ? (n.author ? `https://www.instagram.com/${n.author}/` : null)
          : (n.author ? `https://www.facebook.com/${n.author}/` : null),
        likes_count: n.likes, replies_count: n.comments_count, shares_count: n.shares_count,
        original_posted_at: n.posted_at, collected_at: new Date().toISOString(),
      });

      // Comentários do IG (vêm embutidos)
      if (r.platform === "instagram" && (n as any).latestComments?.length) {
        for (const cm of (n as any).latestComments.slice(0, 10)) {
          const cmId = `${n.post_id}_c_${cm.id ?? cm.text?.slice(0, 20) ?? Math.random()}`;
          posts.push({
            user_id: r.user_id, candidate_id: r.candidate_id, apify_run_id: r.id,
            platform: "instagram", post_id: cmId, author: cm.ownerUsername ?? "",
            content: cm.text ?? "", likes: Number(cm.likesCount ?? 0) || 0,
            comments_count: 0, shares_count: 0,
            url: n.url, posted_at: cm.timestamp ?? null, type: "comment",
          });
          interactions.push({
            candidate_id: r.candidate_id, user_id: r.user_id,
            social_network: "instagram", interaction_type: "comment",
            comment_text: cm.text ?? "", comment_author: cm.ownerUsername ?? "",
            author_profile_url: cm.ownerUsername ? `https://www.instagram.com/${cm.ownerUsername}/` : null,
            likes_count: Number(cm.likesCount ?? 0) || 0, replies_count: 0, shares_count: 0,
            original_posted_at: cm.timestamp ?? null, collected_at: new Date().toISOString(),
          });
        }
      }
    }

    if (posts.length) {
      const { error } = await supabase.from("social_posts").upsert(posts, {
        onConflict: "platform,post_id", ignoreDuplicates: true,
      });
      if (error) console.error("social_posts upsert:", error.message);
    }
    if (interactions.length) {
      const { error } = await supabase.from("social_interactions").insert(interactions);
      if (error) console.error("social_interactions insert:", error.message);
    }

    await supabase.from("apify_runs").update({
      status: "finished", items_collected: posts.length,
      finished_at: new Date().toISOString(),
    }).eq("id", r.id);

    finished++;
    totalItems += posts.length;
  }

  return new Response(JSON.stringify({
    message: "Poll concluído",
    finished, failed, still_running: stillRunning, items_inserted: totalItems,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
