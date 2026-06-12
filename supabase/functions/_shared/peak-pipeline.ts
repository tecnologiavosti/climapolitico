// Shared modular pipeline for political peak detection.
// All logic here is pure and free of network/DB calls — easy to test and reuse.

export type SourceTier = "tier1" | "tier2" | "tier3" | "tier4" | "blocked";

export interface SourceClassification {
  tier: SourceTier;
  weight: number;
  host: string;
}

export interface PoliticalCategory {
  id: string;
  label: string;
}

export const POLITICAL_CATEGORIES: PoliticalCategory[] = [
  { id: "todos", label: "Todos" },
  { id: "eleicoes", label: "Eleições" },
  { id: "operacoes_pf", label: "Operações PF" },
  { id: "stf", label: "STF" },
  { id: "tse", label: "TSE" },
  { id: "cpi", label: "CPI" },
  { id: "julgamentos", label: "Julgamentos" },
  { id: "escandalos", label: "Escândalos" },
  { id: "prisoes", label: "Prisões" },
  { id: "debates", label: "Debates" },
  { id: "outros", label: "Outros" },
];

// ---------- Source classification ----------
const TIER1_HOSTS = /(^|\.)(reuters\.com|bbc\.com|bbc\.co\.uk|stf\.jus\.br|tse\.jus\.br|senado\.leg\.br|camara\.leg\.br|gov\.br|planalto\.gov\.br|pf\.gov\.br|mpf\.mp\.br|tcu\.gov\.br|agenciabrasil\.ebc\.com\.br)$/i;
const TIER1_OUTLETS = /\b(reuters|bbc|stf|tse|senado federal|c[âa]mara dos deputados|pol[íi]cia federal|mpf|tcu|planalto|ag[êe]ncia brasil)\b/i;

const TIER2_HOSTS = /(^|\.)(g1\.globo\.com|oglobo\.globo\.com|valor\.globo\.com|globo\.com|folha\.uol\.com\.br|estadao\.com\.br|uol\.com\.br|cnnbrasil\.com\.br|metropoles\.com|poder360\.com\.br|r7\.com|band\.uol\.com\.br|cartacapital\.com\.br)$/i;
const TIER2_OUTLETS = /\b(g1|o globo|globo|valor|folha|estad[aã]o|uol|cnn brasil|metr[óo]poles|poder360|r7|band|record|jovem pan)\b/i;

const TIER3_HOSTS = /(^|\.)(veja\.abril\.com\.br|abril\.com\.br|nexojornal\.com\.br|brasildefato\.com\.br|congressoemfoco\.uol\.com\.br|piaui\.folha\.uol\.com\.br|theintercept\.com)$/i;
const TIER3_OUTLETS = /\b(veja|nexo|brasil de fato|congresso em foco|piau[ií]|intercept|carta capital)\b/i;

const TIER4_HOSTS = /(^|\.)(instagram\.com|tiktok\.com|facebook\.com|m\.facebook\.com|fb\.com|youtube\.com|youtu\.be|threads\.net|threads\.com|x\.com|twitter\.com|t\.me|telegram\.me|reddit\.com|pinterest\.com|bsky\.app|mastodon\.|truthsocial\.com)$/i;
const TIER4_OUTLETS = /\b(instagram|tiktok|facebook|youtube|threads|twitter|x\.com|telegram|reddit|pinterest|bluesky|bsky|mastodon|truth social)\b/i;

// Aggregators / SEO spam that must never validate political events.
const BLOCKED_HOSTS = /(^|\.)(bing\.com|cn\.bing\.com|news\.bing\.com|pinterest\.[a-z]+|scribd\.com|slideshare\.net|medium\.com|substack\.com|wordpress\.com|blogspot\.com|wattpad\.com|quora\.com)$/i;

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

export function classifySource(url: string, outlet?: string | null): SourceClassification {
  const host = hostOf(url);
  const out = String(outlet || "");
  if (host && BLOCKED_HOSTS.test(host)) return { tier: "blocked", weight: 0, host };
  if (TIER1_HOSTS.test(host) || TIER1_OUTLETS.test(out)) return { tier: "tier1", weight: 1.0, host };
  if (TIER2_HOSTS.test(host) || TIER2_OUTLETS.test(out)) return { tier: "tier2", weight: 0.8, host };
  if (TIER3_HOSTS.test(host) || TIER3_OUTLETS.test(out)) return { tier: "tier3", weight: 0.4, host };
  if (TIER4_HOSTS.test(host) || TIER4_OUTLETS.test(out)) return { tier: "tier4", weight: 0.1, host };
  // unknown news domain — treat as tier3 if it looks like a news host, else tier4
  if (host && /\.(com|com\.br|org|org\.br|net|gov\.br|jus\.br|leg\.br)$/i.test(host)) {
    return { tier: "tier3", weight: 0.4, host };
  }
  return { tier: "tier4", weight: 0.1, host };
}

export interface ConfidenceResult {
  status: "confirmed" | "probable" | "indeterminate";
  weight_sum: number;
  independent_strong_sources: number;
  tier_breakdown: Record<SourceTier, number>;
  trusted_sources_count: number;
}

export function confidenceFromSources(pubs: Array<{ url?: string | null; outlet?: string | null }>): ConfidenceResult {
  const breakdown: Record<SourceTier, number> = { tier1: 0, tier2: 0, tier3: 0, tier4: 0, blocked: 0 };
  const strongDomains = new Set<string>();
  let weight = 0;
  for (const p of pubs) {
    const c = classifySource(p.url || "", p.outlet || null);
    breakdown[c.tier]++;
    if (c.tier === "blocked") continue;
    weight += c.weight;
    if ((c.tier === "tier1" || c.tier === "tier2") && c.host) strongDomains.add(c.host);
  }
  const independent_strong_sources = strongDomains.size;
  const trusted_sources_count = breakdown.tier1 + breakdown.tier2;
  let status: ConfidenceResult["status"] = "indeterminate";
  if (weight >= 1.5 && independent_strong_sources >= 2) status = "confirmed";
  else if (weight >= 0.8 && independent_strong_sources >= 1) status = "probable";
  return { status, weight_sum: Math.round(weight * 100) / 100, independent_strong_sources, tier_breakdown: breakdown, trusted_sources_count };
}

