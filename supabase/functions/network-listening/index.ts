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
  return `social-v2|${b.candidate_id ?? normalizeText(b.candidate_name)}|${b.network ?? "all"}|${b.start_date}|${b.end_date}`;
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
  const bucket = bucketFor(days);
  return `Você é um analista sênior de social listening político no Brasil.
Sua tarefa: estimar o buzz digital sobre um político em um período específico, combinando evidências coletadas (Firecrawl) com seu conhecimento histórico.

REGRAS DE MATURIDADE DAS REDES NO BRASIL:
- TikTok: insignificante antes de 2020. Começa a relevância em 2021. Forte de 2022 em diante.
- Bluesky: praticamente inexistente antes de 2023.
- Instagram: relevante desde 2015, dominante para imagem após 2018.
- Telegram (política): explode a partir de 2018, forte 2020-2022.
- Twitter/X: dominante para debate político 2014-2024.
- Facebook: dominante 2014-2018, declina em alcance político após 2020.
- YouTube: relevante para discurso longo desde 2017; muito forte 2018-2022.
- Reddit: nicho no Brasil, mas relevante para discussão de subgrupos.
- Notícias: sempre presentes; baseline obrigatório.

PERFIL ESPERADO POR REDE (sentimento típico em política BR):
- Twitter/X: polarizado, com tendência negativa.
- Reddit: polarizado, crítico.
- Telegram: militante (forte pró ou forte contra dependendo dos canais).
- Facebook: misto, mais positivo entre apoiadores.
- Instagram: predominantemente neutro/positivo (imagem cuidada).
- TikTok: humor e viralização, polarizado.
- YouTube: depende do canal — equilibrado a polarizado.
- Notícias: neutro a levemente negativo (jornalismo crítico).

CONTEXTO HISTÓRICO RELEVANTE NO PERÍODO (${yearStart}-${yearEnd}):
- 2018: eleições, antipetismo, Lava Jato, fake news WhatsApp, ascensão Bolsonaro.
- 2019-2020: governo Bolsonaro, pandemia, polarização extrema.
- 2021-2022: vacinação, CPI da Covid, eleições Lula x Bolsonaro.
- 2023-2024: governo Lula, STF, 8 de janeiro, reforma tributária.
- 2025-2026: pré-eleições 2026, presidenciáveis.

INSTRUÇÕES:
- Use evidências quando existirem; quando faltarem, **infira** com base no contexto político e na maturidade das redes.
- Nunca retorne zero ou vazio: você sempre tem contexto suficiente para uma estimativa razoável.
- Não invente nomes próprios que não existem; mas estime números (volume, %).
- Termos devem ser entidades reais: pessoas, partidos, instituições, hashtags plausíveis, slogans, regiões. NUNCA verbos, stopwords ou fragmentos.
- Temas devem ser específicos ao candidato e período, não genéricos ("Congresso", "Economia").
- A timeline deve ter granularidade "${bucket}" e cobrir o período inteiro com curva realista (picos em eventos, vales fora deles).
- Sentimento por rede deve refletir o perfil típico da rede aplicado ao candidato/período.
- Distribuição por rede deve respeitar a maturidade da rede no ano.
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
    console.warn(`[network-listening] modelo ${m} → ${r.status}, tentando fallback`);
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

function networkWeights(body: Body): Distribution[] {
  const year = new Date(body.start_date).getUTCFullYear();
  const base: Record<string, number> = year < 2019
    ? { facebook: 34, twitter: 25, news: 20, youtube: 12, instagram: 6, telegram: 2, reddit: 1, tiktok: 0 }
    : year < 2021
      ? { twitter: 27, facebook: 22, news: 18, youtube: 16, instagram: 9, telegram: 6, reddit: 2, tiktok: 0 }
      : year < 2023
        ? { twitter: 25, youtube: 19, instagram: 15, telegram: 13, news: 13, facebook: 8, tiktok: 5, reddit: 2 }
        : { twitter: 23, instagram: 18, youtube: 17, tiktok: 13, news: 12, telegram: 8, facebook: 6, reddit: 3 };
  const entries = Object.entries(base).filter(([n]) => !body.network || body.network === "all" || body.network === n);
  const sum = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return entries.map(([network, v]) => ({ network, pct: Math.round((v / sum) * 100) }));
}

function makeTimeline(total: number, sentiment: { pos: number; neg: number; neu: number }, body: Body) {
  const days = daysBetween(body.start_date, body.end_date);
  const bucket = bucketFor(days);
  const step = bucket === "day" ? 1 : bucket === "week" ? 7 : bucket === "month" ? 30 : bucket === "quarter" ? 91 : 183;
  const points = Math.max(3, Math.min(36, Math.ceil(days / step)));
  const start = new Date(`${body.start_date}T00:00:00Z`);
  const weights = Array.from({ length: points }, (_, i) => 0.75 + Math.sin((i / Math.max(1, points - 1)) * Math.PI * 2) * 0.18 + (i % 5 === 2 ? 0.28 : 0));
  const sum = weights.reduce((s, w) => s + w, 0);
  return weights.map((w, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * step);
    const volume = Math.max(1, Math.round((total * w) / sum));
    return {
      date: d.toISOString().slice(0, 10),
      total: volume,
      positivo: Math.round(volume * (sentiment.pos / 100)),
      negativo: Math.round(volume * (sentiment.neg / 100)),
    };
  });
}

function lexicalSentiment(samples: SearchHit[]) {
  const positive = /\b(apoio|aprova|vitória|lidera|forte|avanço|entrega|popular|elogio|cresce|competente)\b/i;
  const negative = /\b(crise|denúncia|rejeição|critica|ataque|investigação|derrota|escândalo|polêmica|desgaste)\b/i;
  let pos = 0, neg = 0;
  for (const h of samples) {
    const text = `${h.title ?? ""} ${h.description ?? ""}`;
    if (positive.test(text)) pos += 1;
    if (negative.test(text)) neg += 1;
  }
  const total = Math.max(1, samples.length);
  const p = Math.max(18, Math.min(48, Math.round((pos / total) * 70 + 24)));
  const n = Math.max(20, Math.min(58, Math.round((neg / total) * 72 + 28)));
  const neu = Math.max(10, 100 - p - n);
  const scale = 100 / (p + n + neu);
  return { pos: Math.round(p * scale), neg: Math.round(n * scale), neu: Math.round(neu * scale) };
}

function extractTerms(body: Body, samples: SearchHit[]): Term[] {
  const terms = new Map<string, Term>();
  const add = (term: string, kind: Term["kind"], count = 1) => {
    const clean = term.trim().replace(/\s+/g, " ");
    if (clean.length < 2) return;
    const key = `${kind}:${clean.toLowerCase()}`;
    terms.set(key, { term: clean, kind, count: (terms.get(key)?.count ?? 0) + count });
  };
  add(body.candidate_name, "pessoa", 12);
  if (body.party) add(body.party, "partido", 8);
  if (body.state) add(body.state, "regiao", 6);
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

function heuristicReport(body: Body, samples: SearchHit[], sourceStatuses: SourceStatus[], reason: string) {
  const days = daysBetween(body.start_date, body.end_date);
  const bucket = bucketFor(days);
  const weights = networkWeights(body);
  const hash = normalizeText(body.candidate_name).split("").reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const evidenceBoost = Math.max(1, samples.length / 4);
  const totalMentions = Math.max(180, Math.round((days * (85 + (hash % 55)) * Math.log10(days + 20) * evidenceBoost) / (body.network && body.network !== "all" ? 3.2 : 1)));
  const sentiment = lexicalSentiment(samples);
  const net = sentiment.pos - sentiment.neg;
  const distribution = weights.map((w) => ({ ...w, mentions: Math.round(totalMentions * (w.pct / 100)) }));
  const topicsBase = [
    `Imagem pública de ${body.candidate_name.split(" ")[0]}`,
    body.state ? `Disputa política em ${body.state}` : "Disputa política nacional",
    body.party ? `Alianças e movimentação do ${body.party}` : "Alianças e movimentação partidária",
    "Cobertura jornalística e repercussão digital",
    "Críticas, apoios e polarização nas redes",
  ];
  const topics = topicsBase.map((label, i) => {
    const mentions = Math.round(totalMentions * ([0.28, 0.22, 0.19, 0.17, 0.14][i] ?? 0.1));
    return { label, mentions, pos: Math.round(mentions * sentiment.pos / 100), neg: Math.round(mentions * sentiment.neg / 100), neu: Math.round(mentions * sentiment.neu / 100) };
  });
  return {
    total_mentions: totalMentions,
    total_interactions: Math.round(totalMentions * (8 + (hash % 14))),
    sentiment,
    net_sentiment: net,
    net_label: net >= 10 ? "Favorável" : net <= -10 ? "Desfavorável" : "Neutro",
    dominant_network: distribution[0]?.network ?? body.network ?? "news",
    distribution,
    timeline: makeTimeline(totalMentions, sentiment, body),
    sentiment_by_network: distribution.map((d) => ({ network: d.network, pos: sentiment.pos, neg: sentiment.neg + (d.network === "twitter" || d.network === "reddit" ? 8 : 0), neu: sentiment.neu })),
    topics,
    terms: extractTerms(body, samples),
    confidence: samples.length >= 10 ? "medium" : "low",
    reasoning: `${reason} Resultado estimado por fallback heurístico local com classificação lexical, extração de entidades e maturidade histórica das redes.`,
    evidence_count: samples.length,
    bucket,
    sources: sourceStatuses,
    fallback: true,
  };
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
    await updateJob(admin, jobId, { status: "running", progress: 12, stage: "Coletando notícias...", started_at: new Date().toISOString(), logs });

    const tasks = buildSourceTasks(body);
    const evidence: Array<{ net: Network; source: string; hits: SearchHit[] }> = [];
    const sourceStatuses: SourceStatus[] = [];

    for (const batch of [1, 2, 3]) {
      const batchTasks = tasks.filter((t) => t.batch === batch);
      if (!batchTasks.length) continue;
      const stage = batch === 1 ? "Coletando notícias..." : batch === 2 ? "Analisando redes..." : "Coletando vídeos e comunidades...";
      const progress = batch === 1 ? 20 : batch === 2 ? 45 : 62;
      await updateJob(admin, jobId, { progress, stage, logs });
      const batchStarted = Date.now();
      const results = await runLimited(batchTasks, MAX_CONCURRENT_REQUESTS, (task) => firecrawlSearch(task, 8));
      results.forEach((result, i) => {
        const task = batchTasks[i];
        evidence.push({ net: task.net, source: task.source, hits: result.hits });
        sourceStatuses.push(result.status);
        if (result.status.status === "rate_limited") log("rate_limit", { source: task.source });
      });
      log("batch_done", { batch, duration_ms: Date.now() - batchStarted, sources: batchTasks.length });
    }

    await updateJob(admin, jobId, { progress: 68, stage: "Pré-processando amostras...", sources: sourceStatuses, logs });
    const samples = preprocessEvidence(evidence);
    const totalHits = samples.length;
    const days = daysBetween(body.start_date, body.end_date);
    const bucket = bucketFor(days);
    let report: any;

    const allSourcesFailed = sourceStatuses.length > 0 && sourceStatuses.every((s) => ["rate_limited", "timeout", "error", "skipped"].includes(s.status));
    if (allSourcesFailed) {
      log("all_sources_failed", { sources: sourceStatuses.length });
      report = heuristicReport(body, samples, sourceStatuses, "Todas as fontes externas falharam ou limitaram a coleta.");
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
        instructions: `Gere um relatório completo. Se evidence_count < 5, marque confidence="low" mas ainda assim infira valores plausíveis. Distribua a timeline com ${bucket === "day" ? "dias" : bucket === "week" ? "semanas" : bucket === "month" ? "meses" : bucket === "quarter" ? "trimestres" : "semestres"} cobrindo todo o período.`,
      });
      try {
        const aiStarted = Date.now();
        report = await callAI(systemPrompt(body, days), user);
        log("ai_done", { duration_ms: Date.now() - aiStarted });
      } catch (e: any) {
        log("ai_failed", { error: (e as Error)?.message ?? String(e), status: e?.status ?? null });
        report = heuristicReport(body, samples, sourceStatuses, "A IA excedeu limite, tempo ou créditos.");
      }
    }

    await updateJob(admin, jobId, { progress: 93, stage: "Gerando gráficos...", logs });
    const out = { ...report, evidence_count: totalHits, bucket, cached: false, sources: sourceStatuses, job_id: jobId };
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
    const fallback = heuristicReport(body, [], [], "Falha geral do job.");
    await updateJob(admin, jobId, { status: "failed", progress: 100, stage: "Falha ao processar", result: fallback, error: message, logs, completed_at: new Date().toISOString() });
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
    return json({ error: "SERVICE_UNAVAILABLE", message: msg, fallback: true }, 200);
  }
});
