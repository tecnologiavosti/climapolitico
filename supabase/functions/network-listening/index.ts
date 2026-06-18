// Visão por Rede Social — visualização read-only sobre o Historical Social Index.
// Coleta externa pertence exclusivamente à função historical-social-collector.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const AI_TIMEOUT_MS = 20_000;

type Network = "twitter" | "youtube" | "facebook" | "instagram" | "tiktok" | "telegram" | "reddit" | "news" | "linkedin";

interface Body {
  action?: "create" | "status" | "start_backfill";
  job_id?: string;
  candidate_name: string;
  candidate_id?: string | null;
  party?: string | null;
  office?: string | null;
  state?: string | null;
  start_date: string;
  end_date: string;
  network?: Network | "all";
  force_refresh?: boolean;
}

interface SearchHit {
  url?: string;
  title?: string;
  description?: string;
  source?: string;
  date?: string;
  sentiment?: number | null;
  sentiment_label?: string | null;
  interactions?: number | null;
  entities?: string[];
  hashtags?: string[];
  themes?: string[];
}

interface Distribution { network: string; pct: number; mentions?: number; data_source_type?: "direct" | "proxy" | "unavailable"; direct_hits?: number; external_hits?: number }
interface Term { term: string; kind: "pessoa" | "partido" | "instituicao" | "hashtag" | "slogan" | "regiao"; count: number }
interface SourceStatus { source: string; network?: Network; batch: number; status: "ok" | "empty" | "skipped" | "error"; duration_ms: number; hits: number; error?: string }

const cache = new Map<string, { at: number; data: unknown }>();
const EMPTY_SENTIMENT = { pos: 0, neg: 0, neu: 0 };
const ALL_NETWORKS: Network[] = ["twitter", "instagram", "facebook", "youtube", "tiktok", "telegram", "reddit", "news"];

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(b: Body) {
  return `social-v6-index-readonly|${b.candidate_id ?? normalizeText(b.candidate_name)}|${b.network ?? "all"}|${b.start_date}|${b.end_date}`;
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

function ttlMs(days: number) {
  if (days <= 7) return 30 * 60_000;
  if (days <= 30) return 2 * 60 * 60_000;
  if (days <= 90) return 6 * 60 * 60_000;
  return 12 * 60 * 60_000;
}

function bucketFor(days: number): "day" | "week" | "month" | "quarter" | "semester" {
  if (days <= 30) return "day";
  if (days <= 90) return "week";
  if (days <= 365) return "month";
  if (days <= 1460) return "quarter";
  return "semester";
}

function minHistoricalHits(days: number) {
  if (days <= 7) return 1;
  if (days <= 30) return 10;
  if (days <= 90) return 20;
  if (days <= 365) return 30;
  if (days <= 1460) return 50;
  return 60;
}

// Limiar de evidência para liberar render quantitativo completo (cards/gráficos/topicos/termos).
const MIN_EVIDENCE_FOR_QUANTITATIVE = 20;

// Rotula o pipeline esperado por período.
function pipelineLabelForDays(days: number): "live_listening" | "historical_index" | "historical_archive" {
  if (days <= 90) return "live_listening";
  if (days <= 365) return "historical_index";
  return "historical_archive";
}

function computeConfidence(samples: number, sourceStatuses: SourceStatus[]): "high" | "medium" | "low" {
  const okSources = sourceStatuses.filter((s) => s.status === "ok").length;
  if (samples >= 200 || okSources >= 30) return "high";
  if (samples >= 30 || okSources >= 5 || samples >= 20) return "medium";
  return "low";
}

async function getUser(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return { user: null, authHeader };
  const client = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await client.auth.getUser();
  return { user, authHeader };
}

async function updateJob(admin: any, jobId: string, patch: Record<string, unknown>) {
  const { error } = await admin.from("social_analytics_jobs").update(patch).eq("id", jobId);
  if (error) console.warn(`[network-listening ${jobId}] update failed`, error.message);
}

function noDataReport(body: Body, sourceStatuses: SourceStatus[], reason: string, evidenceCount = 0, pipeline = "historical_index_only") {
  return {
    total_mentions: null,
    total_interactions: null,
    sentiment: EMPTY_SENTIMENT,
    net_sentiment: 0,
    net_label: "Histórico insuficiente",
    dominant_network: null,
    distribution: [],
    timeline: [],
    sentiment_by_network: [],
    topics: [],
    terms: [],
    confidence: "low" as const,
    render_state: "NO_DATA" as const,
    qualitative_only: false,
    reasoning: reason,
    evidence_count: evidenceCount,
    source_count: sourceStatuses.filter((s) => s.status === "ok").length,
    bucket: bucketFor(daysBetween(body.start_date, body.end_date)),
    sources: sourceStatuses,
    fallback: false,
    fallback_used: false,
    pipeline_used: pipeline,
    social_view_debug: {
      evidence_count: evidenceCount,
      source_count: sourceStatuses.filter((s) => s.status === "ok").length,
      pipeline_used: pipeline,
      fallback_used: false,
      confidence: "low",
    },
  };
}

function preprocessEvidence(evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const item of evidence) {
    for (const hit of item.hits) {
      const text = `${hit.title ?? ""} ${hit.description ?? ""}`.trim();
      const normalized = normalizeText(hit.url || text).slice(0, 240);
      if (!text || seen.has(normalized)) continue;
      if (/\b(cassino|bet|promo[cç][aã]o|cupom|porn|download gr[aá]tis)\b/i.test(text)) continue;
      seen.add(normalized);
      out.push(hit);
    }
  }
  return out.slice(0, 500);
}

