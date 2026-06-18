// Historical Social Index collector.
// Única função autorizada a fazer coleta externa para a aba Visão por Rede Social.
// Stack 100% gratuita: Google News RSS, Reddit JSON, YouTube Data API, Nitter.
// Redes sem API gratuita confiável (TikTok, Instagram, Facebook, Telegram) marcam status "unavailable".

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { collectByNetwork, type FreeResult } from "../_shared/free-collectors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SOURCE_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 2;
const MAX_CANDIDATES_PER_RUN = 25;
const SOURCE_CACHE_TTL_MS = 12 * 60 * 60_000;

type Network = "twitter" | "youtube" | "facebook" | "instagram" | "tiktok" | "telegram" | "reddit" | "news";
type RunStatus = "queued" | "running" | "completed" | "failed";

interface SearchHit {
  url?: string;
  title?: string;
  description?: string;
  source?: string;
  date?: string;
}

interface CollectInput {
  mode?: "daily" | "on_demand" | "backfill" | "status";
  run_id?: string;
  parent_job_id?: string | null;
  candidate_id?: string | null;
  candidate_name?: string;
  party?: string | null;
  state?: string | null;
  network?: Network | "all";
  start_date?: string;
  end_date?: string;
  lookback_days?: number;
  force_refresh?: boolean;
}

interface SourceTask {
  source: string;
  sourceName: string;
  net: Network;
  q: string;
  priority: number;
}

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function daysBetween(a: string, b: string) {
  return Math.max(1, Math.ceil((Date.parse(b) - Date.parse(a)) / 86_400_000));
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function buildBackfillChunks(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);
  const days = daysBetween(startDate, endDate);
  const chunks: Array<{ start: string; end: string }> = [];

  if (days <= 90) {
    chunks.push({ start: startDate, end: endDate });
    return chunks;
  }

  // Spec: 1a → 12 mensais · 4a → 16 trimestrais · 8a → 32 trimestrais
  const target = days <= 370 ? 12 : days <= 1500 ? 16 : 32;
  const stepMonths = days <= 370 ? 1 : 3; // mensal para 1a, trimestral para 4a+/8a
  let cursor = start;
  while (cursor <= end && chunks.length < target) {
    const nextStart = addUtcMonths(cursor, stepMonths);
    const chunkEnd = new Date(Math.min(nextStart.getTime() - 1, end.getTime()));
    chunks.push({ start: isoDay(cursor), end: isoDay(chunkEnd) });
    cursor = nextStart;
  }
  return chunks;
}

function buildSingleChunk(input: CollectInput): Array<{ start: string; end: string }> {
  if (input.start_date && input.end_date) return [{ start: input.start_date, end: input.end_date }];
  const lookback = Math.max(1, Math.min(365, input.lookback_days ?? 2));
  const end = new Date();
  const start = new Date(Date.now() - lookback * 86_400_000);
  return [{ start: isoDay(start), end: isoDay(end) }];
}

function buildTasks(input: CollectInput, _startDate: string, _endDate: string): SourceTask[] {
  const base = `${input.candidate_name} ${[input.party, input.state].filter(Boolean).join(" ")}`.trim();
  const tasks: SourceTask[] = [
    { source: "google_news", sourceName: "Google News", net: "news", priority: 1, q: `${base} política` },
    { source: "youtube", sourceName: "YouTube", net: "youtube", priority: 2, q: base },
    { source: "reddit", sourceName: "Reddit", net: "reddit", priority: 3, q: base },
    { source: "twitter", sourceName: "X / Twitter", net: "twitter", priority: 4, q: base },
    { source: "telegram", sourceName: "Telegram", net: "telegram", priority: 5, q: base },
    { source: "tiktok", sourceName: "TikTok", net: "tiktok", priority: 6, q: base },
    { source: "facebook", sourceName: "Facebook", net: "facebook", priority: 7, q: base },
    { source: "instagram", sourceName: "Instagram", net: "instagram", priority: 8, q: base },
    { source: "blogs", sourceName: "Blogs políticos", net: "news", priority: 9, q: `${base} blog opinião` },
    { source: "portais_regionais", sourceName: "Portais regionais", net: "news", priority: 10, q: `${base} ${input.state ?? "Brasil"} jornal portal` },
  ];
  const wantAll = !input.network || input.network === "all";
  return tasks
    .filter((t) => wantAll || t.net === input.network)
    .sort((a, b) => a.priority - b.priority);
}

