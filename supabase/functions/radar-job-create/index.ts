// Edge Function: radar-job-create
// Cria um job assíncrono que processa o Radar Político em background (chunks mensais),
// invocando radar-ai-search por chunk e salvando eventos incrementalmente.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

interface ReqBody {
  candidate_id?: string;
  candidate_name?: string;
  start_date?: string; // YYYY-MM-DD
  end_date?: string;
  categories?: string[];
}

interface RadarJobRow {
  id: string;
  user_id: string;
  candidate_id: string;
  candidate_name: string;
  start_date: string;
  end_date: string;
  categories: string[];
  processed_chunks: number;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Max chunks por job (mensal): 96 = 8 anos. Aumentar = mais volume, mais tempo.
const MAX_CHUNKS = 96;
// Quantos chunks rodam em paralelo. 3-4 evita estourar limites do RSS/IA.
const CONCURRENCY = 3;
// Janela máxima por chunk (em dias).
const CHUNK_DAYS = 30;
const BATCH_SIZE = 200;
const MAX_RUNTIME = 120_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildChunks(start: string, end: string): Array<{ start_date: string; end_date: string }> {
  const startD = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T23:59:59Z`);
  const out: Array<{ start_date: string; end_date: string }> = [];
  // Avançamos de trás para frente (mais recente primeiro): UX melhor.
  let cursorEnd = new Date(endD);
  while (cursorEnd >= startD && out.length < MAX_CHUNKS) {
    const cursorStart = new Date(cursorEnd);
    cursorStart.setUTCDate(cursorStart.getUTCDate() - (CHUNK_DAYS - 1));
    const realStart = cursorStart < startD ? startD : cursorStart;
    out.push({ start_date: ymd(realStart), end_date: ymd(cursorEnd) });
    cursorEnd = new Date(realStart);
    cursorEnd.setUTCDate(cursorEnd.getUTCDate() - 1);
  }
  return out;
}

function normalizeKey(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function eventHash(e: any): string {
  const month = String(e?.event_date ?? "").slice(0, 7) || "unknown";
  const title = normalizeKey(e?.title).split(" ").filter((t) => t.length > 2).slice(0, 14).join(" ");
  return `${month}|${title || normalizeKey(e?.summary).slice(0, 120)}`.slice(0, 220);
}

function dedupeEvents(events: any[]): any[] {
  const seen = new Map<string, any>();
  for (const e of events) {
    if (!e?.title) continue;
    const key = eventHash(e);
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, e);
    } else {
      // mantém o de maior importância e mescla sources
      const merged = (prev.importance ?? 0) >= (e.importance ?? 0) ? prev : e;
      const otherSources = (prev === merged ? e.sources : prev.sources) ?? [];
      merged.sources = [...(merged.sources ?? []), ...otherSources].slice(0, 12);
      seen.set(key, merged);
    }
  }
  return [...seen.values()];
}

async function saveEventsBatch(admin: any, jobId: string, userId: string, events: any[], offset: number) {
  const deduped = dedupeEvents(events);
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const rows = deduped.slice(i, i + BATCH_SIZE).map((event, index) => ({
      job_id: jobId,
      user_id: userId,
      event_hash: eventHash(event),
      event_index: offset + i + index,
      event_date: event?.event_date && !isNaN(Date.parse(event.event_date)) ? event.event_date : null,
      importance: Math.max(0, Math.min(100, Math.round(Number(event?.importance ?? 0) || 0))),
      event_data: event,
    })).filter((row) => row.event_hash);
    if (rows.length === 0) continue;
    const { error } = await admin
      .from("radar_job_events")
      .upsert(rows, { onConflict: "job_id,event_hash" });
    if (error) throw error;
  }
}

async function getEventsCount(admin: any, jobId: string): Promise<number> {
  const { count, error } = await admin
    .from("radar_job_events")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  if (error) throw error;
  return count ?? 0;
}

function progressFor(processed: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

async function processJob(
  jobId: string,
  body: ReqBody & { user_id: string },
  authHeader: string,
) {
  console.time("TOTAL_RADAR");
  const started = Date.now();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const chunks = buildChunks(body.start_date!, body.end_date!);
  const total = chunks.length;
  let processed = Math.max(0, Math.min(total, Number((body as any).processed_chunks ?? 0) || 0));

  console.log("RADAR RANGE", body.start_date, body.end_date);
  console.log("TOTAL CHUNKS", total);
  console.log("CHUNK PREVIEW", chunks.slice(0, 3), "...", chunks.slice(-2));

  await admin.from("radar_jobs").update({
    status: "running",
    started_at: new Date().toISOString(),
    total_chunks: total,
    progress: progressFor(processed, total),
  }).eq("id", jobId);

  let firstError: string | null = null;

  const fetchOne = async (chunk: { start_date: string; end_date: string }) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/radar-ai-search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
          "apikey": SERVICE_ROLE,
        },
        body: JSON.stringify({
          candidate_id: body.candidate_id,
          candidate_name: body.candidate_name,
          start_date: chunk.start_date,
          end_date: chunk.end_date,
          categories: body.categories ?? [],
          force_refresh: false,
        }),
        signal: AbortSignal.timeout(65_000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn(`[radar-job ${jobId}] chunk ${chunk.start_date}->${chunk.end_date} HTTP ${res.status}: ${txt.slice(0, 200)}`);
        return [];
      }
      const data = await res.json().catch(() => null);
      return Array.isArray(data?.events) ? data.events : [];
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      console.warn(`[radar-job ${jobId}] chunk error:`, msg);
      if (!firstError) firstError = msg;
      return [];
    }
  };

  // Processa em lotes de CONCURRENCY
  for (let i = processed; i < chunks.length; i += CONCURRENCY) {
    if (Date.now() - started > MAX_RUNTIME) {
      const count = await getEventsCount(admin, jobId);
      const progress = progressFor(processed, total);
      console.log("progress", progress);
      await admin.from("radar_jobs").update({
        status: "completed",
        progress,
        processed_chunks: processed,
        events_count: count,
        events: null,
        error: `RADAR_TIMEOUT: resultado parcial retornado após ${Math.round((Date.now() - started) / 1000)}s`,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
      console.timeEnd("TOTAL_RADAR");
      return;
    }

    const batch = chunks.slice(i, i + CONCURRENCY);
    console.time("FETCH");
    const results = await Promise.all(batch.map(fetchOne));
    console.timeEnd("FETCH");

    console.time("CHUNK_PROCESSING");
    const batchEvents = results.flat();
    processed += batch.length;
    console.timeEnd("CHUNK_PROCESSING");

    console.time("DEDUPE");
    const partial = dedupeEvents(batchEvents);
    console.timeEnd("DEDUPE");

    console.time("SCORING");
    partial.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    console.timeEnd("SCORING");

    console.time("CACHE_SAVE");
    await saveEventsBatch(admin, jobId, body.user_id, partial, i * 1000);
    const count = await getEventsCount(admin, jobId);
    const progress = progressFor(processed, total);
    await admin.from("radar_jobs").update({
      processed_chunks: processed,
      progress,
      events_count: count,
    }).eq("id", jobId);
    console.timeEnd("CACHE_SAVE");
    console.log("progress", progress);
  }

  const finalCount = await getEventsCount(admin, jobId);

  await admin.from("radar_jobs").update({
    status: "completed",
    progress: 100,
    processed_chunks: total,
    events_count: finalCount,
    events: null,
    error: firstError,
    completed_at: new Date().toISOString(),
  }).eq("id", jobId);

  const { data: oldest } = await admin.from("radar_job_events").select("event_date").eq("job_id", jobId).not("event_date", "is", null).order("event_date", { ascending: true }).limit(1).maybeSingle();
  const { data: newest } = await admin.from("radar_job_events").select("event_date").eq("job_id", jobId).not("event_date", "is", null).order("event_date", { ascending: false }).limit(1).maybeSingle();
  console.log(`[radar-job ${jobId}] done. chunks=${total} EVENTS FOUND ${finalCount}`);
  console.log(`[radar-job ${jobId}] OLDEST EVENT`, oldest?.event_date ?? "n/a", "| NEWEST EVENT", newest?.event_date ?? "n/a");
  console.timeEnd("TOTAL_RADAR");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body?.candidate_id || !body?.candidate_name || !body?.start_date || !body?.end_date) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: job, error: insErr } = await admin.from("radar_jobs").insert({
      user_id: user.id,
      candidate_id: body.candidate_id,
      candidate_name: body.candidate_name,
      start_date: body.start_date,
      end_date: body.end_date,
      categories: body.categories ?? [],
      status: "queued",
    }).select("id").single();

    if (insErr || !job) {
      return new Response(JSON.stringify({ error: insErr?.message ?? "insert_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Background: continua processando depois da resposta
    // @ts-ignore EdgeRuntime existe em Supabase Edge Functions
    EdgeRuntime.waitUntil(processJob(job.id, { ...body, user_id: user.id }, authHeader).catch(async (e) => {
      console.error(`[radar-job ${job.id}] fatal:`, e);
      const admin2 = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      await admin2.from("radar_jobs").update({
        status: "completed",
        error: (e as Error)?.message ?? String(e),
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
    }));

    return new Response(JSON.stringify({ job_id: job.id, status: "queued" }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
