// Queue Scheduler — enqueues sentiment jobs for unlabeled interactions and triggers workers
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PROJECT_REF = Deno.env.get("SUPABASE_URL")!.split("//")[1].split(".")[0];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Enqueue up to 200 unlabeled interactions that are not already queued
    const { data: pending } = await sb
      .from("social_interactions")
      .select("id,candidate_id,user_id")
      .is("sentiment_label", null)
      .lt("analysis_attempts", 5)
      .not("comment_text", "is", null)
      .limit(200);

    let enqueued = 0;
    if (pending?.length) {
      // Skip ones already in queue
      const ids = pending.map((p: any) => p.id);
      const { data: existing } = await sb
        .from("analysis_jobs")
        .select("related_id")
        .in("related_id", ids)
        .in("status", ["queued", "leased", "running"]);
      const have = new Set((existing || []).map((e: any) => e.related_id));
      const toInsert = pending
        .filter((p: any) => !have.has(p.id))
        .map((p: any) => ({
          job_type: "sentiment",
          payload: { interaction_id: p.id },
          related_id: p.id,
          candidate_id: p.candidate_id,
          user_id: p.user_id,
          priority: 5,
        }));
      if (toInsert.length) {
        await sb.from("analysis_jobs").insert(toInsert);
        enqueued = toInsert.length;
      }
    }

    // Fan out: invoke sentiment worker N times
    const workers = 3;
    const url = `https://${PROJECT_REF}.supabase.co/functions/v1/sentiment-worker`;
    await Promise.all(
      Array.from({ length: workers }).map(() =>
        fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        }).catch(() => null),
      ),
    );

    // Snapshot metric
    await sb.from("pipeline_metrics").insert([
      { metric_name: "scheduler.enqueued", metric_value: enqueued },
      { metric_name: "scheduler.workers_invoked", metric_value: workers },
    ]);

    return new Response(JSON.stringify({ enqueued, workers }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
