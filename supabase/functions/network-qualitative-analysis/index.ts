// Visão por Rede Social — Social Listening Qualitativo (enterprise-grade).
// Blocos: Temperatura, Termômetro de Reputação, Vetores de Polarização,
// Gatilhos Emocionais (Apoio/Rejeição), Vocabulário da Rede, Risco de Viralização.

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
type Reputacao = "favoravel" | "neutro" | "desgastado" | "polarizado" | "em_ascensao" | "em_queda";
type Viralizacao = "alta" | "media" | "baixa";

interface ListeningReport {
  temperatura: { texto: string; intensidade: Intensidade; temas_dominantes: string[] };
  reputacao: { status: Reputacao; texto: string };
  vetores_polarizacao: {
    ideologica: number;
    regional: number;
    geracional: number;
    tematica: number;
    nota: string;
  };
  gatilhos_emocionais: { apoio: string[]; rejeicao: string[] };
  vocabulario: {
    palavras_nucleares: string[];
    adjetivos_associados: string[];
    frases_recorrentes: string[];
  };
  risco_viralizacao: Array<{ tema: string; nivel: Viralizacao; motivo: string }>;
  network: string;
  period: { start: string; end: string };
  evidence_used: number;
  generated_at: string;
}

const NETWORK_LABEL: Record<string, string> = {
  all: "todas as redes sociais e veículos de notícias",
  news: "veículos de notícias e portais jornalísticos",
  youtube: "YouTube",
  twitter: "X / Twitter",
  x: "X / Twitter",
  telegram: "Telegram",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  reddit: "Reddit",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};

function buildContext(hits: FreeHit[], limit = 30): string {
  if (!hits.length) return "Sem evidências web recentes. Use conhecimento político geral sobre o candidato.";
  return hits.slice(0, limit).map((h, i) => {
    const parts = [
      h.title ? `T: ${h.title}` : "",
      h.source ? `F: ${h.source}` : "",
      h.date ? `D: ${h.date}` : "",
      h.description ? `R: ${h.description.slice(0, 240)}` : "",
    ].filter(Boolean);
    return `[${i + 1}] ${parts.join(" | ")}`;
  }).join("\n");
}

function normIntensidade(v: unknown): Intensidade {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("ferv")) return "fervendo";
  if (s.includes("quent")) return "quente";
  return "morna";
}

function normReputacao(v: unknown): Reputacao {
  const s = String(v ?? "").toLowerCase().replace(/\s+/g, "_");
  if (s.includes("ascens")) return "em_ascensao";
  if (s.includes("queda")) return "em_queda";
  if (s.includes("desgast")) return "desgastado";
  if (s.includes("polariz")) return "polarizado";
  if (s.includes("favor")) return "favoravel";
  return "neutro";
}

function normViralizacao(v: unknown): Viralizacao {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("a")) return "alta";
  if (s.startsWith("b")) return "baixa";
  return "media";
}