// ---------- Spike detection ----------
export interface SeriesPoint { date: string; mentions: number; }
export interface SpikeResult {
  date: string;
  mentions: number;
  baseline: number;
  std: number;
  zscore: number;
  isSpike: boolean;
}

const MIN_DAILY_VOLUME = 30;

export function detectSpikes(series: SeriesPoint[], opts: { zThreshold?: number; minVolume?: number; window?: number } = {}): SpikeResult[] {
  const z = opts.zThreshold ?? 2.5;
  const minVol = opts.minVolume ?? MIN_DAILY_VOLUME;
  const win = opts.window ?? 14;
  const out: SpikeResult[] = [];
  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - win);
    const slice = series.slice(start, i);
    if (slice.length < 5) {
      out.push({ ...series[i], baseline: 0, std: 0, zscore: 0, isSpike: false });
      continue;
    }
    const mean = slice.reduce((s, p) => s + p.mentions, 0) / slice.length;
    const variance = slice.reduce((s, p) => s + Math.pow(p.mentions - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    const zscore = std > 0 ? (series[i].mentions - mean) / std : 0;
    const isSpike =
      series[i].mentions >= minVol &&
      series[i].mentions > mean * 2 &&
      zscore >= z;
    out.push({ date: series[i].date, mentions: series[i].mentions, baseline: Math.round(mean * 10) / 10, std: Math.round(std * 10) / 10, zscore: Math.round(zscore * 100) / 100, isSpike });
  }
  return out;
}

// ---------- Category classification ----------
function norm(text: string): string {
  return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const CATEGORY_RULES: Array<{ id: string; patterns: RegExp[] }> = [
  // More specific categories first
  { id: "operacoes_pf", patterns: [/\b(operacao|policia federal|\bpf\b|busca e apreensao|mandado de busca|mandado de prisao|deflagrad)/i] },
  { id: "stf", patterns: [/\b(stf|supremo tribunal federal|alexandre de moraes|gilmar mendes|barroso|fachin|dias toffoli|plenario do supremo|decisao monocratica|liminar)\b/i] },
  { id: "tse", patterns: [/\b(tse|tribunal superior eleitoral|justica eleitoral|inelegibilidade|inelegivel|urna eletronica)\b/i] },
  { id: "cpi", patterns: [/\b(cpi|comissao parlamentar( de inquerito)?|relator da cpi|depoimento na cpi|convocacao da cpi)\b/i] },
  { id: "prisoes", patterns: [/\b(preso|presa|prisao preventiva|prisao temporaria|detido|encarcerad|cumpre pena|cadeia|penitenciaria)\b/i] },
  { id: "julgamentos", patterns: [/\b(julgamento|condenacao|condenad|absolvicao|absolvid|sentenca|recurso|tribunal|stj|trf|primeira instancia|segunda instancia)\b/i] },
  { id: "escandalos", patterns: [/\b(corrupcao|propina|lava jato|vazamento|delacao|denuncia|escandalo|esquema|desvio de verba|caixa dois|lavagem de dinheiro)\b/i] },
  { id: "debates", patterns: [/\b(debate|sabatina|entrevista eleitoral|cara a cara|confronto entre candidatos)\b/i] },
  { id: "eleicoes", patterns: [/\b(eleicao|eleicoes|pesquisa eleitoral|datafolha|ipec|ibope|quaest|campanha|urna|urnas|voto|segundo turno|primeiro turno|candidato|candidatura)\b/i] },
];

export function classifyCategory(...textParts: Array<string | null | undefined>): string {
  const blob = norm(textParts.filter(Boolean).join(" "));
  if (!blob) return "outros";
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(blob))) return rule.id;
  }
  return "outros";
}

// ---------- Relevance ----------
export interface RelevanceInput {
  mentions: number;
  baseline?: number;
  durationDays: number;
  independent_strong_sources: number;
  trusted_sources_count: number;
  politicalImpact?: number; // 0..1
  maxMentionsRef?: number; // largest known peak for normalization
}

export interface RelevanceResult {
  score: number;
  band: "baixa" | "media" | "alta" | "critica";
  breakdown: { volume: number; duration: number; diversity: number; impact: number };
}

export function computeRelevance(input: RelevanceInput): RelevanceResult {
  const ref = Math.max(input.mentions, input.maxMentionsRef || 1, 100);
  const volume = Math.min(1, input.mentions / ref);
  const duration = Math.min(1, input.durationDays / 7);
  const diversity = Math.min(1, input.independent_strong_sources / 4) * 0.7 + Math.min(1, input.trusted_sources_count / 8) * 0.3;
  const impact = Math.max(0, Math.min(1, input.politicalImpact ?? 0));
  const raw = volume * 0.4 + duration * 0.3 + diversity * 0.2 + impact * 0.1;
  const score = Math.round(raw * 100);
  let band: RelevanceResult["band"] = "baixa";
  if (score >= 81) band = "critica";
  else if (score >= 61) band = "alta";
  else if (score >= 31) band = "media";
  return { score, band, breakdown: { volume: Math.round(volume * 100) / 100, duration: Math.round(duration * 100) / 100, diversity: Math.round(diversity * 100) / 100, impact: Math.round(impact * 100) / 100 } };
}
