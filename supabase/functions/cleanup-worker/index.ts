// Cleanup Worker — prunes old data, dead workers, resolved alerts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    await sb.rpc("cleanup_pipeline_data");
    await sb.rpc("cleanup_old_notifications");
    await sb.from("worker_heartbeats").delete().lt("last_heartbeat_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    await sb.from("system_alerts").update({ resolved_at: new Date().toISOString() }).is("resolved_at", null).lt("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders } });
  }
});
