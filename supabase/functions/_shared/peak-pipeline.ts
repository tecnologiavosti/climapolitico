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
  { id: "congresso", label: "Congresso" },
  { id: "executivo", label: "Executivo" },
  { id: "economia", label: "Economia" },
  { id: "internacional", label: "Internacional" },
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
  status: "confirmed" | "probable" | "weak" | "indeterminate";
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
  else if (weight >= 0.4 || breakdown.tier3 >= 1) status = "weak";
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

const MIN_DAILY_VOLUME = 20;

export function detectSpikes(series: SeriesPoint[], opts: { zThreshold?: number; minVolume?: number; window?: number } = {}): SpikeResult[] {
  const z = opts.zThreshold ?? 2.0;
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
      series[i].mentions > mean * 1.7 &&
      zscore >= z;
    out.push({ date: series[i].date, mentions: series[i].mentions, baseline: Math.round(mean * 10) / 10, std: Math.round(std * 10) / 10, zscore: Math.round(zscore * 100) / 100, isSpike });
  }
  return out;
}

// ---------- Hybrid spike detector ----------
// Combines 4 independent signals; emits a spike if ANY 2 fire on the same day.
// Signals: zscore (rolling 14d), momentum (3d avg vs 7d avg), burst (CUSUM-like
// streak over baseline), anomaly (IQR outlier over 30d window).
export type SpikeSignal = "z" | "ewma" | "momentum" | "burst" | "anomaly";

