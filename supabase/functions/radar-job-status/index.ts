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
    let jobId = url.searchParams.get("job_id");
    if (!jobId && (req.method === "POST")) {
      const body = await req.json().catch(() => ({}));
      jobId = body?.job_id;
    }
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

    // Suportar 10k+ eventos: PostgREST limita 1000 por request → paginação manual.
    const eventLimit = data.status === "completed" ? 15_000 : 2_000;
    const PAGE = 1000;
    const collected: any[] = [];
    for (let offset = 0; offset < eventLimit; offset += PAGE) {
      const { data: page, error: eventsError } = await client
        .from("radar_job_events")
        .select("event_data")
        .eq("job_id", jobId)
        .order("event_date", { ascending: false, nullsFirst: false })
        .order("importance", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (eventsError) {
        return new Response(JSON.stringify({ error: eventsError.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!page || page.length === 0) break;
      for (const row of page) if (row?.event_data) collected.push(row.event_data);
      if (page.length < PAGE) break;
    }

    const payload: any = { ...data };
    payload.events = collected;
    payload.partial = data.status !== "completed";
    payload.events_limit = eventLimit;

    return new Response(JSON.stringify(payload), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
