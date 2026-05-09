// Export Worker — processes export_jobs (CSV/JSON), uploads to private storage,
// returns signed URL valid for 24h. Idempotent and resumable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows: any[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => csvEscape(r[h])).join(","));
  return lines.join("\n");
}

async function fetchResource(resource: string, userId: string, filters: any): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q: any = sb.from(resource).select("*").eq("user_id", userId).range(from, from + PAGE - 1);
    if (filters?.candidate_id) q = q.eq("candidate_id", filters.candidate_id);
    if (filters?.since) q = q.gte("created_at", filters.since);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE || all.length >= 50000) break; // hard cap
    from += PAGE;
  }
  return all;
}

async function processJob(job: any) {
  await sb.from("export_jobs").update({ status: "processing", progress: 10 }).eq("id", job.id);
  try {
    const rows = await fetchResource(job.resource, job.user_id, job.filters || {});
    await sb.from("export_jobs").update({ progress: 60 }).eq("id", job.id);

    let body: string | Uint8Array;
    let mime = "text/plain";
    let ext = "txt";
    if (job.export_type === "csv") { body = toCSV(rows); mime = "text/csv"; ext = "csv"; }
    else if (job.export_type === "json") { body = JSON.stringify(rows, null, 2); mime = "application/json"; ext = "json"; }
    else { body = toCSV(rows); mime = "text/csv"; ext = "csv"; } // xlsx/pdf TODO

    const path = `${job.user_id}/${job.id}.${ext}`;
    const up = await sb.storage.from("exports").upload(path, new Blob([body], { type: mime }), { upsert: true, contentType: mime });
    if (up.error) throw up.error;

    const signed = await sb.storage.from("exports").createSignedUrl(path, 60 * 60 * 24);
    if (signed.error) throw signed.error;

    await sb.from("export_jobs").update({
      status: "succeeded",
      progress: 100,
      storage_path: path,
      download_url: signed.data.signedUrl,
      download_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      rows_exported: rows.length,
      file_size_bytes: typeof body === "string" ? new TextEncoder().encode(body).length : body.byteLength,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
  } catch (e: any) {
    await sb.from("export_jobs").update({
      status: "failed",
      error_message: e?.message || String(e),
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { data: jobs } = await sb.from("export_jobs").select("*").eq("status", "queued").order("created_at").limit(5);
    if (!jobs?.length) return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    await Promise.all(jobs.map(processJob));
    return new Response(JSON.stringify({ processed: jobs.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
