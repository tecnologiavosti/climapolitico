// External worker API: lets Docker/Railway workers claim and complete jobs
// Auth: Bearer <wkr_...> token validated via verify_worker_token RPC
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token.startsWith("wkr_")) return json({ error: "missing_worker_token" }, 401);

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const requiredScope =
      action === "complete" ? "worker:complete" :
      action === "heartbeat" ? "worker:claim" :
      "worker:claim";

    const { data: tokenData, error: tokenErr } = await supabase.rpc("verify_worker_token", {
      _token: token,
      _required_scope: requiredScope,
    });
    if (tokenErr || !tokenData || (tokenData as any[]).length === 0) {
      return json({ error: "invalid_or_expired_token" }, 401);
    }
    const tokenInfo = (tokenData as any[])[0];

    if (action === "claim") {
      const body = await req.json().catch(() => ({}));
      const { worker_id, job_type = "sentiment_analysis", batch_size = 5, lease_seconds = 120 } = body;
      if (!worker_id) return json({ error: "worker_id required" }, 400);
      const { data, error } = await supabase.rpc("claim_jobs", {
        _worker_id: worker_id,
        _job_type: job_type,
        _batch_size: Math.min(50, Math.max(1, batch_size)),
        _lease_seconds: Math.min(600, Math.max(30, lease_seconds)),
      });
      if (error) return json({ error: error.message }, 500);
      return json({ jobs: data ?? [], token_name: tokenInfo.name });
    }

    if (action === "complete") {
      const body = await req.json().catch(() => ({}));
      const { job_id, status, result, error_message, duration_ms, worker_id } = body;
      if (!job_id || !status) return json({ error: "job_id and status required" }, 400);

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (status === "succeeded") {
        updates.status = "succeeded";
        updates.completed_at = new Date().toISOString();
        updates.result = result ?? null;
      } else if (status === "failed") {
        updates.status = "queued"; // requeue with backoff handled by recover_stuck_jobs
        updates.last_error = String(error_message ?? "worker_error").slice(0, 1000);
        updates.scheduled_at = new Date(Date.now() + 30_000).toISOString();
      } else {
        return json({ error: "invalid status" }, 400);
      }

      const { error: upErr } = await supabase.from("analysis_jobs").update(updates).eq("id", job_id);
      if (upErr) return json({ error: upErr.message }, 500);

      await supabase.from("job_execution_history").insert({
        job_id,
        worker_id: worker_id ?? "external",
        status,
        duration_ms: duration_ms ?? null,
        error_message: error_message ?? null,
        finished_at: new Date().toISOString(),
        metadata: { external: true, token: tokenInfo.name },
      });
      return json({ ok: true });
    }

    if (action === "heartbeat") {
      const body = await req.json().catch(() => ({}));
      const { worker_id, current_job_id, processed_delta = 0, failed_delta = 0 } = body;
      if (!worker_id) return json({ error: "worker_id required" }, 400);
      await supabase.rpc("record_worker_heartbeat", {
        _worker_id: worker_id,
        _worker_type: "external",
        _current_job_id: current_job_id ?? null,
        _processed_delta: processed_delta,
        _failed_delta: failed_delta,
      });
      return json({ ok: true });
    }

    return json({ error: "unknown_action", supported: ["claim", "complete", "heartbeat"] }, 404);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
