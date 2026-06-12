// run-event-pipeline
// ============================================================================
// Orquestrador: encadeia em sequência
//   1) detect-events-from-news   (coleta RSS institucional + grande imprensa)
//   2) cluster-political-events  (mescla quase-duplicados)
//   3) validate-event            (confirmed / probable / weak / noise)
//
// Cada etapa roda como service-role (chamada interna). O escopo (user_id /
// candidate_ids) é repassado para todas as etapas. Retorna stats consolidados.
//
// Pode ser disparado por:
//   - usuário autenticado (escopo = seu próprio user_id, default)
//   - cron service-role  (escopo global ou um user_id específico no body)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function callStep(name: string, payload: unknown): Promise<any> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, ...body };
  } catch (e: any) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e?.message || String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const auth = req.headers.get("Authorization") || "";
    const isServiceRole = auth.includes(SERVICE_KEY);

    let userId: string | null = null;
    if (!isServiceRole) {
      if (!auth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: auth } },
      });
      const { data: ud } = await userClient.auth.getUser();
      if (!ud?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = ud.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const scopedUserId = isServiceRole ? (body?.user_id ?? null) : userId;
    const candidateIds: string[] | null = Array.isArray(body?.candidate_ids) ? body.candidate_ids : null;

    const maxAgeHours = Math.min(Math.max(Number(body?.max_age_hours) || 72, 6), 24 * 14);
    const clusterWindowDays = Math.min(Math.max(Number(body?.cluster_window_days) || 14, 1), 120);
    const validateWindowDays = Math.min(Math.max(Number(body?.validate_window_days) || 30, 1), 365);
    const onlyUnvalidated = body?.only_unvalidated !== false;

    const scope = { user_id: scopedUserId, candidate_ids: candidateIds };

    const detect = await callStep("detect-events-from-news", { ...scope, max_age_hours: maxAgeHours });
    const cluster = await callStep("cluster-political-events", { ...scope, window_days: clusterWindowDays });
    const validate = await callStep("validate-event", { ...scope, window_days: validateWindowDays, only_unvalidated: onlyUnvalidated });

    return new Response(JSON.stringify({
      ok: detect.ok && cluster.ok && validate.ok,
      steps: { detect, cluster, validate },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("run-event-pipeline error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
