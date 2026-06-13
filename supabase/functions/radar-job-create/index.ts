// Edge Function: radar-job-create
// Cria um job assíncrono que processa o Radar Político em background (chunks mensais),
// invocando radar-ai-search por chunk e acumulando eventos em radar_jobs.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

interface ReqBody {
  candidate_id: string;
  candidate_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  categories?: string[];
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Max chunks por job (mensal): 96 = 8 anos. Aumentar = mais volume, mais tempo.
const MAX_CHUNKS = 96;
// Quantos chunks rodam em paralelo. 3-4 evita estourar limites do RSS/IA.
const CONCURRENCY = 3;
// Janela máxima por chunk (em dias).
const CHUNK_DAYS = 30;

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

function dedupeEvents(events: any[]): any[] {
  const seen = new Map<string, any>();
  for (const e of events) {
    if (!e?.title) continue;
    const norm = String(e.title).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
    const month = (e.event_date ?? "").slice(0, 7);
    const key = `${month}|${norm}`;
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

async function processJob(
  jobId: string,
  body: ReqBody,
  authHeader: string,
) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const chunks = buildChunks(body.start_date, body.end_date);
  const total = chunks.length;

  console.log("RADAR RANGE", body.start_date, body.end_date);
  console.log("TOTAL CHUNKS", total);
  console.log("CHUNK PREVIEW", chunks.slice(0, 3), "...", chunks.slice(-2));

  await admin.from("radar_jobs").update({
    status: "running",
    started_at: new Date().toISOString(),
    total_chunks: total,
    progress: 0,
  }).eq("id", jobId);

  const all: any[] = [];
  let processed = 0;
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
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(fetchOne));
    for (const r of results) all.push(...r);
    processed += batch.length;

    // Dedupe parcial para reduzir tamanho do JSON acumulado
    const partial = dedupeEvents(all);
    all.length = 0;
    all.push(...partial);

    await admin.from("radar_jobs").update({
      processed_chunks: processed,
      progress: Math.round((processed / total) * 100),
      events_count: partial.length,
    }).eq("id", jobId);
  }

  const finalEvents = dedupeEvents(all);

  await admin.from("radar_jobs").update({
    status: "completed",
    progress: 100,
    processed_chunks: total,
    events_count: finalEvents.length,
    events: finalEvents,
    error: firstError,
    completed_at: new Date().toISOString(),
  }).eq("id", jobId);

  const dateList = finalEvents.map((e: any) => e.event_date).filter((d: string) => d && !isNaN(Date.parse(d))).sort();
  console.log(`[radar-job ${jobId}] done. chunks=${total} EVENTS FOUND ${finalEvents.length}`);
  console.log(`[radar-job ${jobId}] OLDEST EVENT`, dateList[0] ?? "n/a", "| NEWEST EVENT", dateList[dateList.length - 1] ?? "n/a");
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
    EdgeRuntime.waitUntil(processJob(job.id, body, authHeader).catch(async (e) => {
      console.error(`[radar-job ${job.id}] fatal:`, e);
      const admin2 = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      await admin2.from("radar_jobs").update({
        status: "failed",
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