export interface HybridSpike {
  date: string;
  mentions: number;
  baseline: number;
  zscore: number;
  signals: SpikeSignal[];
  isSpike: boolean;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export function detectHybridSpikes(series: SeriesPoint[], opts: { minVolume?: number } = {}): HybridSpike[] {
  const minVol = opts.minVolume ?? MIN_DAILY_VOLUME;
  const n = series.length;
  const counts = series.map((p) => Number(p.mentions || 0));
  const out: HybridSpike[] = [];
  let cusum = 0;
  const alpha = 0.3;
  let ewmaMean = counts[0] ?? 0;
  let ewmaVar = 1;
  for (let i = 0; i < n; i++) {
    const c = counts[i];
    // Robust baseline: median + MAD over 14d window (resistant to outliers).
    const win14 = counts.slice(Math.max(0, i - 14), i);
    const sorted14 = win14.slice().sort((a, b) => a - b);
    const median14 = sorted14.length ? quantile(sorted14, 0.5) : 0;
    const absDev = win14.map((v) => Math.abs(v - median14)).sort((a, b) => a - b);
    const mad = absDev.length ? quantile(absDev, 0.5) : 0;
    const mean14 = win14.length ? win14.reduce((s, v) => s + v, 0) / win14.length : 0;
    const std14 = Math.max(1.4826 * mad, Math.max(1, mean14 * 0.25));
    const z = (c - median14) / std14;

    // EWMA control chart relaxed: mean + 2.5σ (was 3σ).
    const ewmaStd = Math.sqrt(ewmaVar) || Math.max(1, ewmaMean * 0.25);
    const ewmaHit = i >= 5 && c >= minVol && c > ewmaMean + 2.5 * ewmaStd && c > ewmaMean * 1.4;
    const prevMean = ewmaMean;
    ewmaMean = alpha * c + (1 - alpha) * ewmaMean;
    ewmaVar = alpha * (c - prevMean) ** 2 + (1 - alpha) * ewmaVar;

    const last3 = counts.slice(Math.max(0, i - 2), i + 1);
    const mean3 = last3.length ? last3.reduce((s, v) => s + v, 0) / last3.length : 0;
    const last7 = counts.slice(Math.max(0, i - 7), i);
    const mean7 = last7.length ? last7.reduce((s, v) => s + v, 0) / last7.length : 0;
    const momentum = mean7 > 0 ? mean3 / mean7 : 0;

    // CUSUM-style burst relaxed: 1.3·median + lower floor.
    if (c > median14 * 1.3) cusum += (c - median14 * 1.3);
    else cusum = Math.max(0, cusum * 0.6);
    const burstHit = cusum >= Math.max(30, median14 * 2);

    const win30 = counts.slice(Math.max(0, i - 30), i).slice().sort((a, b) => a - b);
    const q1 = quantile(win30, 0.25);
    const q3 = quantile(win30, 0.75);
    const iqr = q3 - q1;
    const anomalyHit = win30.length >= 8 && c > q3 + 1.5 * iqr && c >= minVol;

    const signals: SpikeSignal[] = [];
    if (win14.length >= 5 && z >= 1.6 && c >= minVol) signals.push("z");
    if (ewmaHit) signals.push("ewma");
    if (last7.length >= 5 && momentum >= 1.4 && c >= minVol) signals.push("momentum");
    if (burstHit && c >= minVol) signals.push("burst");
    if (anomalyHit) signals.push("anomaly");

    // Relaxed gate: ≥2 signals OR (z≥2.5 alone) OR (burst+anomaly alone).
    const strongAlone = (z >= 2.5 && c >= minVol) || (burstHit && anomalyHit);
    const isSpike = (signals.length >= 2 || strongAlone) && c > median14;
    out.push({
      date: series[i].date,
      mentions: c,
      baseline: Math.round(median14 * 10) / 10,
      zscore: Math.round(z * 100) / 100,
      signals,
      isSpike,
    });
  }
  return out;
}

// Dynamic per-candidate threshold: max(baseline*2.5, p95).
// Use to gate borderline cases or to compute relative intensity in UI.
export function dynamicThreshold(series: SeriesPoint[]): { baseline: number; p95: number; threshold: number } {
  const counts = series.map((p) => Number(p.mentions || 0)).filter((v) => v > 0).sort((a, b) => a - b);
  if (counts.length === 0) return { baseline: 0, p95: 0, threshold: 0 };
  const baseline = counts.reduce((s, v) => s + v, 0) / counts.length;
  const p95 = quantile(counts, 0.95);
  return { baseline: Math.round(baseline * 10) / 10, p95: Math.round(p95), threshold: Math.round(Math.max(baseline * 2.5, p95)) };
}

// Weighted confidence score per the brief spec (0..100).
// score = 0.20*z + 0.15*burst + 0.15*momentum + 0.20*source_diversity
//       + 0.10*source_authority + 0.10*cross_platform + 0.10*political_relevance
export interface ConfidenceInput {
  zscore: number;                  // raw z (>= 0)
  burst: number;                   // 0..1 normalized
  momentum: number;                // 0..1 normalized
  source_diversity: number;        // 0..1 normalized (distinct strong outlets / 5)
  source_authority: number;        // 0..1 normalized (tier-weighted)
  cross_platform: number;          // 0..1 normalized (#platforms / 4)
  political_relevance: number;     // 0..1 normalized
}
export type ConfidenceStatus = "confirmed" | "probable" | "weak" | "indeterminate";
export interface ConfidenceScored {
  score: number;
  status: ConfidenceStatus;
  breakdown: ConfidenceInput;
}
export function computeConfidenceScore(input: ConfidenceInput): ConfidenceScored {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const z = clamp01(input.zscore / 4); // z=4 → 1.0
  const b = clamp01(input.burst);
  const m = clamp01(input.momentum);
  const sd = clamp01(input.source_diversity);
  const sa = clamp01(input.source_authority);
  const cp = clamp01(input.cross_platform);
  const pr = clamp01(input.political_relevance);
  const raw = 0.20 * z + 0.15 * b + 0.15 * m + 0.20 * sd + 0.10 * sa + 0.10 * cp + 0.10 * pr;
  const score = Math.round(raw * 100);
  let status: ConfidenceStatus = "indeterminate";
  if (score >= 85) status = "confirmed";
  else if (score >= 70) status = "probable";
  else if (score >= 50) status = "weak";
  return { score, status, breakdown: { zscore: z, burst: b, momentum: m, source_diversity: sd, source_authority: sa, cross_platform: cp, political_relevance: pr } };
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
  { id: "congresso", threshold: 2, terms: [
    { re: /\b(camara dos deputados|senado federal|congresso nacional)\b/i, w: 3 },
    { re: /\b(votacao|aprovacao|sancao|veto)\b/i, w: 1 },
    { re: /\b(projeto de lei|pec|medida provisoria|requerimento)\b/i, w: 2 },
    { re: /\b(plenario|comissao mista|liderança do governo)\b/i, w: 1 },
  ]},
  { id: "executivo", threshold: 2, terms: [
    { re: /\b(planalto|palacio do planalto|presidencia da republica)\b/i, w: 3 },
    { re: /\b(decreto presidencial|medida provisoria|reforma ministerial|ministro de estado)\b/i, w: 2 },
    { re: /\b(posse presidencial|pronunciamento|cadeia nacional)\b/i, w: 2 },
    { re: /\b(governo federal|esplanada dos ministerios)\b/i, w: 1 },
  ]},
  { id: "economia", threshold: 2, terms: [
    { re: /\b(pib|inflacao|ipca|igp|selic|copom|cambio|dolar|bolsa|ibovespa|fiscal|arcabouco)\b/i, w: 2 },
    { re: /\b(banco central|fazenda|ministerio da fazenda|haddad|reforma tributaria)\b/i, w: 2 },
    { re: /\b(juros|recessao|crescimento economico|desemprego|emprego)\b/i, w: 1 },
  ]},
  { id: "internacional", threshold: 2, terms: [
    { re: /\b(g20|brics|onu|otan|mercosul|cupula)\b/i, w: 3 },
    { re: /\b(eua|estados unidos|china|russia|ucrania|israel|argentina|venezuela|uniao europeia)\b/i, w: 1 },
    { re: /\b(diplomacia|tratado|acordo bilateral|sancoes internacionais|embaixad)\b/i, w: 2 },
    { re: /\b(visita oficial|reuniao bilateral|chanceler|itamaraty)\b/i, w: 2 },
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
