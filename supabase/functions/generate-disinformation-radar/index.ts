import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CACHE = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30min

interface Payload {
  candidateId: string;
  daysBack?: number;
}

const STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","que","um","uma","para","por","com","em","no","na","nos","nas",
  "os","as","se","na","à","às","ao","aos","sua","seu","suas","seus","este","esta","isso","isto","aquilo",
  "ele","ela","eles","elas","você","voce","vocês","voces","é","era","foi","ser","estar","tem","tinha",
  "mais","menos","também","ja","já","não","sim","mas","como","onde","quando","porque","porquê","por que",
  "nao","tambem","the","and","of","for","to","in","on","at","is","are","was","were","be","this","that","it","https","http",
  "www","com","org","br","html","php","p","the","of","and","www","tem","the","um","2024","2025","2023"
]);

const STATE_TO_MACRO_REGION: Record<string, string> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

const PARTY_PROFILES: Record<string, string> = {
  PT: "campo progressista, alta polarização ideológica e exposição a narrativas sobre economia, programas sociais e corrupção sistêmica",
  PSOL: "esquerda programática, exposição a ataques ideológicos, costumes e segurança pública",
  PCDOB: "esquerda tradicional, exposição a ataques ideológicos e geopolíticos",
  PV: "centro-esquerda ambiental, exposição a ataques sobre agenda climática, agro e desenvolvimento",
  REDE: "campo socioambiental, exposição a narrativas sobre costumes, governabilidade e agenda ambiental",
  PSB: "centro-esquerda pragmática, exposição a ataques sobre alianças, gestão e coerência política",
  PDT: "trabalhismo, exposição a ataques sobre economia, alianças e gestão pública",
  MDB: "centro pragmático, exposição a narrativas sobre fisiologismo, alianças locais e máquina pública",
  PSD: "centro pragmático, exposição a narrativas sobre alianças, gestão e uso da máquina",
  PSDB: "centro-direita institucional, exposição a ataques sobre legado de gestão, alianças e elite política",
  UNIÃO: "centro-direita amplo, exposição a ataques sobre alianças regionais, orçamento e pragmatismo político",
  UNIAO: "centro-direita amplo, exposição a ataques sobre alianças regionais, orçamento e pragmatismo político",
  PP: "direita pragmática, exposição a narrativas sobre orçamento, emendas e alianças locais",
  PL: "direita conservadora, alta exposição a polarização ideológica, costumes, instituições e redes militantes",
  REPUBLICANOS: "direita conservadora institucional, exposição a narrativas sobre religião, costumes, alianças e máquina pública",
  NOVO: "direita liberal, exposição a ataques sobre elitismo, privatizações, austeridade e serviços públicos",
  PODE: "centro pragmático, exposição a ataques sobre alianças e consistência programática",
};

const TOPIC_TERMS: Record<string, string[]> = {
  Corrupção: ["corrupcao", "propina", "desvio", "roubo", "lavagem", "superfaturamento", "contrato", "licitacao", "licitações", "licita"],
  Economia: ["economia", "imposto", "taxa", "preco", "inflação", "inflacao", "emprego", "renda", "salario", "orçamento", "orcamento"],
  Segurança: ["seguranca", "segurança", "policia", "violencia", "crime", "facção", "faccao", "milicia", "homicidio"],
  Saúde: ["saude", "saúde", "hospital", "upa", "sus", "medico", "remedio", "fila", "consulta"],
  Educação: ["educacao", "educação", "escola", "creche", "merenda", "professor", "aluno", "universidade"],
  Obras: ["obra", "obras", "asfalto", "recapeamento", "ponte", "estrada", "transporte", "infraestrutura"],
  "Ataques pessoais": ["nepotismo", "familia", "parente", "aliado", "apadrinhado", "mordomia", "cabide", "privilegio"],
  Ideologia: ["ideologia", "costumes", "religiao", "religião", "comunismo", "bolsonarismo", "lulismo", "conservador", "progressista"],
};

const SAFE_KEYWORD_ALLOWLIST = new Set(Object.values(TOPIC_TERMS).flat().map((w) => normalizeForMatch(w)));
const FORBIDDEN_PATTERNS = [
  /feminic[ií]dio/i,
  /\bb[ií]blia\b/i,
  /pol[ií]cia federal/i,
  /\bpf\b/i,
  /\bstf\b/i,
  /\btse\b/i,
  /\bfolha\b/i,
  /\bglobo\b/i,
  /opera[cç][aã]o\s+[A-ZÁ-Úa-zá-ú]/i,
  /processo\s+judicial/i,
  /r\$\s*\d/i,
  /\b20\d{2}\b/,
];

