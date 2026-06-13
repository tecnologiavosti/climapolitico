// Edge Function: radar-job-status
// Retorna o estado atual de um radar_job (para polling do frontend).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    let jobId = url.searchParams.get("job_id") || body?.job_id;
    const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("page_size") ?? body?.page_size ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? body?.offset ?? 0) || 0);
    const sort = String(url.searchParams.get("sort") ?? body?.sort ?? "importance");
    if (!jobId) {
      return new Response(JSON.stringify({ error: "missing_job_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data, error } = await client
      .from("radar_jobs")
      .select("id,status,progress,total_chunks,processed_chunks,events_count,events,error,started_at,completed_at,created_at")
      .eq("id", jobId)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Paginação real: nunca retorna milhares de cards por polling.
    let query = client.from("radar_job_events").select("event_data").eq("job_id", jobId);
    if (sort === "date") query = query.order("event_date", { ascending: false, nullsFirst: false }).order("importance", { ascending: false });
    else query = query.order("importance", { ascending: false }).order("event_date", { ascending: false, nullsFirst: false });
    const { data: page, error: eventsError } = await query.range(offset, offset + pageSize - 1);
    if (eventsError) {
      return new Response(JSON.stringify({ error: eventsError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const collected = (page ?? []).map((row: any) => row?.event_data).filter(Boolean);

    const payload: any = { ...data };
    payload.events = collected;
    payload.partial = data.status !== "completed";
    payload.page_size = pageSize;
    payload.offset = offset;
    payload.has_more = offset + collected.length < (data.events_count ?? 0);

    return new Response(JSON.stringify(payload), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
