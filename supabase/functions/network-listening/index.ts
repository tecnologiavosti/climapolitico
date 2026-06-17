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

// Constrói queries Firecrawl direcionadas por rede e período
function buildQueries(b: Body): Array<{ q: string; net: Network; tbs?: string }> {
  const name = b.candidate_name;
  const ctx = [b.party, b.state].filter(Boolean).join(" ");
  const base = `${name} ${ctx}`.trim();
  const out: Array<{ q: string; net: Network; tbs?: string }> = [];

  const wantAll = !b.network || b.network === "all";
  const want = (n: Network) => wantAll || b.network === n;

  // Recorte temporal — limitamos via after:/before: nas queries
  const dateRange = `after:${b.start_date} before:${b.end_date}`;

  if (want("news")) out.push({ q: `${base} ${dateRange}`, net: "news" });
  if (want("twitter")) out.push({ q: `${base} site:twitter.com OR site:x.com ${dateRange}`, net: "twitter" });
  if (want("youtube")) out.push({ q: `${base} site:youtube.com ${dateRange}`, net: "youtube" });
  if (want("reddit")) out.push({ q: `${base} site:reddit.com ${dateRange}`, net: "reddit" });
  if (want("facebook")) out.push({ q: `${base} site:facebook.com ${dateRange}`, net: "facebook" });
  if (want("instagram")) out.push({ q: `${base} site:instagram.com ${dateRange}`, net: "instagram" });
  if (want("tiktok")) out.push({ q: `${base} site:tiktok.com ${dateRange}`, net: "tiktok" });
  if (want("telegram")) out.push({ q: `${base} site:t.me ${dateRange}`, net: "telegram" });
  return out;
}

async function firecrawlSearch(query: string, limit = 8): Promise<SearchHit[]> {
  if (!FIRECRAWL_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit }),
    });
    if (!r.ok) {
      console.warn("[network-listening] firecrawl", r.status, await r.text().catch(() => ""));
      return [];
    }
    const j = await r.json();
    const raw: any[] = j?.data?.web ?? j?.data ?? j?.results ?? [];
    return raw.slice(0, limit).map((x) => ({
      url: x.url,
      title: x.title,
      description: x.description ?? x.snippet ?? "",
      source: x.source ?? x.url,
      date: x.publishedDate ?? x.date ?? undefined,
    }));
  } catch (e) {
    console.warn("[network-listening] firecrawl exception", e);
    return [];
  }
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

async function callAIWithModel(model: string, systemMsg: string, userMsg: string) {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_KEY}`,
      "Content-Type": "application/json",
    },
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
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
    "google/gemini-3-flash-preview",
  ];
  let lastStatus = 0;
  let lastErr = "";
  for (const m of models) {
    const r = await callAIWithModel(m, systemMsg, userMsg);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.candidate_name || !body.start_date || !body.end_date) {
      return new Response(JSON.stringify({ error: "candidate_name, start_date, end_date obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = cacheKey(body);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) {
      return new Response(JSON.stringify({ ...(hit.data as object), cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const queries = buildQueries(body);
    const evidence: Array<{ net: Network; hits: SearchHit[] }> = [];
    // Roda em paralelo, mas limitado
    const results = await Promise.all(queries.map((q) => firecrawlSearch(q.q, 6)));
    queries.forEach((q, i) => evidence.push({ net: q.net, hits: results[i] }));

    const totalHits = evidence.reduce((s, e) => s + e.hits.length, 0);
    const days = daysBetween(body.start_date, body.end_date);
    const bucket = bucketFor(days);

    // Corpus compacto enviado para IA
    const evidenceForAi = evidence.map((e) => ({
      network: e.net,
      hits: e.hits.slice(0, 6).map((h) => ({
        title: (h.title ?? "").slice(0, 160),
        snippet: (h.description ?? "").slice(0, 220),
        date: h.date ?? null,
        source: h.source ?? null,
      })),
    }));

    const user = JSON.stringify({
      candidate: body.candidate_name,
      party: body.party ?? null,
      office: body.office ?? null,
      state: body.state ?? null,
      period: { start: body.start_date, end: body.end_date, days, bucket },
      network_filter: body.network ?? "all",
      evidence_count: totalHits,
      evidence: evidenceForAi,
      instructions: `Gere um relatório completo. Se evidence_count < 5, marque confidence="low" mas ainda assim infira valores plausíveis a partir do contexto histórico e da maturidade das redes. Distribua a timeline com ${bucket === "day" ? "dias" : bucket === "week" ? "semanas" : bucket === "month" ? "meses" : bucket === "quarter" ? "trimestres" : "semestres"} cobrindo todo o período.`,
    });

    const report = await callAI(systemPrompt(body, days), user);

    const out = { ...report, evidence_count: totalHits, bucket, cached: false };
    cache.set(key, { at: Date.now(), data: out });

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : "erro";
    const status = e?.status ?? 0;
    console.error("[network-listening]", msg);
    const rateLimited = status === 429;
    const noCredits = status === 402;
    return new Response(
      JSON.stringify({
        error: rateLimited
          ? "RATE_LIMITED"
          : noCredits
            ? "NO_CREDITS"
            : "SERVICE_UNAVAILABLE",
        message: rateLimited
          ? "Muitas requisições no momento. Tente novamente em alguns instantes."
          : noCredits
            ? "Créditos de IA esgotados no workspace. Adicione créditos para continuar."
            : msg,
        fallback: true,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
