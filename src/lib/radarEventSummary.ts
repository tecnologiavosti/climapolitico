// Geração local de resumo expandido para eventos do Radar Político.
// Não depende de IA em tempo real — aplica limpeza forte e expansão heurística
// quando o texto bruto vier curto ou ausente.

export interface RawArticleLike {
  title?: string;
  summary?: string;
  description?: string;
  snippet?: string;
  content?: string;
  body?: string;
  category?: string;
  source_count?: number;
  institutional_sources?: number;
  social_score?: number;
  importance?: number;
}

const JUNK_PATTERNS: RegExp[] = [
  /continue reading/gi,
  /leia mais/gi,
  /leia também/gi,
  /clique aqui/gi,
  /saiba mais/gi,
  /assine( j[áa])?/gi,
  /\[\s*\.\.\.\s*\]/g,
  /\(\s*\.\.\.\s*\)/g,
  /_blank/gi,
];

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    });
}

export function cleanArticleText(raw: unknown): string {
  if (raw == null) return "";
  let s = String(raw);
  s = s.replace(/<[^>]*>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/https?:\/\/\S+/gi, "");
  for (const re of JUNK_PATTERNS) s = s.replace(re, " ");
  // Remove trailing/standalone ellipsis e reticências truncadas
  s = s.replace(/\.{3,}/g, " ").replace(/…+/g, " ");
  // Caracteres de controle
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

function pickBaseText(e: RawArticleLike): string {
  const title = cleanArticleText(e.title).toLowerCase();
  const candidates = [e.content, e.body, e.description, e.snippet, e.summary];
  for (const c of candidates) {
    const t = cleanArticleText(c);
    if (t.length >= 80 && t.toLowerCase() !== title) return t;
  }
  // fallback parcial: pega o mais longo disponível mesmo se curto
  let best = "";
  for (const c of candidates) {
    const t = cleanArticleText(c);
    if (t.length > best.length && t.toLowerCase() !== title) best = t;
  }
  return best;
}

const CATEGORY_CONTEXT: Record<string, string> = {
  STF: "envolve o Supremo Tribunal Federal, com peso institucional alto e potencial de repercussão jurídica e política prolongada",
  TSE: "tramita no Tribunal Superior Eleitoral, podendo afetar diretamente a disputa eleitoral e as regras de propaganda",
  PF: "envolve apuração da Polícia Federal, o que tende a ampliar o desgaste reputacional do(s) envolvido(s)",
  CPI: "ocorre em ambiente de Comissão Parlamentar de Inquérito, com forte exposição pública e disputa narrativa",
  "Prisões": "envolve medida restritiva de liberdade, com alto impacto reputacional imediato",
  "Julgamentos": "está em fase de julgamento, podendo produzir decisão com efeitos políticos diretos",
  "Escândalos": "tem natureza de escândalo público, com tendência de alta repercussão e polarização",
  "Declarações": "trata-se de declaração pública, com impacto principal sobre a narrativa e o posicionamento do candidato",
  "Pesquisas": "envolve pesquisa de opinião, impactando a leitura de competitividade eleitoral",
};

function categoryNarrative(category?: string): string {
  if (!category) return "tem peso institucional padrão e exige acompanhamento da repercussão";
  return CATEGORY_CONTEXT[category] ?? `está classificado como ${category}, com peso institucional padrão`;
}

function consequencesNarrative(e: RawArticleLike): string {
  const social = e.social_score ?? 0;
  const sources = e.source_count ?? 0;
  const inst = e.institutional_sources ?? 0;
  const parts: string[] = [];
  if (social >= 75) parts.push("a alta repercussão nas redes tende a amplificar o tema e acelerar respostas políticas");
  else if (social >= 45) parts.push("a repercussão moderada nas redes mantém o tema em circulação");
  else parts.push("a repercussão social ainda é limitada, mas pode escalar com novas atualizações");
  if (inst >= 2) parts.push("a presença de fontes institucionais reforça a credibilidade e o peso do caso");
  else if (sources >= 5) parts.push("a cobertura ampla da imprensa indica relevância editorial");
  return parts.join("; ");
}

function expandFromTitle(e: RawArticleLike): string {
  const title = cleanArticleText(e.title);
  const cat = categoryNarrative(e.category);
  const cons = consequencesNarrative(e);
  return (
    `${title}. O episódio ${cat}. ` +
    `Pelos sinais disponíveis (importância ${e.importance ?? 0}, score social ${e.social_score ?? 0}, ${e.source_count ?? 0} fontes), ${cons}. ` +
    `Politicamente, o caso pode alimentar disputas narrativas entre apoiadores e opositores e merece monitoramento contínuo nos próximos dias.`
  );
}

/**
 * Gera um resumo expandido (500–1200 chars) para o card do evento.
 * Mantém o texto coletado quando suficiente; complementa com narrativa
 * heurística baseada em categoria, fontes e sinais sociais quando curto.
 */
export function generateEventSummary(e: RawArticleLike): string {
  const MIN = 500;
  const MAX = 1200;
  const title = cleanArticleText(e.title);
  let base = pickBaseText(e);

  if (base.length >= MIN) {
    if (base.length > MAX) {
      return base.slice(0, MAX).replace(/\s+\S*$/, "").replace(/[\s,;:.-]+$/, "") + ".";
    }
    return base;
  }

  // Fallback: combina título + base curta + narrativa heurística
  const heuristic = expandFromTitle(e);
  let combined = base && base.toLowerCase() !== title.toLowerCase()
    ? `${base} ${heuristic}`
    : heuristic;
  combined = combined.replace(/\s+/g, " ").trim();

  if (combined.length > MAX) {
    combined = combined.slice(0, MAX).replace(/\s+\S*$/, "").replace(/[\s,;:.-]+$/, "") + ".";
  }
  return combined;
}