function normalizeForMatch(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(text: string): string {
  return normalizeForMatch(text).replace(/\s+/g, " ");
}

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9áéíóúãõçâêô\s#@]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function topKeywords(texts: string[], limit = 20): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const w of tokenize(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function parseRegion(value?: string | null) {
  const region = value || "";
  const stateMatch = region.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
  const state = stateMatch?.[1]?.toUpperCase() || null;
  const city = region.includes(",") ? region.split(",")[0]?.trim() || null : null;
  return {
    city: city && !/brasil/i.test(city) ? city : null,
    state,
    macroRegion: state ? STATE_TO_MACRO_REGION[state] : (/brasil/i.test(region) ? "Brasil" : null),
  };
}

function officeScope(cargo?: string | null, region?: string | null) {
  const c = normalizeForMatch(cargo || "");
  if (c.includes("presidente") || /brasil/i.test(region || "")) return "presidencial";
  if (c.includes("governador") || c.includes("vice governador")) return "governador";
  if (c.includes("prefeito") || c.includes("vereador") || c.includes("municipal")) return "municipal";
  if (c.includes("deputado estadual") || c.includes("deputado distrital") || c.includes("secretario estadual")) return "estadual";
  if (c.includes("senador") || c.includes("deputado federal") || c.includes("ministro")) return "nacional_regional";
  if ((region || "").includes(",")) return "municipal";
  if ((region || "").match(/\b[A-Z]{2}\b/)) return "estadual";
  return "indefinido";
}

function themesForScope(scope: string) {
  if (scope === "municipal") return ["corrupção local", "nepotismo", "merenda", "saúde municipal", "obras", "licitações"];
  if (scope === "governador") return ["segurança", "orçamento estadual", "hospitais", "obras estaduais", "alianças partidárias"];
  if (scope === "presidencial") return ["corrupção sistêmica", "economia", "ideologia", "impostos", "programas sociais"];
  if (scope === "estadual") return ["emendas", "orçamento estadual", "segurança", "saúde", "alianças regionais", "obras"];
  if (scope === "nacional_regional") return ["votações polêmicas", "emendas", "alianças nacionais", "economia", "costumes"];
  return ["corrupção", "alianças políticas", "uso da máquina pública", "transparência", "ataques pessoais"];
}

function buildTopicSignals(texts: string[]) {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const normalized = normalizeForMatch(text);
    for (const [category, terms] of Object.entries(TOPIC_TERMS)) {
      if (terms.some((term) => normalized.includes(normalizeForMatch(term)))) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function safeParseJson(raw: string) {
  try { return JSON.parse(raw); } catch (_) { /* ignore */ }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) { /* ignore */ }
  }
  return null;
}