async function loadHistoricalEvidence(admin: any, body: Body): Promise<Array<{ net: Network; source: string; hits: SearchHit[] }>> {
  const wantAll = !body.network || body.network === "all";
  let q = admin.from("historical_social_mentions")
    .select("network,source,source_name,source_url,url,title,content,mention_date,date,sentiment,sentiment_label,interactions,engagement,entities,hashtags,themes,topics")
    .eq("candidate_name_normalized", normalizeText(body.candidate_name))
    .gte("mention_date", `${body.start_date}T00:00:00Z`)
    .lte("mention_date", `${body.end_date}T23:59:59Z`)
    .order("mention_date", { ascending: false })
    .limit(2500);
  if (!wantAll) q = q.eq("network", body.network);
  const { data, error } = await q;
  if (error) {
    console.warn("[network-listening] historical_load_failed", error.message);
    return [];
  }
  const grouped = new Map<string, SearchHit[]>();
  for (const row of (data ?? []) as any[]) {
    const key = `${row.network}|${row.source_name ?? row.source}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({
      url: row.source_url ?? row.url,
      title: row.title,
      description: row.content,
      date: row.mention_date ?? row.date,
      source: row.source_name ?? row.source,
      sentiment: row.sentiment,
      sentiment_label: row.sentiment_label,
      interactions: row.interactions ?? row.engagement ?? 0,
      entities: Array.isArray(row.entities) ? row.entities : [],
      hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
      themes: Array.isArray(row.themes) ? row.themes : Array.isArray(row.topics) ? row.topics : [],
    });
  }
  return [...grouped.entries()].map(([k, hits]) => {
    const [net, source] = k.split("|");
    return { net: net as Network, source, hits };
  });
}

function buildSourceStatuses(evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>): SourceStatus[] {
  return evidence.map((e) => ({ source: `historical:${e.source}`, network: e.net, batch: 0, status: e.hits.length ? "ok" : "empty", duration_ms: 0, hits: e.hits.length }));
}

async function latestCollectorRun(admin: any, body: Body, jobId?: string) {
  let q = admin
    .from("historical_social_collector_runs")
    .select("id,job_id,status,current_chunk,total_chunks,mentions_found,inserted_count,source_count,error,started_at,completed_at,finished_at,created_at")
    .eq("candidate_name", body.candidate_name)
    .order("created_at", { ascending: false })
    .limit(1);
  if (body.candidate_id) q = q.eq("candidate_id", body.candidate_id);
  if (jobId) q = q.eq("job_id", jobId);
  const { data } = await q.maybeSingle();
  return data;
}

async function invokeCollector(body: Body, jobId: string, mode: "backfill" | "on_demand") {
  const payload = {
    mode,
    parent_job_id: jobId,
    candidate_id: body.candidate_id ?? null,
    candidate_name: body.candidate_name,
    party: body.party ?? null,
    state: body.state ?? null,
    network: body.network ?? "all",
    start_date: body.start_date,
    end_date: body.end_date,
    force_refresh: body.force_refresh === true,
  };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/historical-social-collector`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(145_000),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!(r.ok || r.status === 202) || data?.ok === false) throw new Error(data?.error ?? `collector_${r.status}`);
  return data;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    total_mentions: { type: "number" },
    total_interactions: { type: "number" },
    sentiment: { type: "object", properties: { pos: { type: "number" }, neg: { type: "number" }, neu: { type: "number" } }, required: ["pos", "neg", "neu"] },
    net_sentiment: { type: "number" },
    net_label: { type: "string" },
    dominant_network: { type: "string" },
    topics: { type: "array", items: { type: "object", properties: { label: { type: "string" }, mentions: { type: "number" }, pos: { type: "number" }, neg: { type: "number" }, neu: { type: "number" } }, required: ["label", "mentions"] } },
    terms: { type: "array", items: { type: "object", properties: { term: { type: "string" }, kind: { type: "string", enum: ["pessoa", "partido", "instituicao", "hashtag", "slogan", "regiao"] }, count: { type: "number" } }, required: ["term", "kind", "count"] } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reasoning: { type: "string" },
  },
  required: ["total_mentions", "total_interactions", "sentiment", "net_sentiment", "dominant_network", "topics", "terms", "confidence"],
};

