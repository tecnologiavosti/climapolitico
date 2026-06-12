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

// Social media and aggregators: NEVER count as external journalistic evidence.
// Treated as fully BLOCKED — weight 0, do not validate events.
const BLOCKED_HOSTS = /(^|\.)(instagram\.com|tiktok\.com|facebook\.com|m\.facebook\.com|fb\.com|youtube\.com|youtu\.be|threads\.net|threads\.com|x\.com|twitter\.com|t\.me|telegram\.me|telegram\.org|reddit\.com|pinterest\.[a-z.]+|bsky\.app|mastodon\.|truthsocial\.com|bing\.com|cn\.bing\.com|news\.bing\.com|scribd\.com|slideshare\.net|medium\.com|substack\.com|wordpress\.com|blogspot\.com|wattpad\.com|quora\.com)$/i;
const BLOCKED_OUTLETS = /\b(instagram|tiktok|facebook|youtube|threads|twitter|x\.com|telegram|reddit|pinterest|bluesky|bsky|mastodon|truth social)\b/i;

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

export function classifySource(url: string, outlet?: string | null): SourceClassification {
  const host = hostOf(url);
  const out = String(outlet || "");
  if ((host && BLOCKED_HOSTS.test(host)) || BLOCKED_OUTLETS.test(out)) return { tier: "blocked", weight: 0, host };
  if (TIER1_HOSTS.test(host) || TIER1_OUTLETS.test(out)) return { tier: "tier1", weight: 1.0, host };
  if (TIER2_HOSTS.test(host) || TIER2_OUTLETS.test(out)) return { tier: "tier2", weight: 0.8, host };
  if (TIER3_HOSTS.test(host) || TIER3_OUTLETS.test(out)) return { tier: "tier3", weight: 0.4, host };
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

// Score-based classifier: each category accumulates points from matched terms.
// A minimum threshold avoids weak/coincidental matches (especially TSE).
const CATEGORY_RULES: Array<{ id: string; threshold: number; terms: Array<{ re: RegExp; w: number }> }> = [
  { id: "operacoes_pf", threshold: 2, terms: [
    { re: /\boperacao\b/i, w: 1 }, { re: /\bpolicia federal\b/i, w: 2 }, { re: /\bpf\b/i, w: 1 },
    { re: /\bbusca e apreensao\b/i, w: 2 }, { re: /\bmandado de (busca|prisao)\b/i, w: 2 }, { re: /\bdeflagrad/i, w: 1 },
  ]},
  { id: "stf", threshold: 2, terms: [
    { re: /\bstf\b/i, w: 2 }, { re: /\bsupremo tribunal federal\b/i, w: 3 },
    { re: /\b(alexandre de moraes|gilmar mendes|barroso|fachin|dias toffoli|carmen lucia|nunes marques|andre mendonca)\b/i, w: 1 },
    { re: /\b(plenario do supremo|decisao monocratica|liminar do supremo)\b/i, w: 2 },
  ]},
  // TSE — REQUIRES explicit electoral-court terms. Generic words like "candidato" don't count here.
  { id: "tse", threshold: 2, terms: [
    { re: /\btse\b/i, w: 2 }, { re: /\btribunal superior eleitoral\b/i, w: 3 },
    { re: /\bjustica eleitoral\b/i, w: 2 }, { re: /\b(inelegibilidade|inelegivel)\b/i, w: 2 },
    { re: /\burna( eletronica)?\b/i, w: 1 }, { re: /\beleitoral\b/i, w: 1 },
  ]},
  { id: "cpi", threshold: 2, terms: [
    { re: /\bcpi\b/i, w: 2 }, { re: /\bcomissao parlamentar( de inquerito)?\b/i, w: 3 },
    { re: /\brelator da cpi\b/i, w: 2 }, { re: /\b(depoimento|convocacao) (na |da )?cpi\b/i, w: 2 },
  ]},
  { id: "prisoes", threshold: 2, terms: [
    { re: /\b(preso|presa|detido)\b/i, w: 1 }, { re: /\bprisao (preventiva|temporaria|domiciliar)\b/i, w: 3 },
    { re: /\b(encarcerad|cumpre pena|penitenciaria)\b/i, w: 2 },
  ]},
  { id: "julgamentos", threshold: 2, terms: [
    { re: /\bjulgamento\b/i, w: 2 }, { re: /\b(condenacao|condenad|absolvicao|absolvid|sentenca)\b/i, w: 2 },
    { re: /\b(stj|trf)\b/i, w: 1 }, { re: /\b(primeira|segunda) instancia\b/i, w: 1 },
  ]},
  { id: "escandalos", threshold: 2, terms: [
    { re: /\b(corrupcao|propina|lava jato)\b/i, w: 2 }, { re: /\b(delacao|escandalo|esquema)\b/i, w: 2 },
    { re: /\b(caixa dois|lavagem de dinheiro|desvio de verba|vazamento)\b/i, w: 2 },
  ]},
  { id: "debates", threshold: 2, terms: [
    { re: /\bdebate( presidencial| eleitoral)?\b/i, w: 2 }, { re: /\bsabatina\b/i, w: 2 },
    { re: /\bcara a cara\b/i, w: 1 }, { re: /\bconfronto entre candidatos\b/i, w: 2 },
  ]},
  { id: "eleicoes", threshold: 2, terms: [
    { re: /\beleic(ao|oes)\b/i, w: 2 }, { re: /\bpesquisa eleitoral\b/i, w: 2 },
    { re: /\b(datafolha|ipec|ibope|quaest)\b/i, w: 2 }, { re: /\bcampanha\b/i, w: 1 },
    { re: /\b(segundo|primeiro) turno\b/i, w: 2 }, { re: /\b(candidato|candidatura)\b/i, w: 1 },
  ]},
];

export function classifyCategory(...textParts: Array<string | null | undefined>): string {
  const blob = norm(textParts.filter(Boolean).join(" "));
  if (!blob) return "outros";
  let best = { id: "outros", score: 0 };
  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const t of rule.terms) if (t.re.test(blob)) score += t.w;
    if (score >= rule.threshold && score > best.score) best = { id: rule.id, score };
  }
  return best.id;
}