function strategicItems(candidateContext: any) {
  const scope = candidateContext?.nivel_cargo || "indefinido";
  if (scope === "municipal") return [
    { title: "Narrativas sobre favorecimento em contratos municipais", probability: 62, explanation: "Ataques locais costumam explorar dúvidas sobre fornecedores, licitações e proximidade com grupos econômicos da cidade, mesmo sem apresentar documentação verificável.", likely_origin: "adversários locais e grupos de WhatsApp da região" },
    { title: "Boatos sobre nepotismo e nomeações políticas", probability: 58, explanation: "Em disputas municipais, a desinformação frequentemente tenta associar o candidato a apadrinhamentos e ocupação da máquina pública por aliados.", likely_origin: "perfis anônimos locais e páginas de bairro" },
    { title: "Ataques sobre obras, recapeamento e infraestrutura", probability: 55, explanation: "Obras visíveis no território são alvo comum porque geram comparação direta entre promessa, execução e percepção cotidiana do eleitor.", likely_origin: "grupos comunitários e oposição municipal" },
    { title: "Questionamentos sobre saúde, creches e merenda", probability: 52, explanation: "Serviços públicos próximos do eleitor são usados como gatilho emocional para criar suspeitas vagas de má gestão.", likely_origin: "correntes de WhatsApp e comentários em páginas locais" },
  ];
  if (scope === "governador") return [
    { title: "Narrativas sobre crise de segurança pública", probability: 64, explanation: "Governadores são responsabilizados diretamente por indicadores de violência, policiamento e sensação de segurança.", likely_origin: "perfis regionais de oposição e páginas policiais" },
    { title: "Ataques sobre filas em hospitais e gestão da saúde", probability: 59, explanation: "A saúde estadual é um vetor recorrente de desinformação por mobilizar medo e indignação em larga escala.", likely_origin: "grupos regionais e páginas de denúncia" },
    { title: "Boatos sobre orçamento e obras estaduais", probability: 56, explanation: "Grandes obras e execução orçamentária são frequentemente simplificadas em acusações vagas de desperdício ou favorecimento.", likely_origin: "oposição estadual e perfis anônimos" },
    { title: "Questionamentos sobre alianças partidárias", probability: 50, explanation: "Coalizões amplas podem ser exploradas como sinal de incoerência ou troca de apoio político.", likely_origin: "militância digital adversária" },
  ];
  if (scope === "presidencial") return [
    { title: "Narrativas sobre deterioração econômica e impostos", probability: 66, explanation: "Disputas nacionais tendem a transformar inflação, carga tributária e renda em mensagens simplificadas e emocionalmente carregadas.", likely_origin: "redes ideológicas nacionais e grupos de mensagens" },
    { title: "Ataques sobre corrupção sistêmica", probability: 62, explanation: "Candidaturas presidenciais são alvos recorrentes de acusações amplas sobre corrupção e aparelhamento, mesmo quando não há evidência nova.", likely_origin: "perfis hiperpartidários e canais de opinião" },
    { title: "Boatos sobre programas sociais", probability: 57, explanation: "Benefícios sociais costumam ser usados para espalhar medo de cortes, manipulação eleitoral ou uso político de cadastros.", likely_origin: "correntes nacionais de WhatsApp e Telegram" },
    { title: "Ataques ideológicos e de costumes", probability: 55, explanation: "Polarização nacional favorece narrativas moralizantes e identitárias que deslocam o debate de propostas concretas.", likely_origin: "ecossistemas militantes nas redes sociais" },
  ];
  return [
    { title: "Narrativas sobre uso da máquina pública", probability: 56, explanation: "Ataques políticos frequentemente tentam associar o candidato a vantagens indevidas e aparelhamento institucional.", likely_origin: "oposição organizada e grupos de mensagens" },
    { title: "Boatos sobre alianças e troca de apoio", probability: 52, explanation: "Acordos partidários são alvo comum de leituras maliciosas sobre incoerência, fisiologismo ou interesses ocultos.", likely_origin: "perfis anônimos e militância adversária" },
    { title: "Questionamentos sobre transparência de gastos", probability: 50, explanation: "Narrativas de baixa evidência costumam explorar temas administrativos difíceis de verificar rapidamente pelo eleitor comum.", likely_origin: "páginas de denúncia e grupos locais" },
    { title: "Ataques pessoais sobre coerência política", probability: 48, explanation: "Mudanças de posição, alianças ou declarações antigas podem ser recortadas para sustentar narrativas de oportunismo.", likely_origin: "redes adversárias e cortes de vídeo" },
  ];
}

function sanitizeReport(report: any, candidateContext: any) {
  const baseItems = strategicItems(candidateContext);
  const rawItems = Array.isArray(report?.fake_news_items) ? report.fake_news_items : [];
  const safeItems = rawItems
    .filter((item: any) => {
      const text = `${item?.title || ""} ${item?.explanation || ""} ${item?.likely_origin || ""}`;
      return text.trim() && !FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
    })
    .map((item: any) => ({
      title: String(item.title || "Narrativa de desinformação plausível").slice(0, 180),
      probability: Math.max(25, Math.min(85, Number(item.probability) || 50)),
      explanation: String(item.explanation || "Narrativa plausível para o contexto político do candidato.").slice(0, 420),
      likely_origin: item.likely_origin ? String(item.likely_origin).slice(0, 160) : "grupos de mensagens e perfis anônimos",
    }));

  for (const item of baseItems) {
    if (safeItems.length >= 4) break;
    if (!safeItems.some((existing: any) => existing.title === item.title)) safeItems.push(item);
  }

  const categories = Array.isArray(report?.narrative_categories) && report.narrative_categories.length
    ? report.narrative_categories
    : themesForScope(candidateContext?.nivel_cargo).slice(0, 6).map((theme, index) => ({
      category: theme.charAt(0).toUpperCase() + theme.slice(1),
      intensity: Math.max(35, 70 - index * 6),
    }));

  return {
    fake_news_count: safeItems.length,
    reputational_risk: ["Baixo", "Médio", "Alto", "Crítico"].includes(report?.reputational_risk) ? report.reputational_risk : "Médio",
    attack_intensity: Math.max(20, Math.min(85, Number(report?.attack_intensity) || 48)),
    digital_vulnerability: ["Baixa", "Moderada", "Alta", "Crítica"].includes(report?.digital_vulnerability) ? report.digital_vulnerability : "Moderada",
    executive_summary: report?.executive_summary || `A vulnerabilidade de ${candidateContext?.name || "este candidato"} deve ser avaliada pelo contexto político, pelo território de atuação e pelos tipos de ataque digital comuns no Brasil, não por comentários isolados. O risco principal está em narrativas vagas que simplificam temas administrativos e exploram emoções do eleitorado.`,
    fake_news_items: safeItems.slice(0, 7),
    how_to_identify: Array.isArray(report?.how_to_identify) && report.how_to_identify.length ? report.how_to_identify : [
      "Verificar se a acusação apresenta fonte primária, documento oficial e data verificável.",
      "Desconfiar de prints, áudios e vídeos recortados sem contexto completo.",
      "Comparar a narrativa com canais oficiais e bases públicas antes de responder.",
      "Mapear se a mensagem surge em grupos coordenados ou perfis recém-criados.",
    ],
    how_to_respond: Array.isArray(report?.how_to_respond) && report.how_to_respond.length ? report.how_to_respond : [
      "Responder com nota curta, factual e acompanhada de evidência verificável.",
      "Priorizar porta-vozes locais quando a narrativa circular em comunidades específicas.",
      "Publicar material preventivo sobre temas administrativos sensíveis.",
      "Monitorar repetição da narrativa antes de ampliar sua visibilidade.",
    ],
    narrative_categories: categories.slice(0, 8),
  };
}

