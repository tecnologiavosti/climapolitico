// Heurística local para análise de impacto de eventos do Radar Político.
// Não usa IA/LLM em tempo real — apenas regras determinísticas baseadas em
// título, categoria, social_score, importance e número de fontes.

export type ImpactLevel = "Baixo" | "Médio" | "Alto";
export type ToneLevel = "Favorável" | "Neutro" | "Desfavorável";
export type SocialLevel = "Baixa" | "Moderada" | "Alta";

export interface ImpactAnalysis {
  impact: ImpactLevel;
  tone: ToneLevel;
  social: SocialLevel;
  text: string;
}

interface EventInput {
  title?: string;
  summary?: string;
  category?: string;
  social_score?: number;
  importance?: number;
  source_count?: number;
}

const NEGATIVE_KW = [
  "corrupç", "investigaç", "denúncia", "denuncia", "caixa 2", "caixa dois",
  "escândalo", "escandalo", "prisão", "prisao", "operação", "operacao",
  "indiciamento", "fraude", "lavagem", "condenação", "condenacao", "réu", "reu",
  "delação", "delacao",
];
const POSITIVE_KW = [
  "apoio", "lidera", "lideran", "cresce", "vence", "venceu", "aprovação",
  "aprovacao", "vantagem", "favorito", "recorde", "elogiado", "vitória", "vitoria",
];

const HIGH_IMPACT_CATEGORIES = new Set([
  "STF", "TSE", "PF", "CPI", "Prisões", "Julgamentos", "Escândalos",
]);

function normalize(s: string) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function detectTone(haystack: string): ToneLevel {
  const neg = NEGATIVE_KW.some((k) => haystack.includes(normalize(k)));
  const pos = POSITIVE_KW.some((k) => haystack.includes(normalize(k)));
  if (neg && !pos) return "Desfavorável";
  if (pos && !neg) return "Favorável";
  return "Neutro";
}

function detectSocial(score: number): SocialLevel {
  if (score >= 75) return "Alta";
  if (score >= 45) return "Moderada";
  return "Baixa";
}

function detectImpact(category: string, importance: number, sourceCount: number): ImpactLevel {
  let weight = importance;
  if (HIGH_IMPACT_CATEGORIES.has(category)) weight += 20;
  if (sourceCount >= 8) weight += 5;
  if (weight >= 75) return "Alto";
  if (weight >= 45) return "Médio";
  return "Baixo";
}

function institutionalNarrative(category: string): string {
  switch (category) {
    case "STF":
      return "Por envolver diretamente o Supremo Tribunal Federal, o caso eleva a tensão institucional e tende a reverberar nos três Poderes.";
    case "TSE":
      return "Por tramitar no TSE, o episódio se conecta diretamente às regras da disputa eleitoral e pode redefinir o terreno da campanha.";
    case "PF":
      return "A presença da Polícia Federal adiciona peso investigativo e amplia o desgaste reputacional dos envolvidos.";
    case "CPI":
      return "O ambiente de CPI cria exposição pública prolongada, com forte disputa narrativa entre governo e oposição.";
    case "Prisões":
    case "Julgamentos":
      return "Por envolver decisão judicial de natureza restritiva, o caso projeta impacto institucional imediato.";
    case "Escândalos":
      return "A natureza de escândalo tende a polarizar a opinião pública e mobilizar bases adversárias com intensidade.";
    default:
      return "O caso tem peso institucional dentro do padrão da categoria, sem fator agravante adicional.";
  }
}

function electoralNarrative(impact: ImpactLevel, tone: ToneLevel): string {
  if (tone === "Desfavorável" && impact !== "Baixo") {
    return "No campo eleitoral, há risco real de erosão de apoio entre eleitores menos fidelizados e ampliação da rejeição.";
  }
  if (tone === "Favorável" && impact !== "Baixo") {
    return "No campo eleitoral, o episódio pode consolidar a base e atrair eleitores indecisos sensíveis ao tema.";
  }
  return "No campo eleitoral, o efeito tende a ser marginal no curto prazo, sem deslocamento expressivo de intenção de voto.";
}

function reputationalNarrative(tone: ToneLevel): string {
  if (tone === "Desfavorável") {
    return "Reputacionalmente, a leitura predominante tende a ser negativa, reforçando narrativas críticas já em circulação.";
  }
  if (tone === "Favorável") {
    return "Reputacionalmente, o tom favorece a imagem pública e dá munição para a comunicação do candidato.";
  }
  return "Reputacionalmente, o tom é ambíguo e abre espaço para leituras conflitantes entre apoiadores e opositores.";
}

function socialNarrative(social: SocialLevel, score: number): string {
  if (social === "Alta") {
    return `Socialmente, a repercussão é alta (score ${score}), com tendência de viralização e polarização nas redes.`;
  }
  if (social === "Moderada") {
    return `Socialmente, a repercussão é moderada (score ${score}), mantendo o tema vivo sem explodir o debate.`;
  }
  return `Socialmente, a repercussão ainda é baixa (score ${score}), mas pode escalar caso surjam novos desdobramentos.`;
}

export function analyzeEventImpact(e: EventInput): ImpactAnalysis {
  const category = e.category || "Outros";
  const importance = e.importance ?? 0;
  const social_score = e.social_score ?? 0;
  const source_count = e.source_count ?? 0;
  const haystack = normalize(`${e.title ?? ""} ${e.summary ?? ""}`);

  const tone = detectTone(haystack);
  const social = detectSocial(social_score);
  const impact = detectImpact(category, importance, source_count);

  const text = [
    institutionalNarrative(category),
    electoralNarrative(impact, tone),
    reputationalNarrative(tone),
    socialNarrative(social, social_score),
    source_count >= 5
      ? `Cobertura ampla com ${source_count} fontes reforça a relevância do episódio.`
      : `Cobertura ainda limitada (${source_count} fontes) — acompanhar evolução.`,
  ].join(" ");

  return { impact, tone, social, text };
}
