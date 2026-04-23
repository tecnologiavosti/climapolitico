// Coletor Apify (assíncrono) — Instagram + Facebook
// Inicia runs no Apify e registra em apify_runs. Não espera o resultado:
// o `apify-poll-runs` (cron) vai buscar os items e gravar em social_posts + social_interactions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIFY_BASE = "https://api.apify.com/v2";
const IG_ACTOR = "apify~instagram-scraper";
const FB_ACTOR = "apify~facebook-pages-scraper";
const RESULTS_PER_PROFILE = 30;

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
  if (m && !["sharer", "dialog", "plugins", "watch", "groups"].includes(m[1].toLowerCase())) {
    return m[1].replace(/\/$/, "");
  }
  return null;
}

async function startApifyRun(actorId: string, input: unknown, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`Apify start ${actorId} ${res.status}:`, JSON.stringify(data).slice(0, 300));
      return null;
    }
    return data?.data?.id ?? null;
  } catch (e) {
    console.error(`Apify start ${actorId} error:`, (e as Error).message);
    return null;
  }
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

  try {
    const { data: candidates, error: candErr } = await supabase
      .from("candidates")
      .select("id, full_name, social_media_link, user_id");
    if (candErr) throw candErr;
    if (!candidates?.length) {
      return new Response(JSON.stringify({ message: "Sem candidatos.", started: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: extraLinks } = await supabase
      .from("candidate_social_links")
      .select("candidate_id, platform, url, handle")
      .in("platform", ["instagram", "facebook"]);

    const linksByCand = new Map<string, { ig?: string; fb?: string }>();
    for (const l of extraLinks ?? []) {
      const e = linksByCand.get(l.candidate_id) ?? {};
      if (l.platform === "instagram" && !e.ig) e.ig = l.handle || extractInstagramHandle(l.url) || undefined;
      if (l.platform === "facebook" && !e.fb) e.fb = l.handle || extractFacebookHandle(l.url) || undefined;
      linksByCand.set(l.candidate_id, e);
    }

    let started = 0;
    const errors: string[] = [];

    for (const c of candidates) {
      const extra = linksByCand.get(c.id) ?? {};
      const igHandle = extra.ig ?? extractInstagramHandle(c.social_media_link);
      const fbHandle = extra.fb ?? extractFacebookHandle(c.social_media_link);

      if (igHandle) {
        const runId = await startApifyRun(IG_ACTOR, {
          usernames: [igHandle],
          resultsType: "posts",
          resultsLimit: RESULTS_PER_PROFILE,
          addParentData: false,
        }, APIFY_TOKEN);
        if (runId) {
          await supabase.from("apify_runs").insert({
            user_id: c.user_id, candidate_id: c.id, platform: "instagram",
            actor_id: IG_ACTOR, run_id: runId, status: "running",
          });
          started++;
        } else {
          errors.push(`IG ${c.full_name}: falha ao iniciar run`);
        }
      }

      if (fbHandle) {
        const runId = await startApifyRun(FB_ACTOR, {
          startUrls: [{ url: `https://www.facebook.com/${fbHandle}/` }],
          resultsLimit: RESULTS_PER_PROFILE,
        }, APIFY_TOKEN);
        if (runId) {
          await supabase.from("apify_runs").insert({
            user_id: c.user_id, candidate_id: c.id, platform: "facebook",
            actor_id: FB_ACTOR, run_id: runId, status: "running",
          });
          started++;
        } else {
          errors.push(`FB ${c.full_name}: falha ao iniciar run`);
        }
      }
    }

    return new Response(JSON.stringify({
      message: "Runs iniciados. Resultados aparecerão em ~1-3 min via apify-poll-runs.",
      started, errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("meta-mass-collector fatal:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