async function runLimited<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDate(d?: string, fallbackDate?: string): string | null {
  if (d && Number.isFinite(Date.parse(d))) return new Date(d).toISOString();
  return fallbackDate ? `${fallbackDate}T12:00:00Z` : null;
}

function extractHashtags(text: string): string[] {
  return Array.from(new Set((text.match(/#[\p{L}0-9_]{3,}/gu) ?? []).map((s) => s.toLowerCase()))).slice(0, 20);
}

function extractEntities(text: string, candidateName: string): string[] {
  const entities = new Set<string>();
  const candidate = candidateName.trim();
  if (candidate) entities.add(candidate);
  for (const token of text.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]+){0,3}/gu) ?? []) {
    const clean = token.trim();
    if (clean.length >= 4 && !/^(Google News|YouTube|Twitter|Facebook|Instagram|Reddit|Telegram|TikTok)$/i.test(clean)) entities.add(clean);
  }
  return [...entities].slice(0, 20);
}

function extractThemes(text: string): string[] {
  const themes = new Set<string>();
  const rules: Array<[RegExp, string]> = [
    [/\b(sa[uú]de|hospital|vacina|covid)\b/i, "saúde pública"],
    [/\b(seguran[cç]a|pol[ií]cia|crime|viol[eê]ncia)\b/i, "segurança pública"],
    [/\b(agro|agroneg[oó]cio|campo|rural)\b/i, "agronegócio"],
    [/\b(infraestrutura|obra|rodovia|transporte)\b/i, "infraestrutura"],
    [/\b(eleic|campanha|presidenci[aá]vel|candidato)\b/i, "disputa eleitoral"],
    [/\b(STF|TSE|Congresso|Senado|C[aâ]mara)\b/, "instituições"],
  ];
  for (const [re, label] of rules) if (re.test(text)) themes.add(label);
  return [...themes].slice(0, 8);
}

function sentimentFromText(text: string): { score: number; label: "positive" | "negative" | "neutral" } {
  const pos = (text.match(/\b(apoio|aprova|elogia|vit[oó]ria|lidera|avan[cç]o|positivo|forte|cresce)\b/gi) ?? []).length;
  const neg = (text.match(/\b(cr[ií]tica|den[uú]ncia|investiga|rejei[cç][aã]o|derrota|esc[aâ]ndalo|negativo|queda|suspeita)\b/gi) ?? []).length;
  const score = Math.max(-100, Math.min(100, (pos - neg) * 25));
  return { score, label: score > 0 ? "positive" : score < 0 ? "negative" : "neutral" };
}

function statusFromHttp(status: number) {
  if (status === 402) return "insufficient_credits";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  return "error";
}

async function getSourceCache(admin: any, key: string): Promise<SearchHit[] | null> {
  const { data } = await admin
    .from("analysis_cache")
    .select("result,expires_at")
    .eq("cache_key", key)
    .eq("analysis_type", "historical_social_source")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const hits = (data?.result as any)?.hits;
  return Array.isArray(hits) ? hits : null;
}

async function setSourceCache(admin: any, key: string, hits: SearchHit[], provider: string) {
  await admin.from("analysis_cache").upsert({
    cache_key: key,
    analysis_type: "historical_social_source",
    result: { hits },
    provider,
    expires_at: new Date(Date.now() + SOURCE_CACHE_TTL_MS).toISOString(),
    last_hit_at: new Date().toISOString(),
  }, { onConflict: "cache_key" });
}

async function searchSource(admin: any, task: SourceTask, startDate: string, endDate: string, forceRefresh = false): Promise<FreeResult & { provider: string }> {
  const cacheKey = `hsi-free-v1|${normalizeText(task.q)}|${task.source}|${startDate}|${endDate}`;
  if (!forceRefresh) {
    const cached = await getSourceCache(admin, cacheKey).catch(() => null);
    if (cached) return { hits: cached, status: cached.length ? "cached" : "cached_empty", provider: `free:${task.source}` };
  }
  try {
    const result = await collectByNetwork(task.net, task.q, startDate, endDate, admin);
    if (["ok", "empty"].includes(result.status)) {
      await setSourceCache(admin, cacheKey, result.hits, `free:${task.source}`).catch(() => {});
    } else {
      console.warn("[historical-social-collector] source_failed", task.source, result.status, result.error ?? "");
    }
    return { ...result, provider: `free:${task.source}` };
  } catch (e: any) {
    return { hits: [], status: "error", error: e?.message ?? String(e), provider: `free:${task.source}` };
  }
}


async function updateRun(admin: any, runId: string, patch: Record<string, unknown>) {
  await admin.from("historical_social_collector_runs").update(patch).eq("id", runId);
}

async function updateParentJob(admin: any, parentJobId: string | null | undefined, patch: Record<string, unknown>) {
  if (!parentJobId) return;
  await admin.from("social_analytics_jobs").update(patch).eq("id", parentJobId);
}

function buildRows(input: CollectInput, task: SourceTask, hits: SearchHit[], chunkEnd: string) {
  const normalizedName = normalizeText(input.candidate_name);
  const rows: any[] = [];
  for (const h of hits) {
    const text = `${h.title ?? ""} ${h.description ?? ""}`.trim();
    if (!text) continue;
    if (/\b(cassino|bet|promo[cç][aã]o|cupom|porn|download gr[aá]tis)\b/i.test(text)) continue;
    const mentionDate = parseDate(h.date, chunkEnd);
    const sentiment = sentimentFromText(text);
    const dedupeSource = `${h.url ?? ""}|${h.title ?? ""}|${task.source}|${normalizedName}`;
    rows.push({
      candidate_id: input.candidate_id ?? null,
      candidate_name: input.candidate_name,
      candidate_name_normalized: normalizedName,
      source: task.source,
      source_name: task.sourceName,
      source_url: h.url ?? null,
      network: task.net,
      url: h.url ?? null,
      title: (h.title ?? "").slice(0, 500),
      content: (h.description ?? "").slice(0, 2000),
      date: mentionDate,
      mention_date: mentionDate,
      interactions: Number(h.interactions ?? 0),
      engagement: Number(h.interactions ?? 0),
      sentiment: sentiment.score,
      sentiment_label: sentiment.label,
      author: h.author ?? null,
      entities: extractEntities(text, input.candidate_name ?? ""),
      hashtags: extractHashtags(text),
      themes: extractThemes(text),
      topics: extractThemes(text),
      raw: { provider: `free:${task.source}`, date_inferred_from_query_window: !h.date, source_priority: task.priority, author: h.author ?? null },
      source_key: `${normalizedName}:${task.source}:${normalizeText(dedupeSource).slice(0, 220)}`,
      collected_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function persistRows(admin: any, rows: any[]) {
  if (!rows.length) return 0;
  const { data, error } = await admin
    .from("historical_social_mentions")
    .upsert(rows, { onConflict: "candidate_name_normalized,source_key", ignoreDuplicates: true })
    .select("id");
  if (!error) return data?.length ?? rows.length;

  console.warn("[historical-social-collector] bulk_upsert_failed", error.message);
  let inserted = 0;
  for (const row of rows) {
    const { error: e2 } = await admin.from("historical_social_mentions").upsert(row, { onConflict: "candidate_name_normalized,source_key", ignoreDuplicates: true });
    if (!e2) inserted += 1;
  }
  return inserted;
}

async function collectForCandidate(admin: any, input: CollectInput) {
  if (!input.candidate_name) throw new Error("candidate_name obrigatório");
  const mode = input.mode === "backfill" ? "backfill" : "on_demand";
  const chunks = mode === "backfill" && input.start_date && input.end_date
    ? buildBackfillChunks(input.start_date, input.end_date)
    : buildSingleChunk(input);

  const { data: run, error: runError } = await admin.from("historical_social_collector_runs").insert({
    job_id: input.parent_job_id ?? null,
    candidate_id: input.candidate_id ?? null,
    candidate_name: input.candidate_name,
    status: "running" satisfies RunStatus,
    current_chunk: 0,
    total_chunks: chunks.length,
    mentions_found: 0,
    inserted_count: 0,
    source_count: 0,
    started_at: new Date().toISOString(),
  }).select("id").single();
  if (runError || !run?.id) throw new Error(runError?.message ?? "collector_run_insert_failed");
  const runId = run.id;

  let inserted = 0;
  let totalHits = 0;
  let sourceOk = 0;
  const sourceStatuses: any[] = [];

  try {
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const progress = Math.min(95, Math.round(((i + 1) / chunks.length) * 92));
      await updateRun(admin, runId, { current_chunk: i + 1, total_chunks: chunks.length, mentions_found: totalHits, status: "running" });
      await updateParentJob(admin, input.parent_job_id, {
        progress: Math.min(68, 12 + Math.round(((i + 1) / chunks.length) * 52)),
        stage: `Coletando histórico... Janela ${i + 1}/${chunks.length} · ${totalHits.toLocaleString("pt-BR")} menções encontradas`,
      });

      const tasks = buildTasks(input, chunk.start, chunk.end);
      const results = await runLimited(tasks, MAX_CONCURRENT, async (task) => ({ task, result: await firecrawlSearch(admin, task, chunk.start, chunk.end, input.force_refresh === true) }));
      const rows: any[] = [];
      for (const { task, result } of results) {
        if (["ok", "cached"].includes(result.status) && result.hits.length > 0) sourceOk += 1;
        totalHits += result.hits.length;
        sourceStatuses.push({ chunk: i + 1, source: task.source, network: task.net, status: result.status, hits: result.hits.length, error: result.error ?? null });
        rows.push(...buildRows(input, task, result.hits, chunk.end));
      }
      inserted += await persistRows(admin, rows);
      await updateRun(admin, runId, { current_chunk: i + 1, mentions_found: totalHits, inserted_count: inserted, source_count: sourceOk });
      console.log("[historical-social-collector] chunk_done", JSON.stringify({ run_id: runId, candidate: input.candidate_name, chunk: i + 1, total_chunks: chunks.length, hits: rows.length, inserted }));
      if (progress < 95) await sleep(250);
    }

    await updateRun(admin, runId, {
      status: "completed" satisfies RunStatus,
      inserted_count: inserted,
      source_count: sourceOk,
      mentions_found: totalHits,
      finished_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    await updateParentJob(admin, input.parent_job_id, { stage: `Backfill histórico concluído · ${totalHits.toLocaleString("pt-BR")} menções encontradas` });
    return { run_id: runId, inserted, source_count: sourceOk, total_hits: totalHits, total_chunks: chunks.length, source_statuses: sourceStatuses };
  } catch (e: any) {
    await updateRun(admin, runId, { status: "failed" satisfies RunStatus, error: e?.message ?? String(e), finished_at: new Date().toISOString(), completed_at: new Date().toISOString() });
    throw e;
  }
}

async function collectDaily(admin: any) {
  const { data: candidates } = await admin
    .from("candidates")
    .select("id,full_name,party,region")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(MAX_CANDIDATES_PER_RUN);

  const summary: any[] = [];
  for (const c of candidates ?? []) {
    try {
      const r = await collectForCandidate(admin, {
        mode: "on_demand",
        candidate_id: c.id,
        candidate_name: c.full_name,
        party: c.party,
        state: c.region,
        lookback_days: 2,
      });
      summary.push({ candidate: c.full_name, ...r });
    } catch (e: any) {
      summary.push({ candidate: c.full_name, error: e?.message ?? String(e) });
    }
  }
  return { mode: "daily", processed: summary.length, summary };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: CollectInput = {};
  try { body = await req.json(); } catch { body = {}; }

  try {
    if (body.mode === "status" && body.run_id) {
      const { data, error } = await admin
        .from("historical_social_collector_runs")
        .select("*")
        .eq("id", body.run_id)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, run: data });
    }

    if (body.candidate_name) {
      if (body.parent_job_id && (body.mode === "backfill" || body.mode === "on_demand")) {
        // @ts-ignore EdgeRuntime existe em Edge Functions
        EdgeRuntime.waitUntil(collectForCandidate(admin, body));
        return json({ ok: true, mode: body.mode, status: "processing" }, 202);
      }
      const result = await collectForCandidate(admin, body);
      return json({ ok: true, mode: body.mode ?? "on_demand", ...result });
    }

    const result = await collectDaily(admin);
    return json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[historical-social-collector]", e?.message ?? e);
    return json({ ok: false, error: e?.message ?? "unknown" }, 500);
  }
});