// Visão por Rede Social — pipeline histórico externo + IA
// Independente do Radar Político e do banco interno.
// Fluxo: Firecrawl search -> corpus compacto -> Lovable AI (JSON) -> resposta.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_CONCURRENT_REQUESTS = 3;
const SOURCE_TIMEOUT_MS = 8_000;
const AI_TIMEOUT_MS = 20_000;

type Network = "twitter" | "youtube" | "facebook" | "instagram" | "tiktok" | "telegram" | "reddit" | "news" | "linkedin";

interface Body {
  action?: "create" | "status";
  job_id?: string;
  candidate_name: string;
  candidate_id?: string | null;
  party?: string | null;
  office?: string | null;
  state?: string | null;
  start_date: string; // ISO yyyy-mm-dd
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
}

interface Distribution { network: string; pct: number; mentions?: number }
interface Term { term: string; kind: "pessoa" | "partido" | "instituicao" | "hashtag" | "slogan" | "regiao"; count: number }

interface SourceStatus {
  source: string;
  batch: number;
  status: "ok" | "empty" | "rate_limited" | "timeout" | "error" | "skipped";
  duration_ms: number;
  hits: number;
  error?: string;
}

interface SourceTask {
  source: string;
  batch: number;
  net: Network;
  q: string;
}

// Cache quente em memória (instance-level). O cache principal fica no banco.
const cache = new Map<string, { at: number; data: unknown }>();

function cacheKey(b: Body) {
  return `social-v3|${b.candidate_id ?? normalizeText(b.candidate_name)}|${b.network ?? "all"}|${b.start_date}|${b.end_date}`;
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

function daysBetween(a: string, b: string) {
  return Math.max(1, Math.ceil((Date.parse(b) - Date.parse(a)) / 86_400_000));
}

function ttlMs(days: number) {
  if (days <= 7) return 30 * 60_000;
  if (days <= 30) return 2 * 60 * 60_000;
  if (days <= 90) return 6 * 60 * 60_000;
  if (days <= 365) return 24 * 60 * 60_000;
  if (days <= 1460) return 7 * 24 * 60 * 60_000;
  return 14 * 24 * 60 * 60_000;
}

function bucketFor(days: number): "day" | "week" | "month" | "quarter" | "semester" {
  if (days <= 30) return "day";
  if (days <= 90) return "week";
  if (days <= 365) return "month";
  if (days <= 1460) return "quarter";
  return "semester";
}

// Constrói tarefas Firecrawl em 3 lotes: notícias/web, redes textuais, redes audiovisuais/comunidades.
function buildSourceTasks(b: Body): SourceTask[] {
  const name = b.candidate_name;
  const ctx = [b.party, b.state].filter(Boolean).join(" ");
  const base = `${name} ${ctx}`.trim();
  const out: SourceTask[] = [];

  const wantAll = !b.network || b.network === "all";
  const want = (n: Network) => wantAll || b.network === n;

  // Recorte temporal — limitamos via after:/before: nas queries
  const dateRange = `after:${b.start_date} before:${b.end_date}`;

  if (want("news")) {
    out.push({ source: "google_news", batch: 1, q: `${base} política ${dateRange}`, net: "news" });
    out.push({ source: "blogs", batch: 1, q: `${base} blog política opinião ${dateRange}`, net: "news" });
    out.push({ source: "portais", batch: 1, q: `${base} jornal portal política ${dateRange}`, net: "news" });
  }
  if (want("twitter")) out.push({ source: "twitter", batch: 2, q: `${base} site:twitter.com OR site:x.com ${dateRange}`, net: "twitter" });
  if (want("reddit")) out.push({ source: "reddit", batch: 2, q: `${base} site:reddit.com ${dateRange}`, net: "reddit" });
  if (want("youtube")) out.push({ source: "youtube", batch: 3, q: `${base} site:youtube.com ${dateRange}`, net: "youtube" });
  if (want("tiktok")) out.push({ source: "tiktok", batch: 3, q: `${base} site:tiktok.com ${dateRange}`, net: "tiktok" });
  if (want("telegram")) out.push({ source: "telegram", batch: 3, q: `${base} site:t.me ${dateRange}`, net: "telegram" });
  if (want("facebook")) out.push({ source: "facebook", batch: 3, q: `${base} site:facebook.com ${dateRange}`, net: "facebook" });
  if (want("instagram")) out.push({ source: "instagram", batch: 3, q: `${base} site:instagram.com ${dateRange}`, net: "instagram" });
  return out;
}

async function firecrawlSearch(task: SourceTask, limit = 8): Promise<{ hits: SearchHit[]; status: SourceStatus }> {
  const started = Date.now();
  if (!FIRECRAWL_KEY) {
    return { hits: [], status: { source: task.source, batch: task.batch, status: "skipped", duration_ms: 0, hits: 0, error: "FIRECRAWL_API_KEY ausente" } };
  }
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: task.q, limit, lang: "pt", country: "br" }),
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).slice(0, 240);
      const sourceStatus: SourceStatus["status"] = r.status === 429 ? "rate_limited" : "error";
      console.warn("[network-listening] source", task.source, sourceStatus, r.status, detail);
      return { hits: [], status: { source: task.source, batch: task.batch, status: sourceStatus, duration_ms: Date.now() - started, hits: 0, error: detail } };
    }
    const j = await r.json();
    const raw: any[] = j?.data?.web ?? j?.data ?? j?.results ?? [];
    const hits = raw.slice(0, limit).map((x) => ({
      url: x.url,
      title: x.title,
      description: x.description ?? x.snippet ?? "",
      source: x.source ?? x.url,
      date: x.publishedDate ?? x.date ?? undefined,
    }));
    return { hits, status: { source: task.source, batch: task.batch, status: hits.length ? "ok" : "empty", duration_ms: Date.now() - started, hits: hits.length } };
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    const timedOut = /timeout|aborted|signal/i.test(message);
    console.warn("[network-listening] source exception", task.source, message);
    return { hits: [], status: { source: task.source, batch: task.batch, status: timedOut ? "timeout" : "error", duration_ms: Date.now() - started, hits: 0, error: message.slice(0, 180) } };
  }
}

