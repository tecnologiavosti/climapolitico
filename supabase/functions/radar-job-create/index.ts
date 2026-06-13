// Edge Function: radar-job-create
// Cria um job assíncrono que processa o Radar Político em background (chunks mensais),
// invocando radar-ai-search por chunk e salvando eventos incrementalmente.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

interface ReqBody {
  resume_job_id?: string;
  candidate_id?: string;
  candidate_name?: string;
  start_date?: string; // YYYY-MM-DD
  end_date?: string;
  categories?: string[];
  sort?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Max chunks por job (mensal): 96 = 8 anos. Aumentar = mais volume, mais tempo.
const MAX_CHUNKS = 96;
// Quantos chunks rodam por lote. Sem IA por chunk, 6 acelera sem estourar CPU/rede.
const CONCURRENCY = 6;
// Janela máxima por chunk (em dias).
const CHUNK_DAYS = 30;
const BATCH_SIZE = 200;
const MAX_RUNTIME = 130_000;
const BATCH_GUARD_MS = 20_000;
const DB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function hashPeriod(body: Pick<ReqBody, "candidate_id" | "candidate_name" | "start_date" | "end_date" | "categories" | "sort">): string {
  const cats = [...(body.categories ?? [])].sort().join(",");
  return `radar-v8|${body.candidate_id ?? "all"}|${body.candidate_name}|${body.start_date}|${body.end_date}|${cats}|${body.sort ?? "importance"}`;
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

async function completePartial(admin: any, jobId: string, processed: number, total: number, reason: string) {
  const count = await getEventsCount(admin, jobId);
  const progress = progressFor(processed, total);
  console.log("progress", progress);
  await admin.from("radar_jobs").update({
    status: "completed",
    progress,
    processed_chunks: processed,
    events_count: count,
    events: null,
    error: reason,
    completed_at: new Date().toISOString(),
  }).eq("id", jobId);
}

async function readCacheFirstPage(admin: any, userId: string, periodHash: string, body: ReqBody) {
  const { data } = await admin
    .from("radar_cache")
    .select("response_json,event_count,created_at")
    .eq("user_id", userId)
    .eq("period_hash", periodHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const events = Array.isArray(data?.response_json) ? data.response_json.slice(0, 50) : [];
  if (events.length === 0) return null;
  const { data: recentJob } = await admin
    .from("radar_jobs")
    .select("id,status,events_count")
    .eq("user_id", userId)
    .eq("candidate_id", body.candidate_id)
    .eq("start_date", body.start_date)
    .eq("end_date", body.end_date)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { events, event_count: data?.event_count ?? recentJob?.events_count ?? events.length, cached_at: data?.created_at, job_id: recentJob?.id ?? null };
}

async function saveCacheSnapshot(admin: any, jobId: string, body: ReqBody & { user_id: string }) {
  let query = admin
    .from("radar_job_events")
    .select("event_data")
    .eq("job_id", jobId)
  if (body.sort === "date") query = query.order("event_date", { ascending: false, nullsFirst: false }).order("importance", { ascending: false });
  else query = query.order("importance", { ascending: false }).order("event_date", { ascending: false, nullsFirst: false });
  const { data: rows } = await query.range(0, 999);
  const events = (rows ?? []).map((row: any) => row?.event_data).filter(Boolean);
  if (events.length === 0) return;
  await admin.from("radar_cache").upsert({
    user_id: body.user_id,
    candidate_id: body.candidate_id ?? null,
    candidate_name: body.candidate_name,
    period_hash: hashPeriod(body),
    start_date: body.start_date,
    end_date: body.end_date,
    categories: body.categories ?? [],
    response_json: events,
    event_count: await getEventsCount(admin, jobId),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + DB_CACHE_TTL_MS).toISOString(),
  }, { onConflict: "user_id,period_hash" });
}

async function scheduleContinuation(jobId: string, authHeader: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/radar-job-create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "apikey": SERVICE_ROLE,
      },
      body: JSON.stringify({ resume_job_id: jobId }),
      signal: AbortSignal.timeout(5_000),
    });
    const ok = res.ok;
      const txt = await res.text().catch(() => "");
      if (!ok) {
        const retry = Number(txt.match(/Retry after\s+(\d+)ms/i)?.[1] ?? 0);
        console.warn(`[radar-job ${jobId}] continuation HTTP ${res.status}: ${txt.slice(0, 180)}`);
        if (res.status === 429 && attempt < 3) {
          await sleep(Math.max(1_500, Math.min(20_000, retry || 2_500 * (attempt + 1))));
          continue;
        }
      }
    return ok;
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      console.warn(`[radar-job ${jobId}] continuation failed`, msg);
      const retry = Number(msg.match(/Retry after\s+(\d+)ms/i)?.[1] ?? 0);
      if (attempt < 3) await sleep(Math.max(1_500, Math.min(20_000, retry || 2_500 * (attempt + 1))));
    }
  }
  return false;
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
  console.log("progress", progressFor(processed, total));

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
          skip_ai: true, // chunks usam modo heurístico para não estourar rate limit da IA
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
    const batchIndex = Math.floor(i / CONCURRENCY) + 1;
    const elapsed = Date.now() - started;
    if (elapsed > MAX_RUNTIME || elapsed + BATCH_GUARD_MS > MAX_RUNTIME) {
      const continued = await scheduleContinuation(jobId, authHeader);
      if (!continued) {
        const count = await getEventsCount(admin, jobId);
        await admin.from("radar_jobs").update({
          status: "running",
          processed_chunks: processed,
          progress: progressFor(processed, total),
          events_count: count,
          error: `Continuação pausada por limite temporário; será retomada no próximo polling (${Math.round(elapsed / 1000)}s)`,
        }).eq("id", jobId);
      }
      console.timeEnd("TOTAL_RADAR");
      return;
    }

    const batch = chunks.slice(i, i + CONCURRENCY);
    console.log("BATCH", batchIndex);
    console.time("FETCH");
    const results = await Promise.all(batch.map(fetchOne));
    console.timeEnd("FETCH");

    console.time("CHUNK_PROCESSING");
    const batchEvents = results.flat();
    console.log("EVENTS PARTIAL", batchEvents.length);
    console.log("IA CALL COUNT", 0);
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
    await saveCacheSnapshot(admin, jobId, body);
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
  await saveCacheSnapshot(admin, jobId, body);

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
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    if (body?.resume_job_id) {
      const { data: existing, error: jobErr } = await admin
        .from("radar_jobs")
        .select("id,user_id,candidate_id,candidate_name,start_date,end_date,categories,processed_chunks,status")
        .eq("id", body.resume_job_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (jobErr || !existing) {
        return new Response(JSON.stringify({ error: jobErr?.message ?? "job_not_found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (existing.status === "completed" || existing.status === "failed") {
        return new Response(JSON.stringify({ job_id: existing.id, status: existing.status }), {
          status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // @ts-ignore EdgeRuntime existe em Supabase Edge Functions
      EdgeRuntime.waitUntil(processJob(existing.id, {
        user_id: user.id,
        candidate_id: existing.candidate_id,
        candidate_name: existing.candidate_name,
        start_date: existing.start_date,
        end_date: existing.end_date,
        categories: Array.isArray(existing.categories) ? existing.categories : [],
        processed_chunks: existing.processed_chunks,
      } as any, authHeader));

      return new Response(JSON.stringify({ job_id: existing.id, status: "running" }), {
        status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body?.candidate_id || !body?.candidate_name || !body?.start_date || !body?.end_date) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const periodHash = hashPeriod(body);
    const cached = await readCacheFirstPage(admin, user.id, periodHash, body);
    console.log("CACHE HIT", !!cached);
    if (cached) {
      return new Response(JSON.stringify({
        status: "cached",
        cached: true,
        job_id: cached.job_id,
        events: cached.events,
        events_count: cached.event_count,
        cached_at: cached.cached_at,
      }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: active } = await admin
      .from("radar_jobs")
      .select("id,status,events_count")
      .eq("user_id", user.id)
      .eq("candidate_id", body.candidate_id)
      .eq("start_date", body.start_date)
      .eq("end_date", body.end_date)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active?.id) {
      return new Response(JSON.stringify({ job_id: active.id, status: active.status, events_count: active.events_count ?? 0 }), {
        status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