function fallbackReport(candidateContext: any, periodLabel: string) {
  const items = strategicItems(candidateContext);
  return {
    fake_news_count: items.length,
    reputational_risk: "Médio",
    attack_intensity: 45,
    digital_vulnerability: "Moderada",
    executive_summary: `Análise estratégica gerada para ${candidateContext?.name || "o candidato"} no período de ${periodLabel}. O foco está em vulnerabilidades políticas plausíveis, histórico regional e padrões brasileiros de desinformação eleitoral, sem transformar comentários isolados em fatos.`,
    fake_news_items: items,
    how_to_identify: [
      "Verificar se a acusação traz documento, fonte primária e contexto completo.",
      "Desconfiar de mensagens com urgência emocional e sem autoria clara.",
      "Comparar a narrativa com canais oficiais e registros públicos.",
      "Observar repetição coordenada em grupos e perfis anônimos.",
    ],
    how_to_respond: [
      "Preparar respostas preventivas para temas de maior vulnerabilidade política.",
      "Usar linguagem factual, curta e verificável para não amplificar boatos.",
      "Acionar lideranças regionais confiáveis para corrigir narrativas locais.",
      "Monitorar a evolução da narrativa antes de escalar a resposta pública.",
    ],
    narrative_categories: themesForScope(candidateContext?.nivel_cargo).slice(0, 6).map((theme, index) => ({
      category: theme.charAt(0).toUpperCase() + theme.slice(1),
      intensity: Math.max(35, 68 - index * 5),
    })),
  };
}

function periodProfile(daysBack: number) {
  if (daysBack <= 1) return {
    key: "24h", label: "24 horas", weight: 0.30, minItems: 1, maxItems: 3,
    focus: "ataques emergentes e rumores recentes das últimas horas; ignorar padrões históricos",
    riskCap: "Médio" as const, intensityBand: [20, 45] as [number, number],
  };
  if (daysBack <= 7) return {
    key: "7d", label: "7 dias", weight: 0.45, minItems: 2, maxItems: 5,
    focus: "narrativas de curto prazo em circulação recente, sem análise histórica",
    riskCap: "Alto" as const, intensityBand: [30, 60] as [number, number],
  };
  if (daysBack <= 15) return {
    key: "15d", label: "15 dias", weight: 0.60, minItems: 3, maxItems: 6,
    focus: "consolidação de narrativas recorrentes de curto/médio prazo",
    riskCap: "Alto" as const, intensityBand: [40, 70] as [number, number],
  };
  if (daysBack <= 30) return {
    key: "30d", label: "30 dias", weight: 0.80, minItems: 4, maxItems: 8,
    focus: "campanhas de médio prazo, incluindo narrativas repetidas e coordenação inicial",
    riskCap: "Crítico" as const, intensityBand: [50, 82] as [number, number],
  };
  return {
    key: "90d", label: "90 dias", weight: 1.0, minItems: 6, maxItems: 12,
    focus: "análise histórica ampla, detecção de campanhas coordenadas persistentes e padrões recorrentes",
    riskCap: "Crítico" as const, intensityBand: [60, 92] as [number, number],
  };
}