async function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

function systemPrompt(b: Body, days: number) {
  const yearStart = new Date(b.start_date).getUTCFullYear();
  const yearEnd = new Date(b.end_date).getUTCFullYear();
  return `Você é um analista sênior de social listening político no Brasil.
Sua tarefa: analisar SOMENTE as evidências coletadas para um político em um período específico.

CONTEXTO HISTÓRICO RELEVANTE NO PERÍODO (${yearStart}-${yearEnd}):
- 2018: eleições, antipetismo, Lava Jato, fake news WhatsApp, ascensão Bolsonaro.
- 2019-2020: governo Bolsonaro, pandemia, polarização extrema.
- 2021-2022: vacinação, CPI da Covid, eleições Lula x Bolsonaro.
- 2023-2024: governo Lula, STF, 8 de janeiro, reforma tributária.
- 2025-2026: pré-eleições 2026, presidenciáveis.

INSTRUÇÕES:
- Se não houver evidências suficientes, diga claramente que não há base. NÃO preencha lacunas.
- Nunca invente menções, interações, percentuais, timeline, distribuição, sentimento por rede, assuntos ou termos.
- Números só podem ser derivados das evidências informadas pelo usuário.
- Termos devem ser entidades reais presentes nas evidências: pessoas, partidos, instituições, hashtags, slogans e regiões. NUNCA verbos, stopwords ou fragmentos.
- Temas devem vir de agrupamentos reais de evidência. PROIBIDO usar rótulos genéricos como "Imagem pública", "Cobertura jornalística", "Disputa política", "Repercussão digital", "Críticas e apoios", "Polarização".
- Se um campo não tiver evidência direta, retorne vazio/null/0 conforme o schema, sem estimar.
- Responda APENAS um JSON válido no schema solicitado, sem markdown.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    total_mentions: { type: "number" },
    total_interactions: { type: "number" },
    sentiment: {
      type: "object",
      properties: { pos: { type: "number" }, neg: { type: "number" }, neu: { type: "number" } },
      required: ["pos", "neg", "neu"],
    },
    net_sentiment: { type: "number" },
    net_label: { type: "string" },
    dominant_network: { type: "string" },
    distribution: {
      type: "array",
      items: {
        type: "object",
        properties: { network: { type: "string" }, pct: { type: "number" }, mentions: { type: "number" } },
        required: ["network", "pct"],
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          total: { type: "number" },
          positivo: { type: "number" },
          negativo: { type: "number" },
        },
        required: ["date", "total", "positivo", "negativo"],
      },
    },
    sentiment_by_network: {
      type: "array",
      items: {
        type: "object",
        properties: {
          network: { type: "string" },
          pos: { type: "number" },
          neg: { type: "number" },
          neu: { type: "number" },
        },
        required: ["network", "pos", "neg", "neu"],
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          mentions: { type: "number" },
          pos: { type: "number" },
          neg: { type: "number" },
          neu: { type: "number" },
        },
        required: ["label", "mentions"],
      },
    },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          kind: { type: "string", enum: ["pessoa", "partido", "instituicao", "hashtag", "slogan", "regiao"] },
          count: { type: "number" },
        },
        required: ["term", "kind", "count"],
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reasoning: { type: "string" },
  },
  required: [
    "total_mentions",
    "total_interactions",
    "sentiment",
    "net_sentiment",
    "dominant_network",
    "distribution",
    "timeline",
    "sentiment_by_network",
    "topics",
    "terms",
    "confidence",
  ],
};

async function callAIWithModel(model: string, systemMsg: string, userMsg: string, signal: AbortSignal) {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_KEY ?? "",
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "emit_listening_report",
            description: "Emite o relatório de social listening estruturado.",
            parameters: RESPONSE_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit_listening_report" } },
    }),
  });
}

async function callAI(systemMsg: string, userMsg: string) {
  if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY ausente");
  const models = [
    "google/gemini-3-flash-preview",
    "google/gemini-2.5-flash-lite",
    "google/gemini-2.5-flash",
  ];
  let lastStatus = 0;
  let lastErr = "";
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  for (const m of models) {
    const r = await callAIWithModel(m, systemMsg, userMsg, signal);
    if (r.ok) {
      const j = await r.json();
      const call = j?.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments;
      if (!args) throw new Error("Sem tool_call da IA");
      return typeof args === "string" ? JSON.parse(args) : args;
    }
    lastStatus = r.status;
    lastErr = (await r.text().catch(() => "")).slice(0, 300);
    console.warn(`[network-listening] modelo ${m} → ${r.status}, tentando próximo modelo`);
    if (r.status !== 429 && r.status !== 402 && r.status < 500) break;
  }
  const err: any = new Error(`AI gateway ${lastStatus}: ${lastErr}`);
  err.status = lastStatus;
  throw err;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function preprocessEvidence(evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const item of evidence) {
    for (const hit of item.hits) {
      const text = `${hit.title ?? ""} ${hit.description ?? ""}`.trim();
      const normalized = normalizeText(hit.url || text).slice(0, 220);
      if (!text || seen.has(normalized)) continue;
      if (/\b(cassino|bet|promoção|cupom|porn|download grátis)\b/i.test(text)) continue;
      if (/^\s*RT\s+@/i.test(text)) continue;
      seen.add(normalized);
      out.push(hit);
    }
  }
  return out.slice(0, 300);
}

const EMPTY_SENTIMENT = { pos: 0, neg: 0, neu: 0 };

function noDataReport(body: Body, sourceStatuses: SourceStatus[], reason: string, evidenceCount = 0) {
  return {
    total_mentions: null,
    total_interactions: null,
    sentiment: EMPTY_SENTIMENT,
    net_sentiment: 0,
    net_label: "Dados insuficientes",
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
    pipeline_used: "external_evidence_only",
  };
}

function extractTerms(body: Body, samples: SearchHit[]): Term[] {
  const terms = new Map<string, Term>();
  const add = (term: string, kind: Term["kind"], count = 1) => {
    const clean = term.trim().replace(/\s+/g, " ");
    if (isForbiddenTerm(clean)) return;
    const key = `${kind}:${clean.toLowerCase()}`;
    terms.set(key, { term: clean, kind, count: (terms.get(key)?.count ?? 0) + count });
  };
  const corpus = samples.map((h) => `${h.title ?? ""} ${h.description ?? ""}`).join("\n");
  for (const tag of corpus.match(/#[\p{L}0-9_]{3,}/gu) ?? []) add(tag, "hashtag", 4);
  for (const inst of ["STF", "TSE", "Congresso", "Senado", "Câmara", "Planalto", "Governo Federal", "Ministério Público"]) {
    if (new RegExp(`\\b${inst}\\b`, "i").test(corpus)) add(inst, "instituicao", 5);
  }
  for (const party of ["PT", "PL", "MDB", "PSD", "PSDB", "PSB", "União Brasil", "Republicanos", "PP", "PDT", "PSOL"]) {
    if (new RegExp(`\\b${party}\\b`, "i").test(corpus)) add(party, "partido", 4);
  }
  return [...terms.values()].sort((a, b) => b.count - a.count).slice(0, 18);
}

// Tópicos genéricos PROIBIDOS — filtrados da IA.
const GENERIC_TOPIC_PATTERNS = [
  /^imagem p[uú]blica/i,
  /^cobertura jornal[ií]stica/i,
  /^disputa pol[ií]tica( nacional)?$/i,
  /^cr[ií]ticas?,? apoios?/i,
  /^alian[cç]as e movimenta[cç][aã]o partid[aá]ria$/i,
  /^pol[ií]tica( geral| nacional)?$/i,
  /^congresso$/i,
  /^economia$/i,
  /^repercuss[aã]o digital$/i,
  /^polariza[cç][aã]o$/i,
  /^contexto pol[ií]tico$/i,
  /^pol[eê]micas?$/i,
  /^opini[aã]o p[uú]blica$/i,
];

function isGenericTopic(label: string) {
  const clean = (label ?? "").trim();
  if (!clean) return true;
  if (clean.split(/\s+/).length < 2) return true;
  return GENERIC_TOPIC_PATTERNS.some((re) => re.test(clean));
}

// Termos NLP "labels" proibidos (categorias, não entidades reais).
const FORBIDDEN_TERM_LABELS = new Set([
  "pessoa", "pessoas", "regiao", "regioes", "organizacao", "organization",
  "entidade", "categoria", "local", "lugar", "gpe", "loc", "org", "per", "misc",
  "evento", "data", "tempo", "nome", "lugar geografico",
]);

function isForbiddenTerm(term: string) {
  const clean = normalizeText(term).trim();
  if (!clean || clean.length < 2) return true;
  if (FORBIDDEN_TERM_LABELS.has(clean)) return true;
  if (/^(ser|estar|ter|haver|fazer|disse|falou|novo|nova|grande|bom|ruim)$/i.test(clean)) return true;
  return false;
}

// Confiança determinística — thresholds calibrados para coleta externa.
// HIGH  = >=200 hits OU >=30 fontes ok
// MEDIUM= >=30 hits  OU >=5 fontes  OU >=20 evidências
// LOW   = abaixo (esconde gráficos numéricos)
function computeConfidence(samples: number, sourceStatuses: SourceStatus[]): "high" | "medium" | "low" {
  const okSources = sourceStatuses.filter((s) => s.status === "ok").length;
  if (samples >= 200 || okSources >= 30) return "high";
  if (samples >= 30 || okSources >= 5 || samples >= 20) return "medium";
  return "low";
}

// Sempre renderizar todas as redes suportadas, com badge de origem do dado.
const ALL_NETWORKS: Network[] = ["twitter", "instagram", "facebook", "youtube", "tiktok", "telegram", "reddit", "news"];
type DataSourceType = "direct" | "proxy" | "unavailable";

const NETWORK_DOMAINS: Record<string, RegExp> = {
  twitter: /(twitter\.com|x\.com|t\.co)/i,
  instagram: /instagram\.com/i,
  facebook: /facebook\.com|fb\.com/i,
  youtube: /youtube\.com|youtu\.be/i,
  tiktok: /tiktok\.com/i,
  telegram: /t\.me|telegram\.me/i,
  reddit: /reddit\.com/i,
  news: /(globo|uol|folha|estad[aã]o|g1|cnn|veja|carta|metropoles|valor|exame|terra|r7|band)/i,
};

// network_weight = direct*0.45 + engagement*0.35 + external*0.20 (engagement indisponível → 0)
function computeDistribution(
  evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>,
  body: Body,
) {
  const direct = new Map<string, number>();
  const external = new Map<string, number>();
  for (const item of evidence) direct.set(item.net, (direct.get(item.net) ?? 0) + item.hits.length);
  for (const target of ALL_NETWORKS) {
    const re = NETWORK_DOMAINS[target];
    if (!re) continue;
    let count = 0;
    for (const item of evidence) {
      if (item.net === target) continue;
      for (const h of item.hits) if (re.test(h.url ?? "") || re.test(h.description ?? "")) count += 1;
    }
    external.set(target, count);
  }
  const wantAll = !body.network || body.network === "all";
  const networks = wantAll ? ALL_NETWORKS : ALL_NETWORKS.filter((n) => n === body.network);
  const rows = networks.map((n) => {
    const d = direct.get(n) ?? 0;
    const e = external.get(n) ?? 0;
    let w = d * 0.45 + e * 0.20;
    let data_source_type: DataSourceType;
    if (d >= 3) data_source_type = "direct";
    else if (e >= 2) data_source_type = "proxy";
    else {
      data_source_type = "unavailable";
      w = 0;
    }
    return { network: n as string, w, d, e, data_source_type };
  });
  const total = rows.reduce((s, r) => s + r.w, 0);
  return rows.map((r) => ({
    network: r.network,
    pct: total > 0 ? Math.round((r.w / total) * 100) : 0,
    mentions: r.d,
    direct_hits: r.d,
    external_hits: r.e,
    data_source_type: r.data_source_type,
  }));
}

const MIN_NETWORK_EVIDENCE = 3;

function directEvidenceByNetwork(evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>) {
  const counts = new Map<string, number>();
  for (const item of evidence) counts.set(item.net, (counts.get(item.net) ?? 0) + item.hits.length);
  return counts;
}

function computeTimelineFromEvidence(samples: SearchHit[], body: Body) {
  const start = Date.parse(`${body.start_date}T00:00:00Z`);
  const end = Date.parse(`${body.end_date}T23:59:59Z`);
  const counts = new Map<string, number>();
  for (const h of samples) {
    if (!h.date) continue;
    const time = Date.parse(h.date);
    if (!Number.isFinite(time) || time < start || time > end) continue;
    const day = new Date(time).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total, positivo: 0, negativo: 0 }));
}

function sanitizeAiReport(report: any, evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>, renderState: "FULL_DATA" | "PARTIAL_DATA" | "NO_DATA") {
  const byNetwork = directEvidenceByNetwork(evidence);
  const corpus = normalizeText(evidence.flatMap((e) => e.hits).map((h) => `${h.title ?? ""} ${h.description ?? ""}`).join("\n"));
  const appearsInCorpus = (value: string) => {
    const clean = normalizeText(value).replace(/^#/, "");
    return clean.length >= 3 && corpus.includes(clean);
  };
  if (Array.isArray(report.topics)) {
    report.topics = report.topics.filter((t: any) => t?.label && !isGenericTopic(String(t.label)) && String(t.label).split(/\s+/).some(appearsInCorpus)).slice(0, 8);
    if (report.topics.length < 3) report.topics = [];
  } else report.topics = [];

  if (Array.isArray(report.terms)) {
    report.terms = report.terms
      .map((t: any) => ({ ...t, term: String(t?.text ?? t?.value ?? t?.term ?? "").trim() }))
      .filter((t: any) => t.term && !isForbiddenTerm(String(t.term)) && appearsInCorpus(String(t.term)))
      .slice(0, 18);
  } else report.terms = [];

  if (Array.isArray(report.sentiment_by_network)) {
    report.sentiment_by_network = report.sentiment_by_network.filter((n: any) => {
      const network = normalizeText(n?.network);
      const evidenceCount = byNetwork.get(network) ?? 0;
      const hasValues = Number(n?.pos ?? 0) + Number(n?.neg ?? 0) + Number(n?.neu ?? 0) > 0;
      return evidenceCount >= MIN_NETWORK_EVIDENCE && hasValues;
    });
  } else report.sentiment_by_network = [];

  if (!Array.isArray(report.timeline) || renderState !== "FULL_DATA") report.timeline = [];
  if (renderState !== "FULL_DATA") report.sentiment_by_network = [];
  return report;
}

function partialEvidenceReport(body: Body, samples: SearchHit[], sourceStatuses: SourceStatus[], reason: string) {
  const bucket = bucketFor(daysBetween(body.start_date, body.end_date));
  return {
    total_mentions: null,
    total_interactions: null,
    sentiment: EMPTY_SENTIMENT,
    net_sentiment: 0,
    net_label: "Dados insuficientes",
    dominant_network: null,
    distribution: [],
    timeline: [],
    sentiment_by_network: [],
    topics: [],
    terms: extractTerms(body, samples),
    confidence: "low" as const,
    render_state: "PARTIAL_DATA" as const,
    qualitative_only: true,
    reasoning: `${reason} Foram encontradas poucas evidências reais; por integridade, números, gráficos e percentuais foram ocultados.`,
    evidence_count: samples.length,
    source_count: sourceStatuses.filter((s) => s.status === "ok").length,
    bucket,
    sources: sourceStatuses,
    fallback: false,
    fallback_used: false,
    pipeline_used: "external_evidence_only",
  };
}

async function loadHistoricalEvidence(admin: any, body: Body): Promise<Array<{ net: Network; source: string; hits: SearchHit[] }>> {
  const wantAll = !body.network || body.network === "all";
  let q = admin.from("historical_social_mentions")
    .select("network,source,url,title,content,date")
    .eq("candidate_name_normalized", normalizeText(body.candidate_name))
    .gte("date", `${body.start_date}T00:00:00Z`)
    .lte("date", `${body.end_date}T23:59:59Z`)
    .limit(2000);
  if (!wantAll) q = q.eq("network", body.network);
  const { data, error } = await q;
  if (error || !data) return [];
  const grouped = new Map<string, SearchHit[]>();
  for (const row of data as any[]) {
    const key = `${row.network}|${row.source}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({
      url: row.url, title: row.title, description: row.content, date: row.date, source: row.source,
    });
  }
  return [...grouped.entries()].map(([k, hits]) => {
    const [net, source] = k.split("|");
    return { net: net as Network, source, hits };
  });
}