// ---------- Relevance ----------
export interface RelevanceInput {
  mentions: number;
  baseline?: number;
  durationDays: number;
  independent_strong_sources: number;
  trusted_sources_count: number;
  engagement?: number;       // likes+shares+comments aggregated
  politicalImpact?: number;  // 0..1
  maxMentionsRef?: number;
}

export interface RelevanceResult {
  score: number;
  band: "baixa" | "media" | "alta" | "critica";
  breakdown: { volume: number; engagement: number; duration: number; diversity: number; impact: number };
}

// log-scale normalization so big buzz is rewarded even without strong sources.
function logScale(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, Math.log10(value + 1) / Math.log10(ceiling + 1));
}

export function computeRelevance(input: RelevanceInput): RelevanceResult {
  const volume = logScale(input.mentions, 5000);                  // 5k mentions = full
  const engagement = logScale(input.engagement ?? 0, 1_000_000);  // 1M eng = full
  const duration = Math.min(1, input.durationDays / 10);
  const diversity = Math.min(1, input.independent_strong_sources / 3) * 0.6
                  + Math.min(1, input.trusted_sources_count / 6) * 0.4;
  const impact = Math.max(0, Math.min(1, input.politicalImpact ?? 0));

  // If no engagement signal, redistribute its weight to volume.
  const hasEng = (input.engagement ?? 0) > 0;
  const wVol = hasEng ? 0.40 : 0.60;
  const wEng = hasEng ? 0.20 : 0.0;
  const raw = volume * wVol + engagement * wEng + duration * 0.15 + diversity * 0.15 + impact * 0.10;
  const score = Math.round(Math.min(1, raw) * 100);

  let band: RelevanceResult["band"] = "baixa";
  if (score >= 80) band = "critica";
  else if (score >= 55) band = "alta";
  else if (score >= 30) band = "media";

  return {
    score, band,
    breakdown: {
      volume: Math.round(volume * 100) / 100,
      engagement: Math.round(engagement * 100) / 100,
      duration: Math.round(duration * 100) / 100,
      diversity: Math.round(diversity * 100) / 100,
      impact: Math.round(impact * 100) / 100,
    },
  };
}