function polarizationScore(context: any): number {
  const perfil = String(context?.perfil_politico || "").toLowerCase();
  if (perfil.includes("alta polarização") || perfil.includes("alta exposição")) return 0.9;
  if (perfil.includes("polarização") || perfil.includes("exposição")) return 0.65;
  return 0.5;
}

function baseExposureScore(context: any): number {
  const scope = context?.nivel_cargo;
  if (scope === "presidencial") return 0.95;
  if (scope === "governador") return 0.8;
  if (scope === "nacional_regional") return 0.7;
  if (scope === "estadual") return 0.6;
  if (scope === "municipal") return 0.45;
  return 0.5;
}

function computeAttackScore(context: any, period: ReturnType<typeof periodProfile>): number {
  const base = baseExposureScore(context);
  const pol = polarizationScore(context);
  const raw = (base * 0.4) + (period.weight * 0.3) + (pol * 0.3);
  const [min, max] = period.intensityBand;
  return Math.round(Math.max(min, Math.min(max, raw * 100)));
}

const RISK_ORDER = ["Baixo", "Médio", "Alto", "Crítico"] as const;
function capRisk(risk: string, cap: (typeof RISK_ORDER)[number]): string {
  const idx = RISK_ORDER.indexOf(risk as any);
  const capIdx = RISK_ORDER.indexOf(cap);
  if (idx === -1) return cap;
  return RISK_ORDER[Math.min(idx, capIdx)];
}

type AnalysisMode = "data_driven" | "ai_research";