function systemPrompt(body: Body, days: number) {
  return `Você é um analista sênior de social listening político no Brasil.
Analise SOMENTE as evidências persistidas no Historical Social Index para ${body.candidate_name}.
Proibido inventar dados, estimar lacunas, criar assuntos genéricos ou usar conhecimento externo.
Termos e tópicos precisam aparecer literalmente nas evidências. Se não houver base, retorne campos vazios/zero.
Responda apenas JSON válido no schema solicitado. Período: ${body.start_date} a ${body.end_date} (${days} dias).`;
}

async function callAIWithModel(model: string, systemMsg: string, userMsg: string, signal: AbortSignal) {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Lovable-API-Key": LOVABLE_KEY ?? "", "X-Lovable-AIG-SDK": "vercel-ai-sdk", "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemMsg }, { role: "user", content: userMsg }],
      tools: [{ type: "function", function: { name: "emit_listening_report", description: "Emite relatório estruturado sem estimativas.", parameters: RESPONSE_SCHEMA } }],
      tool_choice: { type: "function", function: { name: "emit_listening_report" } },
    }),
  });
}

async function callAI(systemMsg: string, userMsg: string) {
  if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY ausente");
  const models = ["google/gemini-3-flash-preview", "google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"];
  let lastStatus = 0;
  let lastErr = "";
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  for (const m of models) {
    const r = await callAIWithModel(m, systemMsg, userMsg, signal);
    if (r.ok) {
      const j = await r.json();
      const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) throw new Error("Sem tool_call da IA");
      return typeof args === "string" ? JSON.parse(args) : args;
    }
    lastStatus = r.status;
    lastErr = (await r.text().catch(() => "")).slice(0, 300);
    if (r.status !== 429 && r.status !== 402 && r.status < 500) break;
  }
  const err: any = new Error(`AI gateway ${lastStatus}: ${lastErr}`);
  err.status = lastStatus;
  throw err;
}