function clamp(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 50;
  return Math.max(0, Math.min(100, Math.round(x)));
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

    const systemMsg = `Você é um analista sênior de social listening político brasileiro (padrão Brandwatch/Meltwater/Sprinklr).
Sua missão: produzir leitura ESPECÍFICA e PERSONALIZADA sobre o candidato — nunca genérica, nunca template.
Cada candidato deve ter saída claramente diferente, refletindo trajetória, partido, base, controvérsias e estilo.

PROIBIÇÕES ABSOLUTAS:
- NÃO descreva redes sociais de forma estática ("X é polarizado", "YouTube tem vídeos").
- NÃO invente hashtags artificiais.
- NÃO use termos sem relação semântica forte com o candidato (ex.: para Caiado, não citar "Amazônia" ou "Vorcaro").
- NÃO repita templates genéricos.
- Em "vocabulario.adjetivos_associados" e "palavras_nucleares", só inclua termos que a opinião pública realmente associa àquele candidato específico.
Escreva em PT-BR analítico e direto.`;

    const userPrompt = `Candidato: ${body.candidate_name}
Partido: ${body.party ?? "não informado"}
Estado/Região: ${body.region ?? "não informado"}
Rede analisada: ${networkLabel}
Período: ${body.start_date} a ${body.end_date}

Evidências web recentes:
${context}

Produza um JSON estrito (sem comentários) com este schema EXATO:
{
  "temperatura": {
    "texto": "2-3 frases sobre percepção atual, calor da conversa e temas dominantes ESPECÍFICOS do candidato",
    "intensidade": "morna" | "quente" | "fervendo",
    "temas_dominantes": ["3-6 temas concretos ligados ao candidato"]
  },
  "reputacao": {
    "status": "favoravel" | "neutro" | "desgastado" | "polarizado" | "em_ascensao" | "em_queda",
    "texto": "1-2 frases explicando reputação ATUAL do candidato com bases concretas (quem apoia, quem rejeita, por quê)"
  },
  "vetores_polarizacao": {
    "ideologica": 0-100 (esquerda vs direita em torno do candidato),
    "regional": 0-100 (diferença de percepção entre regiões/UFs),
    "geracional": 0-100 (jovens vs mais velhos),
    "tematica": 0-100 (concentração em poucos temas polêmicos),
    "nota": "1 frase explicando o vetor mais forte e por quê"
  },
  "gatilhos_emocionais": {
    "apoio": ["3-5 itens curtos — o que GERA APOIO ao candidato (pautas, posturas, símbolos)"],
    "rejeicao": ["3-5 itens curtos — o que GERA REJEIÇÃO (controvérsias, falas, associações)"]
  },
  "vocabulario": {
    "palavras_nucleares": ["5-10 substantivos/temas DIRETAMENTE ligados ao candidato — nada genérico"],
    "adjetivos_associados": ["4-8 adjetivos com que a rede DESCREVE esse candidato em específico"],
    "frases_recorrentes": ["3-6 expressões/bordões/slogans realmente associados a esse candidato"]
  },
  "risco_viralizacao": [
    { "tema": "tema específico", "nivel": "alta" | "media" | "baixa", "motivo": "1 frase explicando por que pode (ou não) viralizar" },
    ... 4 a 6 temas
  ]
}

REGRAS:
- Cada bloco deve refletir ESTE candidato, não um candidato genérico.
- "vocabulario" deve passar no teste: se um leitor político ler, deve dizer "isso é cara desse candidato".
- "vetores_polarizacao" devem variar entre candidatos (não use sempre 70/70/70/70).
- Sem hashtags inventadas. Sem entidades sem ligação forte.`;

    const ai = await callAICerebrasFirst({
      systemMsg,
      userPrompt,
      jsonMode: true,
      maxTokens: 2600,
      temperature: 0.55,
      tag: "network-listening-v3",
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
        intensidade: normIntensidade(parsed?.temperatura?.intensidade),
        temas_dominantes: Array.isArray(parsed?.temperatura?.temas_dominantes)
          ? parsed.temperatura.temas_dominantes.slice(0, 8).map(String)
          : [],
      },
      reputacao: {
        status: normReputacao(parsed?.reputacao?.status),
        texto: String(parsed?.reputacao?.texto ?? ""),
      },
      vetores_polarizacao: {
        ideologica: clamp(parsed?.vetores_polarizacao?.ideologica),
        regional: clamp(parsed?.vetores_polarizacao?.regional),
        geracional: clamp(parsed?.vetores_polarizacao?.geracional),
        tematica: clamp(parsed?.vetores_polarizacao?.tematica),
        nota: String(parsed?.vetores_polarizacao?.nota ?? ""),
      },
      gatilhos_emocionais: {
        apoio: Array.isArray(parsed?.gatilhos_emocionais?.apoio)
          ? parsed.gatilhos_emocionais.apoio.slice(0, 6).map(String)
          : [],
        rejeicao: Array.isArray(parsed?.gatilhos_emocionais?.rejeicao)
          ? parsed.gatilhos_emocionais.rejeicao.slice(0, 6).map(String)
          : [],
      },
      vocabulario: {
        palavras_nucleares: Array.isArray(parsed?.vocabulario?.palavras_nucleares)
          ? parsed.vocabulario.palavras_nucleares.slice(0, 12).map(String)
          : [],
        adjetivos_associados: Array.isArray(parsed?.vocabulario?.adjetivos_associados)
          ? parsed.vocabulario.adjetivos_associados.slice(0, 10).map(String)
          : [],
        frases_recorrentes: Array.isArray(parsed?.vocabulario?.frases_recorrentes)
          ? parsed.vocabulario.frases_recorrentes.slice(0, 8).map(String)
          : [],
      },
      risco_viralizacao: Array.isArray(parsed?.risco_viralizacao)
        ? parsed.risco_viralizacao
            .filter((r: any) => r && r.tema)
            .slice(0, 8)
            .map((r: any) => ({
              tema: String(r.tema),
              nivel: normViralizacao(r.nivel),
              motivo: String(r.motivo ?? ""),
            }))
        : [],
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
