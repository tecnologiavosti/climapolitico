// Visão por Rede Social — Social Listening Qualitativo por IA.
// Foco em percepção, polarização, gatilhos de engajamento e linguagem associada.
// NÃO retorna resumo executivo, narrativas detectadas ou recomendações estratégicas
// (esses blocos vivem em outras abas — evitar redundância).

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
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

type Intensidade = "morna" | "quente" | "fervendo";
type Polarizacao = "BAIXA" | "MEDIA" | "ALTA";

interface ListeningReport {
  temperatura: {
    texto: string;
    intensidade: Intensidade;
    temas_dominantes: string[];
  };
  conversa_por_rede: Array<{ rede: string; papel: string }>;
  gatilhos: {
    aumenta: string[];
    reduz: string[];
  };
  polarizacao: {
    nivel: Polarizacao;
    apoiadores: string;
    criticos: string;
    neutros: string;
  };
  linguagem: {
    palavras_recorrentes: string[];
    tom_dominante: string[];
    entidades: string[];
  };
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

function normalizeIntensidade(v: unknown): Intensidade {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("ferv")) return "fervendo";
  if (s.includes("quent")) return "quente";
  return "morna";
}

function normalizePolarizacao(v: unknown): Polarizacao {
  const s = String(v ?? "").toUpperCase();
  if (s.startsWith("A")) return "ALTA";
  if (s.startsWith("B")) return "BAIXA";
  return "MEDIA";
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

    const [news, reddit] = await Promise.allSettled([
      collectGoogleNews(query, body.start_date, body.end_date),
      collectReddit(query, body.start_date, body.end_date),
    ]);
    const hits: FreeHit[] = [];
    if (news.status === "fulfilled") hits.push(...news.value.hits);
    if (reddit.status === "fulfilled") hits.push(...reddit.value.hits);

    const context = buildContext(hits);

    const systemMsg = `Você é um analista de social listening profissional (padrão Brandwatch/Meltwater/Sprinklr) especializado em política brasileira.
Sua missão: produzir leitura qualitativa de PERCEPÇÃO em ${networkLabel}.
NUNCA invente hashtags artificiais, números absolutos de menções ou interações.
NUNCA escreva resumo executivo, narrativas detectadas ou recomendações estratégicas — esses blocos existem em outras abas.
Foque exclusivamente em: temperatura da conversa, papel de cada rede, gatilhos de engajamento, polarização e linguagem associada.
Escreva em PT-BR claro, conciso e analítico.`;

    const userPrompt = `Candidato: ${body.candidate_name}
Partido: ${body.party ?? "não informado"}
Estado/Região: ${body.region ?? "não informado"}
Rede analisada: ${networkLabel}
Período: ${body.start_date} a ${body.end_date}

Evidências web recentes:
${context}

Produza um JSON estrito (sem comentários) com este schema:
{
  "temperatura": {
    "texto": "2 a 4 frases explicando como o candidato está sendo percebido, se a conversa está morna/quente/fervendo, e quais temas dominam",
    "intensidade": "morna" | "quente" | "fervendo",
    "temas_dominantes": ["tema 1", "tema 2", "tema 3"]
  },
  "conversa_por_rede": [
    { "rede": "X/Twitter", "papel": "papel interpretado dessa rede para o candidato" },
    { "rede": "YouTube", "papel": "..." },
    { "rede": "Instagram", "papel": "..." },
    { "rede": "Telegram", "papel": "..." }
  ],
  "gatilhos": {
    "aumenta": ["o que aumenta comentários/engajamento — 3 a 5 itens curtos"],
    "reduz": ["o que reduz comentários/engajamento — 2 a 4 itens curtos"]
  },
  "polarizacao": {
    "nivel": "BAIXA" | "MEDIA" | "ALTA",
    "apoiadores": "1 frase descrevendo quem apoia (perfis, bases, regiões)",
    "criticos": "1 frase descrevendo quem critica",
    "neutros": "1 frase descrevendo quem observa sem se posicionar"
  },
  "linguagem": {
    "palavras_recorrentes": ["palavra/expressão 1", ... 6 a 12 itens, SEM hashtags inventadas, SEM verbos"],
    "tom_dominante": ["adjetivo de tom 1", ... 3 a 6 itens, ex: combativo, irônico, institucional, mobilizador"],
    "entidades": ["pessoa/partido/instituição/estado 1", ... 4 a 10 nomes próprios relevantes"]
  }
}

Regras obrigatórias:
- NUNCA invente hashtags como #CaiadoNoCerrado. Só liste palavras/expressões reais usadas no debate.
- Em "entidades" só substantivos próprios (pessoas, partidos, instituições, estados). Sem verbos.
- "tom_dominante" são adjetivos curtos descrevendo o tom da conversa.
- Sempre liste as 4 redes principais (X/Twitter, YouTube, Instagram, Telegram) em conversa_por_rede, mesmo que o foco seja ${networkLabel}.
- Mesmo com poucas evidências, produza leitura plausível baseada em contexto político brasileiro.`;

    const ai = await callAICerebrasFirst({
      systemMsg,
      userPrompt,
      jsonMode: true,
      maxTokens: 2200,
      temperature: 0.5,
      tag: "network-listening-qualitative",
    });

    let parsed: any;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      const m = ai.content.match(/\{[\s\S]*\}/);
      if (!m) return jsonResponse({ error: "AI_PARSE_FAILED", raw: ai.content.slice(0, 500) }, 502);
      parsed = JSON.parse(m[0]);
    }

    const report: ListeningReport = {
      temperatura: {
        texto: String(parsed?.temperatura?.texto ?? ""),
        intensidade: normalizeIntensidade(parsed?.temperatura?.intensidade),
        temas_dominantes: Array.isArray(parsed?.temperatura?.temas_dominantes)
          ? parsed.temperatura.temas_dominantes.slice(0, 8)
          : [],
      },
      conversa_por_rede: Array.isArray(parsed?.conversa_por_rede)
        ? parsed.conversa_por_rede
            .filter((r: any) => r && r.rede && r.papel)
            .slice(0, 8)
            .map((r: any) => ({ rede: String(r.rede), papel: String(r.papel) }))
        : [],
      gatilhos: {
        aumenta: Array.isArray(parsed?.gatilhos?.aumenta) ? parsed.gatilhos.aumenta.slice(0, 6) : [],
        reduz: Array.isArray(parsed?.gatilhos?.reduz) ? parsed.gatilhos.reduz.slice(0, 6) : [],
      },
      polarizacao: {
        nivel: normalizePolarizacao(parsed?.polarizacao?.nivel),
        apoiadores: String(parsed?.polarizacao?.apoiadores ?? ""),
        criticos: String(parsed?.polarizacao?.criticos ?? ""),
        neutros: String(parsed?.polarizacao?.neutros ?? ""),
      },
      linguagem: {
        palavras_recorrentes: Array.isArray(parsed?.linguagem?.palavras_recorrentes)
          ? parsed.linguagem.palavras_recorrentes.slice(0, 14)
          : [],
        tom_dominante: Array.isArray(parsed?.linguagem?.tom_dominante)
          ? parsed.linguagem.tom_dominante.slice(0, 8)
          : [],
        entidades: Array.isArray(parsed?.linguagem?.entidades)
          ? parsed.linguagem.entidades.slice(0, 12)
          : [],
      },
      network,
      period: { start: body.start_date, end: body.end_date },
      evidence_used: hits.length,
      generated_at: new Date().toISOString(),
    };

    return jsonResponse({ report, provider: ai.provider, model: ai.model });
  } catch (err) {
    console.error("[network-qualitative-analysis]", err);
    return jsonResponse({ error: "INTERNAL_ERROR", message: (err as Error).message }, 500);
  }
});
