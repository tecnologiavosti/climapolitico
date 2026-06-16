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

export function analyzeEventImpact(e: EventInput): ImpactAnalysis {
  const category = e.category || "Outros";
  const importance = e.importance ?? 0;
  const social_score = e.social_score ?? 0;
  const source_count = e.source_count ?? 0;
  const haystack = normalize(`${e.title ?? ""} ${e.summary ?? ""}`);

  const tone = detectTone(haystack);
  const social = detectSocial(social_score);
  const impact = detectImpact(category, importance, source_count);

  const toneText =
    tone === "Desfavorável"
      ? "tende a desgastar a imagem pública do candidato"
      : tone === "Favorável"
      ? "tende a fortalecer a imagem pública do candidato"
      : "tem efeito neutro sobre a imagem pública do candidato";

  const socialText =
    social === "Alta"
      ? "com forte repercussão nas redes sociais"
      : social === "Moderada"
      ? "com repercussão moderada nas redes"
      : "com repercussão social limitada";

  const categoryText = HIGH_IMPACT_CATEGORIES.has(category)
    ? `Por envolver ${category}, o caso ganha peso institucional adicional.`
    : `Categoria ${category} com peso institucional padrão.`;

  const sourcesText = source_count >= 5
    ? `Cobertura ampla, com ${source_count} fontes registradas.`
    : `Cobertura limitada (${source_count} fontes).`;

  const text = `${categoryText} O evento ${toneText}, ${socialText} (score ${social_score}). ${sourcesText} Impacto político estimado: ${impact.toLowerCase()}.`;

  return { impact, tone, social, text };
}
