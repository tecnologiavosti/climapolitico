// Visão por Rede Social — Análise Qualitativa por IA.
// Não retorna métricas quantitativas frágeis. Apenas texto/listas geradas pela IA
// a partir de busca web leve + conhecimento geral do modelo.

import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { collectGoogleNews, collectReddit, type FreeHit } from "../_shared/free-collectors.ts";

interface RequestBody {
  candidate_name: string;
  party?: string | null;
  region?: string | null;
  network?: string;
  start_date: string;
  end_date: string;
}

interface QualitativeReport {
  summary: string;
  sentiment: { positive: number; neutral: number; negative: number };
  narratives: { positive: string[]; negative: string[]; neutral: string[] };
  hashtags: string[];
  terms: {
    pessoas: string[];
    partidos: string[];
    estados: string[];
    instituicoes: string[];
    slogans: string[];
  };
  recommendations: { riscos: string[]; oportunidades: string[]; comunicacao: string[] };
  network: string;
  period: { start: string; end: string };
  evidence_used: number;
  generated_at: string;
}

const NETWORK_LABEL: Record<string, string> = {
  all: "todas as redes sociais e veículos de notícias",
  news: "veículos de notícias e portais jornalísticos",
  youtube: "YouTube (vídeos, lives e comentários)",
  twitter: "X / Twitter",
  x: "X / Twitter",
  telegram: "Telegram",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  reddit: "Reddit (subs em português)",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};

function buildContext(hits: FreeHit[], limit = 25): string {
  if (!hits.length) return "Nenhuma evidência web recente recuperada. Use conhecimento geral.";
  return hits.slice(0, limit).map((h, i) => {
    const parts = [
      h.title ? `Título: ${h.title}` : "",
      h.source ? `Fonte: ${h.source}` : "",
      h.date ? `Data: ${h.date}` : "",
      h.description ? `Resumo: ${h.description.slice(0, 280)}` : "",
    ].filter(Boolean);
    return `[${i + 1}] ${parts.join(" | ")}`;
  }).join("\n");
}

function clampPercent(report: QualitativeReport): QualitativeReport {
  const s = report.sentiment ?? { positive: 33, neutral: 34, negative: 33 };
  const p = Math.max(0, Math.min(100, Math.round(s.positive ?? 0)));
  const n = Math.max(0, Math.min(100, Math.round(s.negative ?? 0)));
  let u = Math.max(0, Math.min(100, Math.round(s.neutral ?? 0)));
  const sum = p + n + u;
  if (sum === 0) return { ...report, sentiment: { positive: 33, neutral: 34, negative: 33 } };
  if (sum !== 100) u = Math.max(0, 100 - p - n);
  return { ...report, sentiment: { positive: p, neutral: u, negative: n } };
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.candidate_name || !body.start_date || !body.end_date) {
      return jsonResponse({ error: "MISSING_PARAMS" }, 400);
    }
    const network = (body.network ?? "all").toLowerCase();
    const networkLabel = NETWORK_LABEL[network] ?? network;
    const query = [body.candidate_name, body.party].filter(Boolean).join(" ");

    // Contexto leve: Google News + Reddit. Falhas não derrubam o pipeline.
    const [news, reddit] = await Promise.allSettled([
      collectGoogleNews(query, body.start_date, body.end_date),
      collectReddit(query, body.start_date, body.end_date),
    ]);
    const hits: FreeHit[] = [];
    if (news.status === "fulfilled") hits.push(...news.value.hits);
    if (reddit.status === "fulfilled") hits.push(...reddit.value.hits);

    const context = buildContext(hits);

    const systemMsg = `Você é um analista político brasileiro especializado em escuta digital qualitativa.
Sua missão é produzir análise interpretativa em PT-BR sobre como um candidato é percebido em ${networkLabel}.
NUNCA invente números absolutos de menções ou interações. Use apenas estimativas percentuais de sentimento (0–100, soma 100).
Foque em narrativas, temas e tom. Mesmo com poucos dados, gere análise qualitativa baseada em conhecimento político geral.`;

    const userPrompt = `Candidato: ${body.candidate_name}
Partido: ${body.party ?? "não informado"}
Estado/Região: ${body.region ?? "não informado"}
Rede analisada: ${networkLabel}
Período: ${body.start_date} a ${body.end_date}

Evidências web recentes coletadas:
${context}

Produza um JSON estrito com este schema (em PT-BR, sem comentários):
{
  "summary": "1 a 2 parágrafos sobre como o candidato é percebido na rede, principais temas e tom geral",
  "sentiment": { "positive": int 0-100, "neutral": int 0-100, "negative": int 0-100 },
  "narratives": {
    "positive": ["narrativa 1", "narrativa 2", ...],
    "negative": ["..."],
    "neutral": ["..."]
  },
  "hashtags": ["#exemplo1", "#exemplo2", ...],
  "terms": {
    "pessoas": ["nome de pessoa", ...],
    "partidos": ["sigla ou nome", ...],
    "estados": ["UF ou nome", ...],
    "instituicoes": ["STF, Congresso, ...", ...],
    "slogans": ["slogan/lema", ...]
  },
  "recommendations": {
    "riscos": ["risco 1", ...],
    "oportunidades": ["oportunidade 1", ...],
    "comunicacao": ["sugestão 1", ...]
  }
}

Regras obrigatórias:
- Soma de sentiment.positive + neutral + negative = 100.
- Em "terms", NUNCA inclua verbos. Apenas substantivos próprios e nomes.
- Cada lista de narrativas deve ter 2 a 5 itens curtos (1 frase cada).
- Cada lista de recomendações deve ter 2 a 4 itens acionáveis.
- Hashtags com #. Máximo 12.
- Se faltar evidência, ainda assim produza análise plausível baseada em contexto político brasileiro.`;

    const ai = await callAICerebrasFirst({
      systemMsg,
      userPrompt,
      jsonMode: true,
      maxTokens: 2200,
      temperature: 0.5,
      tag: "network-qualitative",
    });

    let parsed: QualitativeReport;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      const m = ai.content.match(/\{[\s\S]*\}/);
      if (!m) return jsonResponse({ error: "AI_PARSE_FAILED", raw: ai.content.slice(0, 500) }, 502);
      parsed = JSON.parse(m[0]);
    }

    const report: QualitativeReport = clampPercent({
      summary: String(parsed.summary ?? ""),
      sentiment: parsed.sentiment ?? { positive: 33, neutral: 34, negative: 33 },
      narratives: {
        positive: parsed.narratives?.positive ?? [],
        negative: parsed.narratives?.negative ?? [],
        neutral: parsed.narratives?.neutral ?? [],
      },
      hashtags: (parsed.hashtags ?? []).slice(0, 12),
      terms: {
        pessoas: parsed.terms?.pessoas ?? [],
        partidos: parsed.terms?.partidos ?? [],
        estados: parsed.terms?.estados ?? [],
        instituicoes: parsed.terms?.instituicoes ?? [],
        slogans: parsed.terms?.slogans ?? [],
      },
      recommendations: {
        riscos: parsed.recommendations?.riscos ?? [],
        oportunidades: parsed.recommendations?.oportunidades ?? [],
        comunicacao: parsed.recommendations?.comunicacao ?? [],
      },
      network,
      period: { start: body.start_date, end: body.end_date },
      evidence_used: hits.length,
      generated_at: new Date().toISOString(),
    });

    return jsonResponse({ report, provider: ai.provider, model: ai.model });
  } catch (err) {
    console.error("[network-qualitative-analysis]", err);
    return jsonResponse({ error: "INTERNAL_ERROR", message: (err as Error).message }, 500);
  }
});
