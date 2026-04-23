// Coletor Instagram + Facebook via Apify (run-sync-get-dataset-items).
// Reusa colunas existentes:
//   - candidates.social_media_link → de onde extraímos handle IG e/ou página FB
//   - social_interactions.interaction_type → 'post' ou 'comment'
//   - social_interactions.social_network → 'instagram' | 'facebook'
//
// Requer secret: APIFY_API_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Actors públicos populares e gratuitos no Apify Store
const IG_ACTOR = "apify~instagram-scraper";
const FB_ACTOR = "apify~facebook-posts-scraper";

const RESULTS_PER_PROFILE = 20; // posts por perfil/run
const APIFY_TIMEOUT_MS = 90_000; // run síncrono limitado

function extractInstagramHandle(link?: string | null): string | null {
  if (!link) return null;
  const m = link.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (m) return m[1].replace(/\/$/, "");
  if (/^@?[A-Za-z0-9_.]+$/.test(link.trim())) return link.trim().replace(/^@/, "");
  return null;
}

function extractFacebookHandle(link?: string | null): string | null {
  if (!link) return null;
  const m = link.match(/facebook\.com\/([A-Za-z0-9.\-]+)/i);
  if (m && !["sharer", "dialog", "plugins"].includes(m[1].toLowerCase())) {
    return m[1].replace(/\/$/, "");
  }
  return null;
}

async function runApifyActor(actorId: string, input: unknown, token: string): Promise<any[]> {
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=${Math.floor(APIFY_TIMEOUT_MS / 1000)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), APIFY_TIMEOUT_MS + 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error(`Apify ${actorId} ${res.status}: ${txt.slice(0, 300)}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(`Apify ${actorId} fetch error: ${(e as Error).message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
  if (!APIFY_TOKEN) {
    return new Response(JSON.stringify({ error: "APIFY_API_TOKEN não configurado" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, full_name, social_media_link, user_id");

    if (candErr) throw candErr;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ message: "Sem candidatos.", inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const interactions: any[] = [];
    const stats = { instagram: 0, facebook: 0, igCandidates: 0, fbCandidates: 0, errors: [] as string[] };

    for (const c of candidates) {
      const igHandle = extractInstagramHandle(c.social_media_link);
      const fbHandle = extractFacebookHandle(c.social_media_link);

      // ---------- INSTAGRAM ----------
      if (igHandle) {
        stats.igCandidates++;
        try {
          const items = await runApifyActor(
            IG_ACTOR,
            {
              directUrls: [`https://www.instagram.com/${igHandle}/`],
              resultsType: "posts",
              resultsLimit: RESULTS_PER_PROFILE,
              addParentData: false,
            },
            APIFY_TOKEN,
          );

          for (const it of items) {
            const url = it.url || it.shortCode ? (it.url ?? `https://www.instagram.com/p/${it.shortCode}/`) : null;
            if (!url) continue;
            interactions.push({
              candidate_id: c.id,
              user_id: c.user_id,
              social_network: "instagram",
              interaction_type: "post",
              comment_text: it.caption ?? "",
              comment_author: it.ownerUsername ?? igHandle,
              author_profile_url: `https://www.instagram.com/${it.ownerUsername ?? igHandle}/`,
              likes_count: Number(it.likesCount ?? 0) || 0,
              replies_count: Number(it.commentsCount ?? 0) || 0,
              shares_count: 0,
              original_posted_at: it.timestamp ?? null,
              collected_at: new Date().toISOString(),
            });
            stats.instagram++;

            // Comentários top-level se o actor já trouxer (alguns trazem em latestComments)
            const comments = Array.isArray(it.latestComments) ? it.latestComments : [];
            for (const cm of comments.slice(0, 10)) {
              interactions.push({
                candidate_id: c.id,
                user_id: c.user_id,
                social_network: "instagram",
                interaction_type: "comment",
                comment_text: cm.text ?? "",
                comment_author: cm.ownerUsername ?? "",
                author_profile_url: cm.ownerUsername
                  ? `https://www.instagram.com/${cm.ownerUsername}/`
                  : null,
                likes_count: Number(cm.likesCount ?? 0) || 0,
                replies_count: 0,
                shares_count: 0,
                original_posted_at: cm.timestamp ?? null,
                collected_at: new Date().toISOString(),
              });
              stats.instagram++;
            }
          }
        } catch (e) {
          stats.errors.push(`IG ${c.full_name}: ${(e as Error).message}`);
        }
      }

      // ---------- FACEBOOK ----------
      if (fbHandle) {
        stats.fbCandidates++;
        try {
          const items = await runApifyActor(
            FB_ACTOR,
            {
              startUrls: [{ url: `https://www.facebook.com/${fbHandle}/` }],
              resultsLimit: RESULTS_PER_PROFILE,
            },
            APIFY_TOKEN,
          );

          for (const it of items) {
            const url = it.url || it.postUrl || null;
            if (!url) continue;
            interactions.push({
              candidate_id: c.id,
              user_id: c.user_id,
              social_network: "facebook",
              interaction_type: "post",
              comment_text: it.text ?? it.message ?? "",
              comment_author: it.user?.name ?? fbHandle,
              author_profile_url: it.user?.profileUrl ?? `https://www.facebook.com/${fbHandle}/`,
              likes_count: Number(it.likes ?? it.likesCount ?? 0) || 0,
              replies_count: Number(it.comments ?? it.commentsCount ?? 0) || 0,
              shares_count: Number(it.shares ?? it.sharesCount ?? 0) || 0,
              original_posted_at: it.time ?? it.timestamp ?? null,
              collected_at: new Date().toISOString(),
            });
            stats.facebook++;
          }
        } catch (e) {
          stats.errors.push(`FB ${c.full_name}: ${(e as Error).message}`);
        }
      }
    }

    let inserted = 0;
    if (interactions.length > 0) {
      // Insere em lotes de 500
      for (let i = 0; i < interactions.length; i += 500) {
        const batch = interactions.slice(i, i + 500);
        const { error: insErr, count } = await supabase
          .from("social_interactions")
          .insert(batch, { count: "exact" });
        if (insErr) {
          console.error("Insert error:", insErr.message);
          stats.errors.push(`insert: ${insErr.message}`);
        } else {
          inserted += count ?? batch.length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: "Coleta Apify concluída",
        inserted,
        candidates_processed: candidates.length,
        ...stats,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("meta-mass-collector fatal:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