async function callAI(input: {
  candidateContext: any;
  periodLabel: string;
  daysBack: number;
  totals: any;
  keywords: { word: string; count: number }[];
  topicSignals: { category: string; count: number }[];
  networks: { network: string; count: number }[];
  regions: { region: string; count: number }[];
  mode: AnalysisMode;
}) {
  const {
    candidateContext, periodLabel, daysBack, totals,
    keywords, topicSignals, networks, regions, mode,
  } = input;

  const primaryInput = {
    candidate: candidateContext,
    period: `${daysBack}d`,
  };

  const secondarySignals = {
    peso_maximo: "20%",
    mentions_count: totals.total,
    sentiment_distribution: {
      positive: totals.positive,
      negative: totals.negative,
      neutral: totals.neutral,
    },
    networks: networks.slice(0, 5),
    regions: regions.slice(0, 5),
    political_topic_signals: topicSignals.slice(0, 8),
    safe_aggregate_keywords: keywords.slice(0, 12),
  };

  const commonJsonSchema = `Responda EXCLUSIVAMENTE com JSON válido no formato:
{
  "fake_news_count": number,
  "reputational_risk": "Baixo" | "Médio" | "Alto" | "Crítico",
  "attack_intensity": number (0-100),
  "digital_vulnerability": "Baixa" | "Moderada" | "Alta" | "Crítica",
  "executive_summary": "3-5 frases analíticas em pt-BR",
  "fake_news_items": [
    {
      "title": "tipo de narrativa plausível, sem fato inventado",
      "probability": number (0-100),
      "explanation": "por que essa narrativa é plausível neste contexto",
      "likely_origin": "rede social, região ou grupo típico"
    }
  ],
  "how_to_identify": ["dica prática 1", ...] (4-6 dicas),
  "how_to_respond": ["ação estratégica 1", ...] (4-6 ações),
  "narrative_categories": [
    { "category": "nome da categoria", "intensity": 0-100 }
  ]
}`;

  let systemMsg: string;
  let userPrompt: string;

  if (mode === "data_driven") {
    systemMsg = `Você é um Analista sênior de inteligência política especializado em desinformação eleitoral brasileira.

ARQUITETURA OBRIGATÓRIA:
- 60% contexto político estruturado do candidato.
- 20% padrões nacionais de desinformação eleitoral no Brasil.
- 20% sinais agregados coletados da plataforma.

REGRAS CRÍTICAS:
- Comentários crus, posts crus e frases isoladas NÃO são fonte primária e não devem virar fake news diretamente.
- Use sinais coletados apenas como calibração secundária de temas, intensidade e redes prováveis.
- Nunca associe palavras aleatórias a acusações. Ignore temas desconexos do cargo, território e contexto político.
- É proibido inventar nomes de vítimas, familiares, operações policiais, processos, valores, datas, links ou veículos de imprensa.
- Sem evidência real explícita, nunca cite Folha, Globo, Polícia Federal, STF ou TSE.
- Responda SEMPRE em português do Brasil e SEMPRE em JSON válido.`;

    userPrompt = `Gere uma análise estratégica de desinformação para os últimos ${periodLabel}, usando o INPUT PRINCIPAL abaixo como fonte dominante.

## INPUT PRINCIPAL DA IA (peso 80%)
${JSON.stringify(primaryInput, null, 2)}

## SINAIS SECUNDÁRIOS DA PLATAFORMA (peso máximo 20%)
${JSON.stringify(secondarySignals, null, 2)}

## COMO GERAR NARRATIVAS
- Se cargo municipal: corrupção local, nepotismo, merenda, saúde, obras e licitações.
- Se governador: segurança, orçamento, hospitais, obras estaduais e alianças partidárias.
- Se presidente: corrupção sistêmica, economia, ideologia, impostos e programas sociais.
- Se legislativo estadual/federal: emendas, votações, alianças, orçamento e pautas ideológicas.

O resumo executivo deve explicar vulnerabilidade política, histórico regional e ataques comuns — não comentários aleatórios.

${commonJsonSchema}`;
  } else {
    // AI RESEARCH MODE — sem dados coletados suficientes
    systemMsg = `Você é um Analista sênior de inteligência política especializado em desinformação eleitoral brasileira, operando em SAFE AI MODE (baixo contexto de dados).

Sua tarefa é gerar análise PREDITIVA e ESTRATÉGICA de tipos de narrativas de fake news que podem atingir um candidato, com base em conhecimento contextual sobre:
- padrões brasileiros de desinformação eleitoral
- narrativas típicas por nível de cargo
- polarização ideológica do partido
- temas sensíveis por região

⚠️ REGRAS INEGOCIÁVEIS DO SAFE AI MODE ⚠️
Como NÃO há evidência real coletada, você está PROIBIDO de inventar:
- nomes de pessoas (familiares, aliados, adversários, servidores)
- valores monetários (R$, milhões, propina, salários)
- datas específicas ou anos de supostos crimes
- nomes de operações policiais ou processos judiciais
- crimes concretos ("desviou merenda em 2020", "recebeu R$500 mil")
- obras, contratos, licitações ou eventos específicos
- vídeos, posts virais ou manchetes específicas
- parentes ou vínculos familiares específicos
- veículos de imprensa, links ou autoridades sem evidência real
- STF, TSE, Polícia Federal, Folha ou Globo sem evidência real
- temas aleatórios como feminicídio, Bíblia ou religião quando não houver conexão política direta no contexto estruturado

✅ VOCÊ DEVE gerar apenas NARRATIVAS GENÉRICAS PLAUSÍVEIS, escritas em modo estratégico:
- "Narrativas sobre nepotismo"
- "Ataques sobre uso da máquina pública"
- "Boatos de compra de votos"
- "Acusações vagas de favorecimento familiar"
- "Questionamentos sobre transparência de gastos"

Regra final: IA = estratégica, NÃO investigativa. Fale sobre TIPOS de ataques, nunca fatos concretos. Comentários crus não são fonte primária.

Responda SEMPRE em português do Brasil e SEMPRE em JSON válido. NUNCA diga "dados insuficientes".`;

    userPrompt = `Gere uma análise PREDITIVA em SAFE AI MODE para o candidato abaixo. Volume real coletado: ${totals.total} menções nos últimos ${periodLabel} (baixo — modo estratégico obrigatório).

## INPUT PRINCIPAL DA IA
${JSON.stringify(primaryInput, null, 2)}

## SINAIS SECUNDÁRIOS DISPONÍVEIS (peso máximo 20%; não usar como fonte primária)
${JSON.stringify(secondarySignals, null, 2)}

## CONTEXTO PARA CALIBRAR AS NARRATIVAS (não inventar fatos)
- Nível do cargo → escopo dos ataques: vereador/prefeito = municipal (nepotismo, uso da máquina, verba local); deputado estadual/distrital = estadual (emendas, ligações estaduais); deputado federal/senador = nacional/regional (votações polêmicas, alinhamentos); governador = estadual amplo (gestão, segurança, saúde); presidente = nacional (economia, ideologia, corrupção sistêmica).
- Espectro ideológico do partido → tipo de polarização típica.
- Região → apenas temas gerais sensíveis, sem inventar casos.

## TAREFA
Gere de 4 a 7 narrativas de fake news PLAUSÍVEIS e GENÉRICAS.
Cada item deve seguir o padrão:
- title: tipo de ataque ("Narrativas sobre X", "Boatos de Y", "Ataques sobre Z") — SEM nomes, valores, datas ou fatos.
- explanation: por que esse TIPO de narrativa é plausível para este perfil (cargo/partido/região), em linguagem estratégica e genérica.
- likely_origin: canal ou perfil típico ("adversários locais", "grupos de WhatsApp da região", "perfis anônimos no X"), sem citar pessoas reais.
- probability: score realista (30-75, evite extremos sem evidência).

Também gere:
- Score de risco reputacional coerente com cargo e polarização (não alto sem justificativa contextual).
- Intensidade de ataques estimada.
- Vulnerabilidade digital.
- Como identificar e como neutralizar (dicas estratégicas e genéricas).
- Categorias de narrativa com intensidade estimada.

LEMBRE-SE: qualquer nome próprio, valor em R$, ano de crime, nome de operação, obra ou processo é ALUCINAÇÃO PROIBIDA neste modo.
NÃO use exemplos desconexos como feminicídio, Bíblia ou narrativas religiosas sem contexto político estruturado.

${commonJsonSchema}`;
  }

  const r = await callAICerebrasFirst({
    systemMsg,
    userPrompt,
    jsonMode: true,
    maxTokens: 2800,
    temperature: mode === "ai_research" ? 0.6 : 0.4,
    tag: `disinfo-radar-${mode}`,
  });
  const parsed = safeParseJson(r.content || "{}") || {};
  return { report: parsed, model_used: `${r.provider}/${r.model}` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: Payload = await req.json();
    if (!body.candidateId) {
      return new Response(JSON.stringify({ error: "candidateId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const daysBack = Math.max(1, Math.min(365, body.daysBack ?? 7));

    const { data: candidate } = await supabase
      .from("candidates")
      .select("id, full_name, party, party_name, region, user_id")
      .eq("id", body.candidateId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!candidate) {
      return new Response(JSON.stringify({ error: "candidate not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const periodLabel = `${daysBack} dias`;
    const cacheKey = `${candidate.id}::${daysBack}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return new Response(
        JSON.stringify({ ...cached.data, cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const searchTerm = candidate.full_name.split(/\s+/).filter(Boolean).slice(0, 2).join(" ") || candidate.full_name;
    const [{ data: politicalCatalog }, { data: publicCatalog }] = await Promise.all([
      supabase
        .from("political_catalog")
        .select("full_name,cargo,city,state,region,party,status,source,confidence")
        .ilike("full_name", `%${searchTerm}%`)
        .limit(10),
      supabase
        .from("public_candidates_catalog")
        .select("full_name,position,city,state,region,macro_region,party,category,description")
        .ilike("full_name", `%${searchTerm}%`)
        .limit(10),
    ]);

    const targetName = normalizeName(candidate.full_name);
    const catalogRows = [
      ...((politicalCatalog ?? []) as any[]).map((row) => ({ ...row, origin: "political_catalog" })),
      ...((publicCatalog ?? []) as any[]).map((row) => ({ ...row, cargo: row.position, origin: "public_candidates_catalog" })),
    ];
    const catalogMatch = catalogRows
      .map((row) => {
        const rowName = normalizeName(row.full_name || "");
        const sameParty = candidate.party && row.party && normalizeForMatch(candidate.party) === normalizeForMatch(row.party);
        const exact = rowName === targetName;
        const contains = rowName.includes(targetName) || targetName.includes(rowName);
        return { row, score: (exact ? 100 : contains ? 70 : 0) + (sameParty ? 15 : 0) + (Number(row.confidence) || 0) / 10 };
      })
      .sort((a, b) => b.score - a.score)[0]?.row;

    const parsedRegion = parseRegion(candidate.region);
    const cargo = catalogMatch?.cargo || null;
    const city = catalogMatch?.city || parsedRegion.city || null;
    const state = catalogMatch?.state || parsedRegion.state || null;
    const macroRegion = catalogMatch?.macro_region || (state ? STATE_TO_MACRO_REGION[state] : parsedRegion.macroRegion) || candidate.region || "N/D";
    const nivelCargo = officeScope(cargo, candidate.region);
    const partyKey = normalizeForMatch(candidate.party || catalogMatch?.party || "").toUpperCase();
    const perfilPolitico = PARTY_PROFILES[partyKey] || "perfil político inferido apenas por partido/território; usar abordagem conservadora e contextual";
    const candidateContext = {
      name: candidate.full_name,
      cargo: cargo || "não informado",
      partido: candidate.party || catalogMatch?.party || "N/D",
      partido_nome: candidate.party_name || null,
      cidade: city,
      estado: state,
      regiao: macroRegion,
      perfil_politico: perfilPolitico,
      historico: [
        cargo ? `Cargo/posição catalogada: ${cargo}` : "Cargo não confirmado em catálogo estruturado; evitar conclusões específicas sobre mandato.",
        state || city ? `Território político principal: ${[city, state, macroRegion].filter(Boolean).join(" · ")}` : `Território informado pelo usuário: ${candidate.region || "não informado"}`,
        candidate.party ? `Partido informado: ${candidate.party}${candidate.party_name ? ` (${candidate.party_name})` : ""}.` : "Partido não informado; reduzir peso ideológico.",
        catalogMatch?.description ? `Descrição pública resumida: ${String(catalogMatch.description).slice(0, 240)}` : "Sem histórico factual adicional disponível; não inventar biografia, processos ou eventos.",
      ],
      nivel_cargo: nivelCargo,
      temas_politicos_prioritarios: themesForScope(nivelCargo),
    };

    // Sinais agregados da plataforma: secundários, nunca fonte primária do relatório.
    const sinceIso = new Date(Date.now() - daysBack * 86400_000).toISOString();
    const { data: interactions } = await supabase
      .from("social_interactions")
      .select("comment_text,post_title,post_description,social_network,sentiment_label,sentiment_score,region,state,likes_count,shares_count,replies_count,original_posted_at")
      .eq("candidate_id", candidate.id)
      .gte("original_posted_at", sinceIso)
      .order("original_posted_at", { ascending: false })
      .limit(600);

    const rows = interactions ?? [];
    const totals = {
      total: rows.length,
      positive: rows.filter((r) => (r.sentiment_label || "").toLowerCase().startsWith("pos")).length,
      negative: rows.filter((r) => (r.sentiment_label || "").toLowerCase().startsWith("neg")).length,
      neutral: rows.filter((r) => (r.sentiment_label || "").toLowerCase().startsWith("neu")).length,
    };

    // AI-FIRST: only switch to data-driven when there is a substantial real signal (>500 mentions).
    const mode: AnalysisMode = totals.total > 500 ? "data_driven" : "ai_research";

    // Extrai apenas sinais agregados e temas políticos; não envia comentários crus para a IA.
    const allTexts = rows.map((r) => [r.comment_text, r.post_title, r.post_description].filter(Boolean).join(" "));
    const keywords = topKeywords(allTexts, 25)
      .filter((keyword) => SAFE_KEYWORD_ALLOWLIST.has(normalizeForMatch(keyword.word)))
      .slice(0, 12);
    const topicSignals = buildTopicSignals(allTexts);

    const netMap = new Map<string, number>();
    const regMap = new Map<string, number>();
    for (const r of rows) {
      if (r.social_network) netMap.set(r.social_network, (netMap.get(r.social_network) ?? 0) + 1);
      const reg = r.state || r.region;
      if (reg) regMap.set(reg, (regMap.get(reg) ?? 0) + 1);
    }
    const networks = [...netMap.entries()].map(([network, count]) => ({ network, count })).sort((a, b) => b.count - a.count);
    const regions = [...regMap.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);

    let report: any;
    let model_used = "fallback";
    try {
      const r = await callAI({
        candidateContext, periodLabel, daysBack, totals,
        keywords, topicSignals, networks, regions, mode,
      });
      report = sanitizeReport(r.report, candidateContext);
      model_used = r.model_used;
    } catch (e) {
      console.error("[disinfo-radar] AI failed:", (e as Error).message);
      report = fallbackReport(candidateContext, periodLabel);
    }

    // Strip any legacy insufficient_data flag — new architecture never returns it
    if (report && typeof report === "object") delete report.insufficient_data;

    const payload = {
      candidate,
      candidate_context: candidateContext,
      period: { daysBack, label: periodLabel },
      report,
      totals,
      analysis_mode: mode,
      signals: {
        top_keywords: keywords.slice(0, 15),
        topic_signals: topicSignals.slice(0, 8),
        networks: networks.slice(0, 8),
        regions: regions.slice(0, 8),
      },
      model_used,
      generated_at: new Date().toISOString(),
    };
    CACHE.set(cacheKey, { data: payload, ts: Date.now() });

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[disinfo-radar] fatal:", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