async function persistEvidenceToHistory(
  admin: any,
  body: Body,
  evidence: Array<{ net: Network; source: string; hits: SearchHit[] }>,
) {
  const normName = normalizeText(body.candidate_name);
  for (const item of evidence) {
    for (const h of item.hits) {
      const text = `${h.title ?? ""} ${h.description ?? ""}`.trim();
      if (!text) continue;
      const row = {
        candidate_id: body.candidate_id ?? null,
        candidate_name: body.candidate_name,
        candidate_name_normalized: normName,
        source: item.source,
        network: item.net,
        url: h.url ?? null,
        title: (h.title ?? "").slice(0, 500),
        content: (h.description ?? "").slice(0, 2000),
        date: h.date ? (Number.isFinite(Date.parse(h.date)) ? new Date(h.date).toISOString() : null) : null,
      };
      await admin.from("historical_social_mentions").insert(row).then(() => {}, () => {});
    }
  }
}

async function processJob(jobId: string, body: Body, userId: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const started = Date.now();
  const logs: Array<Record<string, unknown>> = [];
  const log = (event: string, data: Record<string, unknown> = {}) => {
    const item = { at: new Date().toISOString(), event, ...data };
    logs.push(item);
    console.log(`[network-listening ${jobId}]`, event, JSON.stringify(data));
  };

  try {
    await updateJob(admin, jobId, { status: "running", progress: 10, stage: "Consultando índice histórico...", started_at: new Date().toISOString(), logs });

    const evidence: Array<{ net: Network; source: string; hits: SearchHit[] }> = [];
    const sourceStatuses: SourceStatus[] = [];
    const days = daysBetween(body.start_date, body.end_date);
    const bucket = bucketFor(days);

    // 1) Fonte primária: índice histórico persistido.
    let historicalCount = 0;
    try {
      const historicalEvidence = await loadHistoricalEvidence(admin, body);
      for (const e of historicalEvidence) {
        evidence.push(e);
        sourceStatuses.push({ source: `historical:${e.source}`, batch: 0, status: e.hits.length > 0 ? "ok" : "empty", duration_ms: 0, hits: e.hits.length });
        historicalCount += e.hits.length;
      }
      log("historical_loaded", { hits: historicalCount, groups: historicalEvidence.length, days });
    } catch (e: any) {
      log("historical_load_failed", { error: e?.message ?? String(e) });
    }

    // 2) Coleta live só para períodos curtos (<=90d) e quando o histórico está fraco.
    // Períodos longos (1, 4, 8 anos): coleta live nunca traz cobertura histórica útil — pular.
    const allowLive = days <= 90 && historicalCount < 60;
    if (allowLive) {
      const tasks = buildSourceTasks(body);
      const liveEvidence: Array<{ net: Network; source: string; hits: SearchHit[] }> = [];
      for (const batch of [1, 2, 3]) {
        const batchTasks = tasks.filter((t) => t.batch === batch);
        if (!batchTasks.length) continue;
        const stage = batch === 1 ? "Coletando notícias..." : batch === 2 ? "Analisando redes..." : "Coletando vídeos e comunidades...";
        const progress = batch === 1 ? 25 : batch === 2 ? 45 : 62;
        await updateJob(admin, jobId, { progress, stage, logs });
        const batchStarted = Date.now();
        const results = await runLimited(batchTasks, MAX_CONCURRENT_REQUESTS, (task) => firecrawlSearch(task, 8));
        results.forEach((result, i) => {
          const task = batchTasks[i];
          evidence.push({ net: task.net, source: task.source, hits: result.hits });
          liveEvidence.push({ net: task.net, source: task.source, hits: result.hits });
          sourceStatuses.push(result.status);
          if (result.status.status === "rate_limited") log("rate_limit", { source: task.source });
        });
        log("batch_done", { batch, duration_ms: Date.now() - batchStarted, sources: batchTasks.length });
      }
      // Persiste o que veio do live no índice histórico, para uso futuro.
      try { await persistEvidenceToHistory(admin, body, liveEvidence); }
      catch (e: any) { log("persist_failed", { error: e?.message ?? String(e) }); }
    } else {
      log("skip_live", { reason: days > 90 ? "long_period" : "historical_sufficient", days, historical_hits: historicalCount });
    }

    await updateJob(admin, jobId, { progress: 68, stage: "Pré-processando amostras...", sources: sourceStatuses, logs });
    const samples = preprocessEvidence(evidence);
    const totalHits = samples.length;
    const deterministicConfidence = computeConfidence(totalHits, sourceStatuses);
    let renderState: "FULL_DATA" | "PARTIAL_DATA" | "NO_DATA" = totalHits === 0 ? "NO_DATA" : deterministicConfidence === "low" ? "PARTIAL_DATA" : "FULL_DATA";
    let report: any;

    if (renderState === "NO_DATA") {
      log("no_evidence", { sources: sourceStatuses.length });
      report = noDataReport(body, sourceStatuses, "Não foi possível coletar evidências suficientes para este período.", 0);
    } else {
      await updateJob(admin, jobId, { progress: 72, stage: "Processando IA...", logs });
      const evidenceForAi = evidence.map((e) => ({
        network: e.net,
        source: e.source,
        hits: e.hits.slice(0, 8).map((h) => ({
          title: (h.title ?? "").slice(0, 160),
          snippet: (h.description ?? "").slice(0, 220),
          date: h.date ?? null,
          source: h.source ?? null,
        })),
      })).slice(0, 300);
      const user = JSON.stringify({
        candidate: body.candidate_name,
        party: body.party ?? null,
        office: body.office ?? null,
        state: body.state ?? null,
        period: { start: body.start_date, end: body.end_date, days, bucket },
        network_filter: body.network ?? "all",
        evidence_count: totalHits,
        source_statuses: sourceStatuses,
        preprocessing: "deduplicado, spam removido, RT duplicado removido, máximo 300 amostras",
        evidence: evidenceForAi,
        instructions: renderState === "FULL_DATA"
          ? "Gere análise apenas a partir das evidências. Não estime lacunas. Se não houver evidência para um campo, retorne vazio."
          : "Gere somente resumo qualitativo e insights baseados nas evidências disponíveis. Não gere números, gráficos, percentuais, tópicos ou sentimento por rede.",
      });
      try {
        const aiStarted = Date.now();
        report = await callAI(systemPrompt(body, days), user);
        log("ai_done", { duration_ms: Date.now() - aiStarted });
      } catch (e: any) {
        log("ai_failed", { error: (e as Error)?.message ?? String(e), status: e?.status ?? null });
        renderState = "PARTIAL_DATA";
        report = partialEvidenceReport(body, samples, sourceStatuses, "A IA excedeu limite, tempo ou créditos.");
      }
    }

    await updateJob(admin, jobId, { progress: 93, stage: "Gerando gráficos...", logs });

    // Pós-processamento obrigatório: estados exclusivos + confiança determinística.
    report.confidence = deterministicConfidence;
    report.render_state = renderState;
    report.fallback = false;
    report.fallback_used = false;
    report.pipeline_used = "external_evidence_only";

    // Distribuição SEMPRE recalculada a partir de evidência real (nunca a IA inventa).
    // Mantém todas as redes visíveis com badge data_source_type.
    const realDistribution = renderState === "FULL_DATA" ? computeDistribution(evidence, body) : [];
    report.distribution = realDistribution;
    report.dominant_network = renderState === "FULL_DATA" ? realDistribution
      .filter((r) => r.data_source_type !== "unavailable")
      .sort((a, b) => b.pct - a.pct)[0]?.network ?? null : null;

    report = sanitizeAiReport(report, evidence, renderState);
    if (renderState === "NO_DATA") {
      Object.assign(report, noDataReport(body, sourceStatuses, "Não foi possível coletar evidências suficientes para este período.", 0));
    } else if (renderState === "PARTIAL_DATA") {
      report.qualitative_only = true;
      report.total_mentions = null;
      report.total_interactions = null;
      report.sentiment = EMPTY_SENTIMENT;
      report.net_sentiment = 0;
      report.net_label = "Dados insuficientes";
      report.dominant_network = null;
      report.distribution = [];
      report.timeline = [];
      report.sentiment_by_network = [];
      report.topics = [];
      report.terms = [];
      const prevReason = report.reasoning ? `${report.reasoning} ` : "";
      report.reasoning = `${prevReason}Dados insuficientes para análise quantitativa precisa (${totalHits} evidências, ${sourceStatuses.filter((s) => s.status === "ok").length} fontes). Números, gráficos, assuntos e termos foram ocultados.`;
    } else {
      report.qualitative_only = false;
      report.total_mentions = totalHits;
      report.total_interactions = null;
      report.timeline = computeTimelineFromEvidence(samples, body);
      if (Array.isArray(report.topics)) {
        report.topics = report.topics.map((t: any) => ({
          ...t,
          mentions: Math.max(1, Math.min(totalHits, Number(t.mentions ?? 1))),
        }));
      }
    }

    const out = { ...report, evidence_count: totalHits, source_count: sourceStatuses.filter((s) => s.status === "ok").length, bucket, cached: false, sources: sourceStatuses, job_id: jobId };
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
    log("job_done", { duration_ms: Date.now() - started, cache_expires_at: expiresAt });
    await updateJob(admin, jobId, { status: "completed", progress: 100, stage: "Análise concluída", result: out, sources: sourceStatuses, logs, completed_at: new Date().toISOString() });
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    log("job_failed", { error: message });
    const result = noDataReport(body, [], "Não foi possível coletar evidências suficientes para este período.", 0);
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
        .select("id,status,progress,stage,result,sources,logs,error,created_at,started_at,completed_at")
        .eq("id", body.job_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "not_found" }, 404);
      return json(data);
    }

    if (!body?.candidate_name || !body?.candidate_id || !body.start_date || !body.end_date) {
      return json({ error: "candidate_id, candidate_name, start_date, end_date obrigatórios" }, 400);
    }

    const key = cacheKey(body);
    const days = daysBetween(body.start_date, body.end_date);
    const hit = !body.force_refresh ? cache.get(key) : null;
    if (hit && Date.now() - hit.at < ttlMs(days)) {
      console.log("[network-listening] cache_hit memory", key);
      return json({ status: "completed", cached: true, result: { ...(hit.data as object), cached: true }, progress: 100 });
    }

    if (!body.force_refresh) {
      const { data: cached } = await admin
        .from("social_analytics_cache")
        .select("result,expires_at,source_job_id")
        .eq("cache_key", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (cached?.result) {
        console.log("[network-listening] cache_hit db", key);
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

    const { data: failed } = !body.force_refresh ? await admin
      .from("social_analytics_jobs")
      .select("id,status,progress,stage,result,error")
      .eq("user_id", user.id)
      .eq("cache_key", key)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() : { data: null };
    if (failed?.id) {
      return json({ status: "failed", job_id: failed.id, progress: failed.progress ?? 100, stage: failed.stage, result: failed.result, error: failed.error }, 200);
    }

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
    EdgeRuntime.waitUntil(processJob(job.id, body, user.id));
    return json({ status: "processing", job_id: job.id, progress: 0, stage: "Aguardando processamento" }, 202);
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : "erro";
    console.error("[network-listening]", msg);
    return json({ error: "SERVICE_UNAVAILABLE", message: msg, fallback: false, fallback_used: false }, 200);
  }
});