const GENERIC_TOPIC_PATTERNS = [/^congresso$/i, /^economia$/i, /^lula$/i, /^bolsonaro$/i, /^pol[ií]tica/i, /^imagem p[uú]blica/i, /^repercuss[aã]o digital/i, /^polariza[cç][aã]o/i];
const FORBIDDEN_TERM_LABELS = new Set(["pessoa", "pessoas", "regiao", "regioes", "organizacao", "entidade", "categoria", "local", "evento", "data", "tempo"]);

function isGenericTopic(label: string) {
  const clean = (label ?? "").trim();
  return !clean || clean.split(/\s+/).length < 2 || GENERIC_TOPIC_PATTERNS.some((re) => re.test(clean));
}

function isForbiddenTerm(term: string) {
  const clean = normalizeText(term).trim();
  return !clean || clean.length < 2 || FORBIDDEN_TERM_LABELS.has(clean);
}

function sanitizeAiReport(report: any, evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>, renderState: "FULL_DATA" | "PARTIAL_DATA" | "NO_DATA") {
  const corpus = normalizeText(evidence.flatMap((e) => e.hits).map((h) => `${h.title ?? ""} ${h.description ?? ""} ${(h.entities ?? []).join(" ")} ${(h.hashtags ?? []).join(" ")} ${(h.themes ?? []).join(" ")}`).join("\n"));
  const appearsInCorpus = (value: string) => {
    const clean = normalizeText(value).replace(/^#/, "");
    return clean.length >= 3 && corpus.includes(clean);
  };
  report.topics = Array.isArray(report.topics)
    ? report.topics.filter((t: any) => t?.label && !isGenericTopic(String(t.label)) && String(t.label).split(/\s+/).some(appearsInCorpus)).slice(0, 8)
    : [];
  report.terms = Array.isArray(report.terms)
    ? report.terms.map((t: any) => ({ ...t, term: String(t?.term ?? t?.text ?? t?.value ?? "").trim() })).filter((t: any) => t.term && !isForbiddenTerm(t.term) && appearsInCorpus(t.term)).slice(0, 18)
    : [];
  if (renderState !== "FULL_DATA") {
    report.topics = [];
    report.terms = [];
    report.sentiment_by_network = [];
    report.timeline = [];
  }
  return report;
}

function computeDistribution(evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>, body: Body): Distribution[] {
  const direct = new Map<string, number>();
  for (const item of evidence) direct.set(item.net, (direct.get(item.net) ?? 0) + item.hits.length);
  const wantAll = !body.network || body.network === "all";
  const networks = wantAll ? ALL_NETWORKS : ALL_NETWORKS.filter((n) => n === body.network);
  const total = networks.reduce((sum, n) => sum + (direct.get(n) ?? 0), 0);
  return networks.map((n) => {
    const d = direct.get(n) ?? 0;
    return { network: n, pct: total > 0 ? Math.round((d / total) * 100) : 0, mentions: d, direct_hits: d, external_hits: 0, data_source_type: d > 0 ? "direct" : "unavailable" };
  });
}

function computeTimeline(samples: SearchHit[], body: Body) {
  const counts = new Map<string, { total: number; positivo: number; negativo: number }>();
  const start = Date.parse(`${body.start_date}T00:00:00Z`);
  const end = Date.parse(`${body.end_date}T23:59:59Z`);
  for (const h of samples) {
    if (!h.date) continue;
    const t = Date.parse(h.date);
    if (!Number.isFinite(t) || t < start || t > end) continue;
    const date = new Date(t).toISOString().slice(0, 10);
    const cur = counts.get(date) ?? { total: 0, positivo: 0, negativo: 0 };
    cur.total += 1;
    if ((h.sentiment ?? 0) > 0 || h.sentiment_label === "positive") cur.positivo += 1;
    if ((h.sentiment ?? 0) < 0 || h.sentiment_label === "negative") cur.negativo += 1;
    counts.set(date, cur);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
}

function aggregateSentiment(samples: SearchHit[]) {
  let pos = 0, neg = 0, neu = 0;
  for (const h of samples) {
    if ((h.sentiment ?? 0) > 0 || h.sentiment_label === "positive") pos += 1;
    else if ((h.sentiment ?? 0) < 0 || h.sentiment_label === "negative") neg += 1;
    else neu += 1;
  }
  const total = pos + neg + neu;
  const net = total ? Math.round(((pos - neg) / total) * 100) : 0;
  return { sentiment: { pos, neg, neu }, net_sentiment: net };
}

function aggregateSentimentByNetwork(evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>) {
  const byNet = new Map<string, { pos: number; neg: number; neu: number; count: number }>();
  for (const item of evidence) {
    const cur = byNet.get(item.net) ?? { pos: 0, neg: 0, neu: 0, count: 0 };
    for (const h of item.hits) {
      cur.count += 1;
      if ((h.sentiment ?? 0) > 0 || h.sentiment_label === "positive") cur.pos += 1;
      else if ((h.sentiment ?? 0) < 0 || h.sentiment_label === "negative") cur.neg += 1;
      else cur.neu += 1;
    }
    byNet.set(item.net, cur);
  }
  return [...byNet.entries()].filter(([, v]) => v.count >= 3).map(([network, v]) => ({ network, pos: v.pos, neg: v.neg, neu: v.neu }));
}

function buildTermsFromIndex(samples: SearchHit[]): Term[] {
  const map = new Map<string, Term>();
  const add = (term: string, kind: Term["kind"], count = 1) => {
    const clean = term.trim();
    if (isForbiddenTerm(clean)) return;
    const key = `${kind}:${clean.toLowerCase()}`;
    map.set(key, { term: clean, kind, count: (map.get(key)?.count ?? 0) + count });
  };
  for (const h of samples) {
    for (const tag of h.hashtags ?? []) add(tag, "hashtag", 4);
    for (const ent of h.entities ?? []) add(ent, "pessoa", 2);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 18);
}

function partialEvidenceReport(body: Body, samples: SearchHit[], sourceStatuses: SourceStatus[], reason: string, pipeline: string) {
  return {
    ...noDataReport(body, sourceStatuses, reason, samples.length, pipeline),
    render_state: "PARTIAL_DATA" as const,
    qualitative_only: true,
    terms: buildTermsFromIndex(samples),
  };
}

async function processJob(jobId: string, body: Body) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const started = Date.now();
  const logs: Array<Record<string, unknown>> = [];
  const log = (event: string, data: Record<string, unknown> = {}) => {
    const item = { at: new Date().toISOString(), event, ...data };
    logs.push(item);
    console.log(`[network-listening ${jobId}]`, event, JSON.stringify(data));
  };

  try {
    await updateJob(admin, jobId, { status: "running", progress: 6, stage: "Consultando índice histórico...", started_at: new Date().toISOString(), logs });
    const days = daysBetween(body.start_date, body.end_date);
    const bucket = bucketFor(days);
    const minHits = minHistoricalHits(days);
    let pipelineUsed = "historical_index_only";
    let backfillUsed = false;
    let backfillHits = 0;

    let evidence = await loadHistoricalEvidence(admin, body);
    let sourceStatuses = buildSourceStatuses(evidence);
    let samples = preprocessEvidence(evidence);
    log("historical_loaded", { hits: samples.length, groups: evidence.length, days });

    if (samples.length < minHits) {
      backfillUsed = true;
      pipelineUsed = "collector_backfill_then_historical_index";
      const existingRun = await latestCollectorRun(admin, body, jobId).catch(() => null);
      if (existingRun && ["running", "queued"].includes(existingRun.status)) {
        await updateJob(admin, jobId, {
          status: "running",
          progress: Math.min(66, 12 + Math.round(((existingRun.current_chunk ?? 0) / Math.max(1, existingRun.total_chunks ?? 1)) * 52)),
          stage: `Coletando histórico... Janela ${existingRun.current_chunk ?? 0}/${existingRun.total_chunks ?? 0} · ${Number(existingRun.mentions_found ?? 0).toLocaleString("pt-BR")} menções encontradas`,
          logs,
        });
        return;
      }
      if (existingRun?.status === "completed") {
        backfillHits = Number(existingRun.mentions_found ?? existingRun.inserted_count ?? 0);
        log("collector_run_completed", { hits: backfillHits, run_id: existingRun.id });
        evidence = await loadHistoricalEvidence(admin, body);
        sourceStatuses = buildSourceStatuses(evidence);
        samples = preprocessEvidence(evidence);
      } else {
      await updateJob(admin, jobId, { progress: 10, stage: "Histórico ainda não coletado para este candidato. Iniciando backfill...", logs });
      try {
        const collectorMode = days > 90 ? "backfill" : "on_demand";
        const collector = await invokeCollector(body, jobId, collectorMode);
        if (collector?.status === "processing") {
          log("collector_started", { mode: collectorMode });
          await updateJob(admin, jobId, {
            status: "running",
            progress: 12,
            stage: "Coletando histórico... Janela 0/0 · 0 menções encontradas",
            logs,
          });
          return;
        }
        backfillHits = Number(collector?.total_hits ?? collector?.inserted ?? 0);
        log("collector_done", { mode: collectorMode, hits: backfillHits, run_id: collector?.run_id, chunks: collector?.total_chunks });
        await updateJob(admin, jobId, { progress: 66, stage: "Reconsultando índice histórico...", logs });
        evidence = await loadHistoricalEvidence(admin, body);
        sourceStatuses = buildSourceStatuses(evidence);
        samples = preprocessEvidence(evidence);
      } catch (e: any) {
        log("collector_failed", { error: e?.message ?? String(e) });
        const run = await latestCollectorRun(admin, body, jobId).catch(() => null);
        if (run && ["running", "queued"].includes(run.status)) {
          await updateJob(admin, jobId, { status: "running", progress: Math.min(66, 12 + Math.round(((run.current_chunk ?? 0) / Math.max(1, run.total_chunks ?? 1)) * 52)), stage: `Coletando histórico... Janela ${run.current_chunk ?? 0}/${run.total_chunks ?? 0} · ${Number(run.mentions_found ?? 0).toLocaleString("pt-BR")} menções encontradas`, logs });
          return;
        }
      }
      }
    }

    await updateJob(admin, jobId, { progress: 70, stage: "Preparando análise do índice...", sources: sourceStatuses, logs });
    const totalHits = samples.length;
    const deterministicConfidence = computeConfidence(totalHits, sourceStatuses);
    let renderState: "FULL_DATA" | "PARTIAL_DATA" | "NO_DATA" = totalHits === 0 ? "NO_DATA" : deterministicConfidence === "low" ? "PARTIAL_DATA" : "FULL_DATA";
    let report: any;

    if (renderState === "NO_DATA") {
      report = noDataReport(body, sourceStatuses, "Histórico ainda não coletado para este candidato. Inicie backfill.", 0, pipelineUsed);
    } else {
      const evidenceForAi = evidence.map((e) => ({
        network: e.net,
        source: e.source,
        hits: e.hits.slice(0, 12).map((h) => ({ title: (h.title ?? "").slice(0, 180), snippet: (h.description ?? "").slice(0, 260), date: h.date ?? null, source: h.source ?? null, entities: h.entities ?? [], hashtags: h.hashtags ?? [], themes: h.themes ?? [] })),
      })).slice(0, 350);
      const userMsg = JSON.stringify({
        candidate: body.candidate_name,
        party: body.party ?? null,
        state: body.state ?? null,
        period: { start: body.start_date, end: body.end_date, days, bucket },
        evidence_count: totalHits,
        source_statuses: sourceStatuses,
        evidence: evidenceForAi,
        instructions: renderState === "FULL_DATA" ? "Gerar análise apenas com base no índice histórico." : "Gerar apenas comentário qualitativo; não gerar números, percentuais, tópicos nem sentimento por rede.",
      });
      try {
        await updateJob(admin, jobId, { progress: 76, stage: "Processando IA sobre histórico...", logs });
        report = await callAI(systemPrompt(body, days), userMsg);
      } catch (e: any) {
        log("ai_failed", { error: e?.message ?? String(e), status: e?.status ?? null });
        renderState = "PARTIAL_DATA";
        report = partialEvidenceReport(body, samples, sourceStatuses, "A IA não conseguiu enriquecer o corpus histórico, mas nenhuma estimativa artificial foi aplicada.", pipelineUsed);
      }
    }

    const sentimentAgg = aggregateSentiment(samples);
    const distribution = renderState === "FULL_DATA" ? computeDistribution(evidence, body) : [];
    report = sanitizeAiReport(report, evidence, renderState);
    report.confidence = deterministicConfidence;
    report.render_state = renderState;
    report.fallback = false;
    report.fallback_used = false;
    report.pipeline_used = pipelineUsed;
    report.historical_hits = totalHits;
    report.backfill_used = backfillUsed;
    report.backfill_hits = backfillHits;
    report.bucket = bucket;
    report.evidence_count = totalHits;
    report.source_count = sourceStatuses.filter((s) => s.status === "ok").length;

    if (renderState === "FULL_DATA") {
      report.total_mentions = totalHits;
      report.total_interactions = samples.reduce((sum, h) => sum + Number(h.interactions ?? 0), 0) || null;
      report.sentiment = sentimentAgg.sentiment;
      report.net_sentiment = sentimentAgg.net_sentiment;
      report.distribution = distribution;
      report.dominant_network = distribution.filter((r) => r.data_source_type !== "unavailable").sort((a, b) => b.pct - a.pct)[0]?.network ?? null;
      report.timeline = computeTimeline(samples, body);
      report.sentiment_by_network = aggregateSentimentByNetwork(evidence);
      if (!Array.isArray(report.terms) || report.terms.length === 0) report.terms = buildTermsFromIndex(samples);
    } else if (renderState === "PARTIAL_DATA") {
      report.total_mentions = null;
      report.total_interactions = null;
      report.sentiment = EMPTY_SENTIMENT;
      report.net_sentiment = 0;
      report.net_label = "Histórico insuficiente";
      report.dominant_network = null;
      report.distribution = [];
      report.timeline = [];
      report.sentiment_by_network = [];
      report.topics = [];
      report.terms = [];
      report.qualitative_only = true;
      report.reasoning = `Histórico insuficiente para análise quantitativa. Foram encontradas ${totalHits} evidências reais no índice; números, gráficos, assuntos e termos foram ocultados para evitar dados artificiais.`;
    }

    const debug = { evidence_count: totalHits, source_count: report.source_count, pipeline_used: pipelineUsed, fallback_used: false, confidence: report.confidence };
    const out = { ...report, cached: false, sources: sourceStatuses, social_view_debug: debug, job_id: jobId };
    cache.set(cacheKey(body), { at: Date.now(), data: out });
    const expiresAt = new Date(Date.now() + ttlMs(days)).toISOString();
    await admin.from("social_analytics_cache").upsert({
      cache_key: cacheKey(body),
      candidate_id: body.candidate_id ?? "unknown",
      network: body.network ?? "all",
      period_start: body.start_date,
      period_end: body.end_date,
      result: out,
      source_job_id: jobId,
      expires_at: expiresAt,
    }, { onConflict: "cache_key" });
    log("job_done", { duration_ms: Date.now() - started, cache_expires_at: expiresAt, pipeline_used: pipelineUsed });
    await updateJob(admin, jobId, { status: "completed", progress: 100, stage: "Análise concluída", result: out, sources: sourceStatuses, logs, completed_at: new Date().toISOString() });
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    log("job_failed", { error: message });
    const result = noDataReport(body, [], "Histórico ainda não coletado para este candidato. Inicie backfill.", 0, "historical_index_only");
    await updateJob(admin, jobId, { status: "failed", progress: 100, stage: "Falha ao processar", result, error: message, logs, completed_at: new Date().toISOString() });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await getUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = (await req.json().catch(() => ({}))) as Body;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    if (body.action === "status" || body.job_id) {
      if (!body.job_id) return json({ error: "missing_job_id" }, 400);
      const { data, error } = await admin
        .from("social_analytics_jobs")
        .select("id,status,progress,stage,result,sources,logs,error,created_at,started_at,completed_at,candidate_id,candidate_name,network,period_start,period_end,force_refresh")
        .eq("id", body.job_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "not_found" }, 404);
      if (data.status === "running") {
        const statusBody: Body = {
          ...body,
          candidate_id: data.candidate_id,
          candidate_name: data.candidate_name,
          network: data.network,
          start_date: data.period_start,
          end_date: data.period_end,
          force_refresh: data.force_refresh,
        };
        const run = await latestCollectorRun(admin, statusBody, data.id).catch(() => null);
        if (run && ["running", "queued"].includes(run.status)) {
          return json({ ...data, progress: Math.min(66, 12 + Math.round(((run.current_chunk ?? 0) / Math.max(1, run.total_chunks ?? 1)) * 52)), stage: `Coletando histórico... Janela ${run.current_chunk ?? 0}/${run.total_chunks ?? 0} · ${Number(run.mentions_found ?? 0).toLocaleString("pt-BR")} menções encontradas` }, 202);
        }
        if (run?.status === "completed" && !data.result) {
          // @ts-ignore EdgeRuntime existe em Edge Functions
          EdgeRuntime.waitUntil(processJob(data.id, statusBody));
          return json({ ...data, status: "running", progress: 68, stage: "Reconsultando índice histórico..." }, 202);
        }
      }
      return json(data);
    }

    if (!body?.candidate_name || !body?.candidate_id || !body.start_date || !body.end_date) {
      return json({ error: "candidate_id, candidate_name, start_date, end_date obrigatórios" }, 400);
    }

    const key = cacheKey(body);
    const days = daysBetween(body.start_date, body.end_date);
    const hit = !body.force_refresh ? cache.get(key) : null;
    if (hit && Date.now() - hit.at < ttlMs(days)) return json({ status: "completed", cached: true, result: { ...(hit.data as object), cached: true }, progress: 100 });

    if (!body.force_refresh) {
      const { data: cached } = await admin.from("social_analytics_cache").select("result,expires_at,source_job_id").eq("cache_key", key).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (cached?.result) {
        cache.set(key, { at: Date.now(), data: cached.result });
        return json({ status: "completed", cached: true, job_id: cached.source_job_id, result: { ...(cached.result as object), cached: true }, progress: 100 });
      }
    }

    const { data: active } = !body.force_refresh ? await admin
      .from("social_analytics_jobs")
      .select("id,status,progress,stage")
      .eq("user_id", user.id)
      .eq("cache_key", key)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() : { data: null };
    if (active?.id) return json({ status: active.status === "queued" ? "processing" : active.status, job_id: active.id, progress: active.progress ?? 0, stage: active.stage }, 202);

    const { data: job, error: insErr } = await admin.from("social_analytics_jobs").insert({
      user_id: user.id,
      candidate_id: body.candidate_id,
      candidate_name: body.candidate_name,
      network: body.network ?? "all",
      period_start: body.start_date,
      period_end: body.end_date,
      cache_key: key,
      status: "queued",
      progress: 0,
      stage: "Aguardando processamento",
      force_refresh: body.force_refresh === true,
    }).select("id").single();
    if (insErr || !job) return json({ error: insErr?.message ?? "insert_failed" }, 500);

    // @ts-ignore EdgeRuntime existe em Edge Functions
    EdgeRuntime.waitUntil(processJob(job.id, body));
    return json({ status: "processing", job_id: job.id, progress: 0, stage: "Aguardando processamento" }, 202);
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : "erro";
    console.error("[network-listening]", msg);
    return json({ error: "SERVICE_UNAVAILABLE", message: msg, fallback: false, fallback_used: false }, 200);
  }
});