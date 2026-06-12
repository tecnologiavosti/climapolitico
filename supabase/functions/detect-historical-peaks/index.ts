// IA histórica para "Picos de Menções": descobre acontecimentos políticos reais
// cruzando imprensa, vídeos, decisões, eleições e a série local de menções.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { firecrawlSearch, dedupePublications, estimatedReachOf, type ExternalPublication } from "../_shared/external-collector.ts";
import { buildContextualQueries } from "../_shared/politician-context.ts";
import {
  classifySource as pipelineClassifySource,
  confidenceFromSources as pipelineConfidence,
  classifyCategory as pipelineCategory,
  computeRelevance as pipelineRelevance,
  detectHybridSpikes,
  type SpikeSignal,
} from "../_shared/peak-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TimelinePoint = { date: string; count: number; isPeak?: boolean };

const FUNCTION_TIMEOUT_MS = 20_000;
const MAX_STAT_RECORDS = 3_000;
const MAX_AI_RECORDS = 1_000;
const HIGH_VOLUME_MENTIONS = 50_000;
const NORMAL_CORRELATION_LIMIT = 60;
const SAFE_CORRELATION_LIMIT = 24;

const VALID_PEAK_CATEGORIES = new Set([
  "eleicao", "operacao_pf", "stf", "tse", "cpi", "julgamento", "escandalo", "prisao", "debate", "outros",
]);

// Apenas termos de ALTA RELEVÂNCIA POLÍTICA. Comícios, agendas, visitas, caminhadas,
// reuniões partidárias e encontros locais foram removidos por orientação do produto.
const EVENT_TERMS = [
  "eleição", "debate presidencial", "decisão judicial", "STF", "TSE", "CPI",
  "operação policial", "operação da PF", "votação", "Congresso", "Senado", "Câmara",
  "segundo turno", "primeiro turno", "julgamento", "impeachment", "cassação",
  "inelegibilidade", "investigação", "indiciamento", "denúncia", "escândalo",
  "prisão", "absolvição", "condenação", "sanção presidencial", "veto presidencial",
  "mudança ministerial", "posse presidencial", "crise política", "pronunciamento oficial",
];

// Tipos de evento bloqueados — não são "picos" de repercussão política nacional.
const BLOCKED_EVENT_TYPES = /^(comicio|caminhada|agenda|visita|reuniao|reuniao_partidaria|encontro|encontro_apoiadores|ato_campanha|panfletagem|carreata|evento_local|inauguracao)$/i;
const BLOCKED_NAME_TERMS = /\b(comicio|comício|caminhada|carreata|panfletagem|reunião partidária|reuniao partidaria|encontro com apoiador|visita de rotina|inauguração local|inauguracao local|evento em |comício em|comicio em)\b/i;

function cleanText(value: unknown): string {
  let s = String(value || "");
  // strip CDATA + dangerous blocks first
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
       .replace(/<script[\s\S]*?<\/script>/gi, " ")
       .replace(/<style[\s\S]*?<\/style>/gi, " ")
       .replace(/<video[\s\S]*?<\/video>/gi, " ")
       .replace(/<source[^>]*>/gi, " ");
  // remove all real and "broken" HTML tags (with or without angle brackets)
  // ex: "a Luiz Fux ... /a", "font color=#xxx", "/font", "div", "/p"
  s = s.replace(/<\/?[a-z][a-z0-9]*(\s[^>]*)?>/gi, " ")
       .replace(/\b\/?(a|p|div|span|br|hr|img|font|table|tr|td|th|ul|ol|li|h[1-6]|strong|em|b|i|u|small|nav|header|footer|section|article|figure|figcaption|iframe|object|embed|param|video|audio|source|picture|svg|path|style|script|meta|link|head|body|html|title|form|input|button|select|option|label|fieldset|legend|tbody|thead|tfoot|caption|colgroup|col|pre|code|kbd|samp|var|cite|dfn|abbr|acronym|sub|sup|q|s|del|ins|mark|ruby|rt|rp|bdi|bdo|wbr|details|summary|dialog|menu|menuitem|template|slot)\b\s*\/?\s*(?=\s|$|[.,;:!?])/gi, " ")
       .replace(/\b(?:font|a|p|div|span|img|iframe|table|tr|td|th)\s+[a-z\-]+=("[^"]*"|'[^']*'|\S+)/gi, " ")
       .replace(/\b(?:href|src|class|target|rel|nofollow|width|height|type|color|style|align|bgcolor|border|cellpadding|cellspacing|colspan|rowspan|valign)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, " ");
  // HTML entities
  s = s.replace(/&nbsp;/gi, " ")
       .replace(/&amp;/gi, "&")
       .replace(/&lt;/gi, "<")
       .replace(/&gt;/gi, ">")
       .replace(/&quot;/gi, '"')
       .replace(/&#39;|&#x27;/gi, "'")
       .replace(/&[a-z]+;/gi, " ")
       .replace(/&#\d+;/g, " ");
  // strip URLs and stray markup characters
  s = s.replace(/https?:\/\/\S+/gi, " ")
       .replace(/\[[^\]]*\]\([^)]*\)/g, " ") // markdown links
       .replace(/[{}<>]/g, " ")
       .replace(/[*_`~]{2,}/g, " ")
       .replace(/^\s*[-*•]\s+/gm, "")
       .replace(/\s{2,}/g, " ")
       .replace(/\s+([.,;:!?])/g, "$1")
       .trim();
  return s;
}

// Corta texto sem quebrar palavras (evita "presenç", "seguranç", "corrupçã").
function safeSlice(value: string, max: number): string {
  if (!value) return "";
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;.:!?-]+$/g, "") + "…";
}

function decodeXmlValue(value: unknown): string {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .trim();
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseDate(value: string, endOfDay = false): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Data inválida");
  d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return d;
}

function yyyymmddhhmmss(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function hostNameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Fonte externa"; }
}

function eventYearQueries(candidateName: string, start: Date, end: Date): string[] {
  const years = new Set<number>();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) years.add(y);
  const terms = [
    "eleição", "campanha", "segundo turno", "primeiro turno", "debate", "entrevista",
    "posse", "investigação", "STF", "TSE", "Senado", "CPI", "votação", "discurso",
  ];
  const queries: string[] = [];
  for (const year of years) {
    for (const term of terms) queries.push(`"${candidateName}" ${term} ${year}`);
  }
  return queries;
}

function sourceDateMs(pub: ExternalPublication): number | null {
  if (!pub.publishedAt) return null;
  const t = new Date(pub.publishedAt).getTime();
  return Number.isFinite(t) ? t : null;
}

function isOfficialOrJournalistic(pub: ExternalPublication): boolean {
  const host = hostNameOf(pub.url).toLowerCase();
  const outlet = normalize(pub.outlet || "");
  return /\.(gov|jus|leg)\.br$|gov\.br|tse\.jus\.br|stf\.jus\.br|senado\.leg\.br|camara\.leg\.br|planalto\.gov\.br|youtube\.com|youtu\.be|tiktok\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|t\.me|telegram\.me|bsky\.app|reddit\.com|threads\.net|g1\.globo\.com|folha\.uol\.com\.br|estadao\.com\.br|valor\.globo\.com|poder360\.com\.br|cnnbrasil\.com\.br|uol\.com\.br|metropoles\.com|reuters\.com|bbc\.com|oglobo\.globo\.com|veja\.abril\.com\.br|terra\.com\.br|r7\.com|band\.uol\.com\.br|congressoemfoco\.uol\.com\.br|cartacapital\.com\.br|nexojornal\.com\.br|brasildefato\.com\.br/i.test(host)
    || /agencia brasil|senado|camara|stf|tse|reuters|bbc|folha|estadao|estadao conteudo|valor|g1|cnn|uol|poder360|metropoles|o globo|oglobo|veja|terra|isto[eé]|r7|band|record|jovem pan|congresso em foco|carta ?capital|youtube|tiktok|twitter|facebook|instagram|telegram|bluesky|reddit|threads/.test(outlet);
}

function classifyPub(pub: ExternalPublication): "news" | "video" | "post" {
  const host = hostNameOf(pub.url).toLowerCase();
  if (/youtube\.com|youtu\.be|tiktok\.com|vimeo\.com|globoplay\.globo\.com/.test(host)) return "video";
  if (/twitter\.com|x\.com|facebook\.com|instagram\.com|t\.me|telegram\.me|bsky\.app|reddit\.com|threads\.net/.test(host)) return "post";
  return "news";
}

const SENT_POS = ["aprov", "elogi", "vit[óo]ria", "avanç", "conquist", "destaq", "homenag", "celebr", "sucesso", "fortale", "apoio", "favor[áa]vel", "lider", "cresc"];
const SENT_NEG = ["cr[íi]tic", "ataq", "esc[âa]ndalo", "polem", "denunc", "investiga", "rejeiç", "queda", "derrota", "renunc", "condenaç", "afast", "impeach", "fraude", "corrupç", "pris[ãa]o", "indici"];

function sentimentOf(text: string): "pos" | "neg" | "neu" {
  const t = normalize(text);
  let pos = 0, neg = 0;
  for (const w of SENT_POS) if (new RegExp(w).test(t)) pos++;
  for (const w of SENT_NEG) if (new RegExp(w).test(t)) neg++;
  if (pos > neg && pos >= 1) return "pos";
  if (neg > pos && neg >= 1) return "neg";
  return "neu";
}

function aggregateSentiment(pubs: ExternalPublication[]): { pos: number; neg: number; neu: number } {
  let pos = 0, neg = 0, neu = 0;
  for (const p of pubs) {
    const s = sentimentOf(`${p.title} ${p.snippet}`);
    if (s === "pos") pos++; else if (s === "neg") neg++; else neu++;
  }
  const total = pos + neg + neu || 1;
  return { pos: Math.round((pos / total) * 100), neg: Math.round((neg / total) * 100), neu: Math.round((neu / total) * 100) };
}

function estimateVolumeFromPubs(pubs: ExternalPublication[]): number {
  let total = 0;
  for (const p of pubs) {
    const klass = classifyPub(p);
    const reach = p.outletReach || 3;
    const base = klass === "video" ? 4500 : klass === "post" ? 1200 : 2200;
    total += Math.round(base * (reach / 4));
  }
  return total;
}

function countsByClass(pubs: ExternalPublication[]): { news: number; videos: number; posts: number } {
  let news = 0, videos = 0, posts = 0;
  for (const p of pubs) {
    const k = classifyPub(p);
    if (k === "video") videos++; else if (k === "post") posts++; else news++;
  }
  return { news, videos, posts };
}

function significantTokens(value: string): string[] {
  return normalize(value).match(/[a-z0-9]{4,}/g)?.filter((t) => !["para", "como", "sobre", "entre", "pela", "pelo", "brasil", "politico", "politica", "noticia", "evento"].includes(t)) || [];
}

function supportTermsForEvent(evt: any, candidateName: string): string[] {
  const candidateTokens = new Set(significantTokens(candidateName));
  return Array.from(new Set([
    ...((Array.isArray(evt?.keywords) ? evt.keywords : []) as string[]).flatMap(significantTokens),
    ...significantTokens(`${evt?.name || ""} ${evt?.description || ""} ${evt?.type || ""}`).slice(0, 10),
  ])).filter((term) => !candidateTokens.has(term)).slice(0, 16);
}

function sourceSupportsEvent(pub: ExternalPublication, evt: any, start: Date, end: Date, candidateName: string): boolean {
  if (!isOfficialOrJournalistic(pub)) return false;
  const text = normalize(`${pub.title} ${pub.snippet} ${pub.outlet}`);
  const candidateTokens = normalize(candidateName).split(/\s+/).filter((t) => t.length >= 4 && !["das", "dos", "de", "da", "do"].includes(t));
  const candidateHit = text.includes(normalize(candidateName)) || (candidateTokens.length > 0 && candidateTokens.filter((t) => text.includes(t)).length >= Math.min(2, candidateTokens.length));
  const terms = supportTermsForEvent(evt, candidateName);
  const hasTerm = terms.length > 0 && terms.some((term) => text.includes(term));
  const hasPoliticalEventTerm = EVENT_TERMS.some((term) => text.includes(normalize(term)));
  const date = sourceDateMs(pub);
  const eventStart = new Date(`${String(evt?.start_date || start.toISOString().slice(0, 10)).slice(0, 10)}T00:00:00Z`).getTime();
  const eventEnd = new Date(`${String(evt?.end_date || evt?.start_date || end.toISOString().slice(0, 10)).slice(0, 10)}T23:59:59Z`).getTime();
  const withinEvent = date == null || (date >= eventStart - 21 * 86400000 && date <= eventEnd + 21 * 86400000);
  const withinPeriod = date == null || (date >= start.getTime() - 86400000 && date <= end.getTime() + 86400000);
  return candidateHit && (hasTerm || hasPoliticalEventTerm) && withinEvent && withinPeriod;
}

function matchedSources(evt: any, pubs: ExternalPublication[], start: Date, end: Date, candidateName: string): ExternalPublication[] {
  const indices = Array.isArray(evt?.sourceIndices)
    ? evt.sourceIndices.map((n: any) => Number(n) - 1).filter((n: number) => n >= 0 && n < pubs.length)
    : [];
  const selected = indices.map((i: number) => pubs[i]).filter((p: ExternalPublication) => sourceSupportsEvent(p, evt, start, end, candidateName));
  if (selected.length > 0) return selected;
  return pubs.filter((p) => sourceSupportsEvent(p, evt, start, end, candidateName)).slice(0, 8);
}

function coverageDurationDays(pubs: ExternalPublication[]): number {
  const dates = pubs.map(sourceDateMs).filter((n): n is number => n != null).sort((a, b) => a - b);
  if (dates.length < 2) return pubs.length > 0 ? 1 : 0;
  return Math.max(1, Math.ceil((dates[dates.length - 1] - dates[0]) / 86400000) + 1);
}

function politicalImpactWeight(type: string): number {
  const t = normalize(type);
  if (/eleicao|decisao|judicial|operacao|cpi|votacao|posse|impeachment|julgamento|prisao|cassacao|condenacao|absolvicao|denuncia/.test(t)) return 24;
  if (/debate|entrevista|discurso|coletiva|agenda/.test(t)) return 16;
  return 10;
}

const HISTORICAL_EVENT_TYPES = new Set([
  "eleicao", "debate", "entrevista", "discurso", "coletiva", "decisao_judicial", "cpi", "operacao",
  "votacao", "impeachment", "posse", "julgamento", "prisao", "cassacao", "denuncia", "condenacao", "absolvicao",
]);

function isHistoricallyRelevantEvent(evt: any): boolean {
  const type = normalize(String(evt?.type || "")).replace(/[^a-z_]/g, "");
  const text = normalize(`${evt?.name || ""} ${evt?.description || ""} ${evt?.motivo || ""} ${evt?.political_impact || ""} ${evt?.electoral_impact || ""}`);
  const hasKnownType = HISTORICAL_EVENT_TYPES.has(type) || /eleicao|prisao|impeachment|cpi|operacao|stf|tse|decisao|julgamento|posse|cassacao|denuncia|condenacao|absolvicao|debate/.test(type);
  const hasHistoricalTerm = /eleicao|prisao|curitiba|impeachment|cpi|lava jato|operacao|stf|tse|supremo|tribunal|julgamento|habeas corpus|posse|cassacao|denuncia|condenacao|absolvicao|impugnacao|candidatura|debate|segundo turno|primeiro turno|substituicao/.test(text);
  const hasContext = cleanText(evt?.description).length >= 80 && (cleanText(evt?.political_impact).length >= 30 || cleanText(evt?.electoral_impact).length >= 30 || cleanText(evt?.motivo).length >= 30);
  return Boolean(evt?.name && evt?.start_date && hasContext && (hasKnownType || hasHistoricalTerm));
}

function historicalRelevanceScore(evt: any, pubs: ExternalPublication[]): number {
  const text = normalize(`${evt?.type || ""} ${evt?.name || ""} ${evt?.description || ""}`);
  let score = politicalImpactWeight(String(evt?.type || evt?.name || "")) + 28;
  if (/prisao|impeachment|eleicao|decisao|stf|tse|julgamento|cassacao|condenacao/.test(text)) score += 18;
  if (/cpi|operacao|lava jato|denuncia|posse|segundo turno|impugnacao|substituicao/.test(text)) score += 12;
  if (cleanText(evt?.political_impact).length > 80) score += 8;
  if (cleanText(evt?.electoral_impact).length > 80) score += 8;
  if (Array.isArray(evt?.participants) && evt.participants.length >= 2) score += 5;
  score += Math.min(12, pubs.length * 3);
  return Math.max(45, Math.min(100, Math.round(score)));
}

// Classifica a qualidade da cobertura externa de um evento.
// Nenhum evento é descartado por cobertura fraca — o nível é exibido como badge na UI
// e usado para modular o relevance_score.
type CoverageQuality = "forte" | "media" | "fraca" | "ai_only";
function coverageQuality(totalEvidence: number, distinctOutlets: number): CoverageQuality {
  if (totalEvidence === 0 || distinctOutlets === 0) return "ai_only";
  if (distinctOutlets >= 5 && totalEvidence >= 10) return "forte";
  if (distinctOutlets >= 2) return "media";
  return "fraca";
}

// Categoria do evento para os filtros da timeline histórica.
// Combina TODOS os campos textuais disponíveis (nome, tipo, descrição, motivo, what/why,
// participantes, keywords, impacto político, títulos de fontes externas, outlets e termos frequentes)
// para garantir que todo pico receba uma categoria — não depende só de cobertura externa.
function classifyPeakCategory(evt: any): string {
  const parts: string[] = [
    evt?.name, evt?.type, evt?.description, evt?.motivo,
    evt?.what_happened, evt?.why_happened, evt?.political_impact,
    evt?.electoral_impact, evt?.aftermath,
    Array.isArray(evt?.keywords) ? evt.keywords.join(" ") : "",
    Array.isArray(evt?.participants) ? evt.participants.join(" ") : "",
    Array.isArray(evt?.outlet_names) ? evt.outlet_names.join(" ") : "",
    Array.isArray(evt?.top_terms) ? evt.top_terms.join(" ") : "",
    Array.isArray(evt?.entities) ? evt.entities.join(" ") : "",
    Array.isArray(evt?.sources)
      ? evt.sources.map((s: any) => `${s?.title || ""} ${s?.name || ""}`).join(" ")
      : "",
  ];
  const text = normalize(parts.filter(Boolean).join(" "));

  // Ordem importa: categorias mais específicas primeiro.
  if (/\bpf\b|policia federal|\boperacao\b|busca e apreensao|mandado de busca|deflagrou|deflagrada/.test(text)) return "operacao_pf";
  if (/\bstf\b|supremo|supremo tribunal|alexandre de moraes|gilmar|gilmar mendes|barroso|dias toffoli|fachin|carmen lucia|cristiano zanin|nunes marques/.test(text)) return "stf";
  if (/\btse\b|tribunal superior eleitoral|\beleitoral\b|registro de candidatura|inelegibilidade|cassacao de mandato|cassacao do registro/.test(text)) return "tse";
  if (/\bcpi\b|comissao parlamentar|comissao de inquerito|senado investigando|requerimento de cpi/.test(text)) return "cpi";
  if (/\bprisao\b|\bpreso\b|\bdetido\b|\bdetencao\b|indiciamento|indiciado|cumprimento de pena/.test(text)) return "prisao";
  if (/\bescandalo\b|corrupcao|vazamento|denuncia|propina|desvio de|rachadinha|caixa 2|lavagem de dinheiro|impeachment/.test(text)) return "escandalo";
  if (/\bdebate\b|sabatina|confronto|confronto entre candidatos|debate presidencial|debate eleitoral/.test(text)) return "debate";
  if (/\bjulgamento\b|sentenca|condenacao|condenado|absolvicao|absolvido|\brecurso\b|decisao judicial|acordao|pena de \d/.test(text)) return "julgamento";
  if (/\beleicao\b|\beleicoes\b|campanha|votacao|\bvoto\b|\burna\b|urnas|candidato|primeiro turno|segundo turno|posse presidencial|comicio/.test(text)) return "eleicao";
  return "outros";
}

function categoryOf(evt: any): string {
  const category = classifyPeakCategory(evt);
  return VALID_PEAK_CATEGORIES.has(category) ? category : "outros";
}

function safeAnalysisFromKeywords(evt: any): { cause: string; confidence: number } {
  const terms = [
    ...(Array.isArray(evt?.keywords) ? evt.keywords : []),
    ...(Array.isArray(evt?.top_terms) ? evt.top_terms : []),
    ...(Array.isArray(evt?.entities) ? evt.entities : []),
  ].map(cleanText).filter(Boolean).slice(0, 8);
  return {
    cause: terms.length
      ? `Análise resumida baseada nos termos associados: ${terms.join(", ")}.`
      : "Análise indisponível",
    confidence: terms.length ? 35 : 0,
  };
}

// Score baseado em volume/anomalia SSOT (interno) — peso 80% no final.
function ssotScoreOf(internalMentions: number, internalEngagement: number, zScore: number): number {
  const mentionsScore = Math.min(40, Math.log10(Math.max(1, internalMentions)) * 12);
  const engagementScore = Math.min(30, Math.log10(Math.max(1, internalEngagement)) * 7);
  const anomalyScore = Math.min(30, Math.max(0, zScore) * 8);
  return Math.round(mentionsScore + engagementScore + anomalyScore);
}

function relevanceFromEvidence(evt: any, pubs: ExternalPublication[], _mentions: number): number {
  const distinctOutlets = new Set(pubs.map((p) => normalize(p.outlet))).size;
  const reach = pubs.reduce((sum, p) => sum + (p.outletReach || 3), 0);
  const counts = countsByClass(pubs);
  const diversity = (counts.news > 0 ? 1 : 0) + (counts.videos > 0 ? 1 : 0) + (counts.posts > 0 ? 1 : 0);
  const officialBonus = pubs.some((p) => /\.(gov|jus|leg)\.br|gov\.br|tse\.jus\.br|stf\.jus\.br|senado\.leg\.br|camara\.leg\.br/i.test(hostNameOf(p.url))) ? 10 : 0;
  const score = Math.min(36, distinctOutlets * 7)
    + Math.min(22, pubs.length * 1.6)
    + Math.min(12, counts.news * 2)
    + Math.min(8, counts.videos * 3)
    + Math.min(8, counts.posts * 2)
    + Math.min(10, reach * 1.2)
    + Math.min(10, coverageDurationDays(pubs) * 1.5)
    + diversity * 4
    + politicalImpactWeight(String(evt?.type || evt?.name || ""))
    + officialBonus;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Detecta picos estatísticos puros na série SSOT (localTimeline) com o detector híbrido:
// combina z-score, momentum, burst (CUSUM) e anomaly (IQR). Picos = ≥2 sinais.
function ssotPeakEvents(timeline: TimelinePoint[]): any[] {
  const points = (timeline || [])
    .map((p) => ({ date: String(p.date).slice(0, 10), mentions: Number(p.count || 0) }))
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 5) return [];

  const hybrid = detectHybridSpikes(points, { minVolume: 20 });

  // Agrupa dias consecutivos (gap <= 2 dias) em um único evento (start..end).
  type Cluster = { start: string; end: string; peakDate: string; peakCount: number; baseline: number; z: number; days: number; signals: Set<SpikeSignal> };
  const clusters: Cluster[] = [];
  let cur: Cluster | null = null;
  for (const f of hybrid) {
    if (!f.isSpike) { if (cur) { clusters.push(cur); cur = null; } continue; }
    const prevTs = cur ? new Date(`${cur.end}T00:00:00Z`).getTime() : 0;
    const curTs = new Date(`${f.date}T00:00:00Z`).getTime();
    const gapDays = cur ? (curTs - prevTs) / 86400000 : 0;
    if (cur && gapDays <= 2) {
      cur.end = f.date;
      cur.days += 1;
      for (const s of f.signals) cur.signals.add(s);
      if (f.mentions > cur.peakCount) { cur.peakDate = f.date; cur.peakCount = f.mentions; cur.z = f.zscore; cur.baseline = f.baseline; }
    } else {
      if (cur) clusters.push(cur);
      cur = { start: f.date, end: f.date, peakDate: f.date, peakCount: f.mentions, baseline: f.baseline, z: f.zscore, days: 1, signals: new Set(f.signals) };
    }
  }
  if (cur) clusters.push(cur);

  return clusters
    .sort((a, b) => b.peakCount - a.peakCount || b.z - a.z)
    .slice(0, 250)
    .map((c) => ({
      name: c.start === c.end
        ? `Pico de menções em ${c.start}`
        : `Pico de menções (${c.start} a ${c.end})`,
      type: "pico_ssot",
      start_date: c.start,
      end_date: c.end,
      description: `Volume anômalo detectado nas redes monitoradas (${c.days} dia(s); pico em ${c.peakDate} com ${c.peakCount} menções vs baseline ${Math.round(c.baseline)}; z-score ${c.z.toFixed(2)}; sinais: ${Array.from(c.signals).join(", ")}).`,
      motivo: "Anomalia estatística no volume de menções internas (detector híbrido z+momentum+burst+anomaly).",
      keywords: [],
      sourceIndices: [],
      _ssot_z: Number(c.z.toFixed(2)),
      _ssot_baseline: Math.round(c.baseline),
      _ssot_peak: c.peakCount,
      _ssot_days: c.days,
      _ssot_peak_date: c.peakDate,
      _ssot_signals: Array.from(c.signals),
    }));
}


// Busca a timeline SSOT direto em social_metrics_daily (servidor), agregando todas as redes.
async function fetchSsotTimelineFromDb(
  admin: any,
  userId: string,
  candidateId: string,
  start: Date,
  end: Date,
): Promise<TimelinePoint[]> {
  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);
  const byDay = new Map<string, number>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const currentPageSize = Math.min(pageSize, MAX_STAT_RECORDS - from);
    if (currentPageSize <= 0) break;
    const { data, error } = await admin
      .from("social_metrics_daily")
      .select("date, mentions")
      .eq("user_id", userId)
      .eq("candidate_id", candidateId)
      .gte("date", startISO)
      .lte("date", endISO)
      .order("date", { ascending: true })
      .range(from, from + currentPageSize - 1);
    if (error) { console.warn("[detect-historical-peaks] smd fetch:", error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const d = String(row.date).slice(0, 10);
      byDay.set(d, (byDay.get(d) || 0) + Number(row.mentions || 0));
    }
    if (data.length < currentPageSize) break;
    from += pageSize;
    if (from >= MAX_STAT_RECORDS) break;
  }
  return [...byDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

function fallbackEventsFromSources(pubs: ExternalPublication[], start: Date, end: Date): any[] {
  const buckets = new Map<string, ExternalPublication[]>();
  for (const pub of pubs) {
    if (!isOfficialOrJournalistic(pub)) continue;
    const date = pub.publishedAt ? new Date(pub.publishedAt).toISOString().slice(0, 10) : start.toISOString().slice(0, 10);
    const tokens = significantTokens(pub.title).slice(0, 5).join(" ");
    const key = `${date}|${tokens}`;
    buckets.set(key, [...(buckets.get(key) || []), pub]);
  }
  return [...buckets.entries()].map(([key, sources]) => {
    const [date] = key.split("|");
    const main = sources[0];
    const title = cleanText(main.title).replace(/\s+-\s+[^-]{2,80}$/g, "");
    const terms = EVENT_TERMS.filter((term) => normalize(`${main.title} ${main.snippet}`).includes(normalize(term))).slice(0, 5);
    return {
      name: title || `Acontecimento político documentado em ${date}`,
      type: terms[0] || "noticia",
      start_date: date,
      end_date: date,
      description: cleanText(main.snippet || main.title).slice(0, 500),
      motivo: `Evento identificado a partir de cobertura externa documentada por ${new Set(sources.map((s) => s.outlet)).size} veículo(s).`,
      keywords: terms.length ? terms : significantTokens(main.title).slice(0, 6),
      sourceIndices: sources.map((s) => pubs.findIndex((p) => p.url === s.url) + 1).filter((n) => n > 0),
      relevance_score: relevanceFromEvidence({ type: terms[0], name: title }, sources, 0),
      mentions_estimate: 0,
      variation_pct: 0,
    };
  }).filter((evt) => {
    const t = new Date(`${evt.start_date}T12:00:00Z`).getTime();
    return t >= start.getTime() - 86400000 && t <= end.getTime() + 86400000;
  }).sort((a, b) => Number(b.relevance_score || 0) - Number(a.relevance_score || 0)).slice(0, 24);
}

async function fetchGoogleHistorical(query: string, start: string, end: string, limit = 25): Promise<ExternalPublication[]> {
  const q = `${query} after:${start} before:${end}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0)", "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    return blocks.slice(0, limit).map((block) => {
      const title = cleanText(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
      const link = decodeXmlValue(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
      const pubDate = cleanText(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "");
      const source = cleanText(block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || "") || hostNameOf(link);
      const description = cleanText(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "");
      return {
        url: link,
        title,
        snippet: description,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
        outlet: source,
        outletRegion: "Nacional" as const,
        outletReach: 4,
        source: "rss" as const,
        raw: { source: "google_news_historical" },
      };
    }).filter((p) => p.url && p.title);
  } catch (error) {
    console.warn("[detect-historical-peaks] google rss failed", (error as Error).message);
    return [];
  }
}

async function fetchGdeltHistorical(query: string, start: Date, end: Date, maxRecords = 60): Promise<ExternalPublication[]> {
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: String(maxRecords),
    sort: "DateDesc",
    startdatetime: yyyymmddhhmmss(start),
    enddatetime: yyyymmddhhmmss(end),
  });
  try {
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return [];
    const json = await response.json().catch(() => null) as any;
    return (Array.isArray(json?.articles) ? json.articles : []).map((a: any) => ({
      url: String(a?.url || ""),
      title: cleanText(a?.title || "").slice(0, 300),
      snippet: cleanText(a?.seendate ? `Publicado em ${a.seendate}` : a?.title || "").slice(0, 320),
      publishedAt: a?.seendate ? String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z") : undefined,
      outlet: String(a?.domain || hostNameOf(String(a?.url || ""))),
      outletRegion: "Nacional" as const,
      outletReach: 4,
      source: "gdelt" as const,
      raw: a,
    })).filter((p: ExternalPublication) => p.url && p.title);
  } catch (error) {
    console.warn("[detect-historical-peaks] gdelt failed", (error as Error).message);
    return [];
  }
}

function timelineCandidates(points: TimelinePoint[]): TimelinePoint[] {
  if (!points.length) return [];
  const counts = points.map((p) => Number(p.count || 0));
  const avg = counts.reduce((s, n) => s + n, 0) / Math.max(counts.length, 1);
  return points
    .map((p, i) => {
      const prev = counts.slice(Math.max(0, i - 7), i);
      const baseline = prev.length ? prev.reduce((s, n) => s + n, 0) / prev.length : avg;
      const growth = baseline > 0 ? ((p.count - baseline) / baseline) * 100 : 0;
      return { ...p, growth };
    })
    .filter((p: any) => p.count >= 15 && (p.count >= Math.max(25, avg * 2) || p.growth >= 300))
    .sort((a: any, b: any) => (b.count * Math.max(1, b.growth / 100)) - (a.count * Math.max(1, a.growth / 100)))
    .slice(0, 20);
}

type DiscoveredEvent = {
  name: string;
  type: string;
  start_date: string;
  end_date?: string;
  description?: string;
  motivo?: string;
  what_happened?: string;
  why_happened?: string;
  participants?: string[];
  political_impact?: string;
  electoral_impact?: string;
  aftermath?: string;
  keywords?: string[];
  search_queries?: string[];
};

async function discoverKnownEvents(
  candidateName: string,
  party: string | null,
  startShort: string,
  endShort: string,
): Promise<DiscoveredEvent[]> {
  const prompt = `Você é historiador político brasileiro. Liste APENAS acontecimentos políticos REAIS e DOCUMENTADOS de ALTA RELEVÂNCIA NACIONAL envolvendo ${candidateName}${party ? ` (${party})` : ""} entre ${startShort} e ${endShort}.

INCLUIR (somente fatos com repercussão nacional documentada):
- eleições (1º/2º turno, registro, impugnação, posse), debates presidenciais
- julgamentos, decisões do STF/TSE, habeas corpus, condenações, prisões, soltura, absolvições
- CPIs, depoimentos, votações importantes no Congresso
- operações policiais (Lava Jato, PF, MP), denúncias, indiciamentos, escândalos
- impeachment, cassação, inelegibilidade, afastamento
- sanção/veto presidencial, mudanças ministeriais, crises políticas nacionais
- pronunciamentos oficiais e entrevistas com forte repercussão nacional (JN, Roda Viva)

PROIBIDO (não incluir em hipótese alguma):
- comícios, caminhadas, carreatas, panfletagem, atos de campanha
- agendas de campanha, visitas de rotina, inaugurações locais
- reuniões partidárias, encontros com apoiadores
- eventos municipais/estaduais sem repercussão nacional
- entrevistas locais sem repercussão nacional

Use APENAS conhecimento histórico confirmado em múltiplas fontes confiáveis. NÃO invente.
Mire em 25-40 eventos quando o período cobrir eleição ou mandato.

Responda APENAS JSON válido:
{
  "events": [
    {
      "name": "nome factual e específico (ex.: 'Prisão de Lula em Curitiba')",
      "type": "eleicao|debate|decisao_judicial|cpi|operacao|votacao|impeachment|posse|julgamento|prisao|cassacao|denuncia|condenacao|absolvicao|sancao|crise|noticia",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "description": "o que aconteceu (3-5 frases factuais)",
      "motivo": "por que isso é historicamente relevante",
      "what_happened": "narrativa detalhada",
      "why_happened": "contexto e motivações",
      "participants": ["pessoa/instituição"],
      "political_impact": "impacto institucional",
      "electoral_impact": "impacto eleitoral (se houver)",
      "aftermath": "desdobramentos posteriores",
      "keywords": ["termo factual 1", "termo factual 2"],
      "search_queries": ["consulta específica para encontrar cobertura desse evento"]
    }
  ]
}`;
  try {
    const ai = await callAICerebrasFirst({
      systemMsg: "Você é historiador político brasileiro. Liste acontecimentos REAIS documentados, com datas precisas. Responda só JSON pt-BR.",
      userPrompt: prompt,
      jsonMode: true,
      maxTokens: 8000,
      temperature: 0.1,
      tag: "discover-known-events",
    });
    const content = ai.content || "";
    let parsed: any = {};
    try { parsed = JSON.parse(content); }
    catch { const m = content.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    return events.filter((e: any) => e && e.name && e.start_date).slice(0, 50);
  } catch (error) {
    console.error("[discover-known-events] failed", (error as Error).message);
    return [];
  }
}

function eventWindow(evt: DiscoveredEvent): { start: string; end: string } {
  const d = new Date(`${evt.start_date}T12:00:00Z`);
  const endD = new Date(`${evt.end_date || evt.start_date}T12:00:00Z`);
  const startW = new Date(d.getTime() - 21 * 86400000);
  const endW = new Date(endD.getTime() + 30 * 86400000);
  return { start: startW.toISOString().slice(0, 10), end: endW.toISOString().slice(0, 10) };
}

async function fetchCoverageForKnownEvent(
  evt: DiscoveredEvent,
  candidateName: string,
): Promise<ExternalPublication[]> {
  const { start: s, end: e } = eventWindow(evt);
  const startD = new Date(`${s}T00:00:00Z`);
  const endD = new Date(`${e}T23:59:59Z`);
  const queries = Array.from(new Set([
    ...(Array.isArray(evt.search_queries) ? evt.search_queries : []),
    `"${candidateName}" ${evt.name}`,
    ...(Array.isArray(evt.keywords) ? evt.keywords.slice(0, 4).map((k) => `"${candidateName}" ${k}`) : []),
  ])).slice(0, 5);
  const settled = await Promise.allSettled([
    ...queries.map((q) => fetchGoogleHistorical(q, s, e, 10)),
    ...queries.slice(0, 2).map((q) => fetchGdeltHistorical(q, startD, endD, 25)),
  ]);
  return settled.flatMap((r) => r.status === "fulfilled" ? r.value : []);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  console.time("detect-historical-peaks");
  const startedAt = Date.now();
  let stage = "inicio";
  const elapsed = () => Date.now() - startedAt;
  const timedOut = () => elapsed() >= FUNCTION_TIMEOUT_MS;
  const logStage = (name: string, details: Record<string, unknown> = {}) => {
    stage = name;
    console.log(JSON.stringify({ tag: "detect_historical_peaks_stage", stage, elapsed_ms: elapsed(), ...details }));
  };
  const errorResponse = (status: number, message: string) => new Response(JSON.stringify({
    success: false,
    stage,
    error: message,
  }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  logStage("inicio", { method: req.method });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return errorResponse(401, "Não autorizado");

    logStage("autenticacao");
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return errorResponse(401, "Não autorizado");

    logStage("validacao_payload");
    const { candidateId, startDate, endDate, localTimeline = [] } = await req.json();
    if (!candidateId || !startDate || !endDate) {
      return errorResponse(400, "candidateId, startDate e endDate são obrigatórios");
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate, true);
    const startShort = start.toISOString().slice(0, 10);
    const endShort = end.toISOString().slice(0, 10);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    logStage("busca_candidato", { candidateId });
    const { data: candidate } = await admin.from("candidates").select("id, full_name, party, user_id").eq("id", candidateId).maybeSingle();
    if (!candidate || candidate.user_id !== user.id) {
      return errorResponse(404, "Candidato não encontrado");
    }
    console.log("[detect-historical-peaks] candidate loaded", candidate.full_name);

    logStage("busca_mencoes", { max_records: MAX_STAT_RECORDS });
    const clientTimeline = Array.isArray(localTimeline) ? localTimeline.slice(0, MAX_STAT_RECORDS) : [];
    const dbTimeline = await fetchSsotTimelineFromDb(admin, user.id, candidate.id, start, end);
    const effectiveTimelineRaw: TimelinePoint[] = dbTimeline.length >= 5 ? dbTimeline : clientTimeline;
    const effectiveTimeline: TimelinePoint[] = effectiveTimelineRaw.slice(0, MAX_STAT_RECORDS);
    const totalMentionsForPeriod = effectiveTimeline.reduce((sum, p) => sum + Number(p.count || 0), 0);
    const safeMode = totalMentionsForPeriod >= HIGH_VOLUME_MENTIONS || effectiveTimelineRaw.length >= MAX_STAT_RECORDS;
    console.log(JSON.stringify({
      tag: "mentions_loaded",
      db_points: dbTimeline.length,
      client_points: clientTimeline.length,
      effective_points: effectiveTimeline.length,
      total_mentions: totalMentionsForPeriod,
      safe_mode: safeMode,
    }));

    // === FASE 1: DESCOBERTA HISTÓRICA — DESABILITADA ===
    // IA NUNCA cria eventos. Picos vêm de evidência real: cobertura externa + timeline SSOT.
    const discovered: DiscoveredEvent[] = [];
    logStage("busca_fontes_externas", { safe_mode: safeMode });

    // === FASE 2: COBERTURA DIRECIONADA POR EVENTO CONHECIDO ===
    const focusedSettled = await Promise.allSettled(
      discovered.slice(0, 40).map((evt) => fetchCoverageForKnownEvent(evt, candidate.full_name)),
    );
    const focusedPubs = focusedSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []);

    // === FASE 3: COLETA AMPLA (descobre eventos adicionais não previstos pela IA) ===
    const contextual = buildContextualQueries(candidate.full_name, safeMode ? 2 : 6);
    const platformQueries = [
      `"${candidate.full_name}" site:youtube.com`,
      `"${candidate.full_name}" (site:twitter.com OR site:x.com)`,
    ];
    const queryRoots = Array.from(new Set([
      `"${candidate.full_name}"`,
      ...contextual,
      ...eventYearQueries(candidate.full_name, start, end),
      ...EVENT_TERMS.map((term) => `"${candidate.full_name}" ${term}`),
      ...platformQueries,
    ])).slice(0, safeMode ? 10 : (days > 370 ? 32 : 22));

    const tbs = days <= 31 ? "qdr:m" : "qdr:y";
    const [googleSettled, gdeltSettled, firecrawlSettled] = await Promise.all([
      Promise.allSettled(queryRoots.map((q) => fetchGoogleHistorical(q, startShort, endShort, safeMode ? 8 : 15))),
      Promise.allSettled(queryRoots.slice(0, safeMode ? 4 : 12).map((q) => fetchGdeltHistorical(q, start, end, safeMode ? 15 : 40))),
      timedOut() ? Promise.resolve([]) : Promise.allSettled(queryRoots.slice(0, safeMode ? 2 : 8).map((q) => firecrawlSearch(`${q} ${start.getFullYear()} ${end.getFullYear()}`, { limit: safeMode ? 4 : 8, tbs: tbs as "qdr:m" | "qdr:y" }))),
    ]);

    const allPubs = dedupePublications([
      ...focusedPubs,
      ...googleSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
      ...gdeltSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
      ...firecrawlSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
    ]);

    const knownWindows = discovered.map(eventWindow);
    const pubs = allPubs.filter((p) => {
      const date = p.publishedAt ? new Date(p.publishedAt).getTime() : 0;
      const inMainWindow = !!date && (date >= start.getTime() - 86400000 && date <= end.getTime() + 86400000);
      const inKnownWindow = !!date && knownWindows.some((w) => {
        const ws = new Date(`${w.start}T00:00:00Z`).getTime();
        const we = new Date(`${w.end}T23:59:59Z`).getTime();
        return date >= ws && date <= we;
      });
      const text = normalize(`${p.title} ${p.snippet}`);
      const candidateTokens = normalize(candidate.full_name).split(/\s+/).filter((t: string) => t.length >= 4 && !["das", "dos", "de", "da", "do"].includes(t));
      const nameHit = text.includes(normalize(candidate.full_name)) || candidateTokens.filter((t: string) => text.includes(t)).length >= Math.min(2, candidateTokens.length);
      const klass = classifyPub(p);
      const eventHit = klass !== "news" || EVENT_TERMS.some((term) => text.includes(normalize(term)));
      return (inMainWindow || inKnownWindow) && nameHit && eventHit && isOfficialOrJournalistic(p);
    }).slice(0, safeMode ? 120 : 320);
    console.log("[detect-historical-peaks] external search finished — pubs:", pubs.length);

    // === DETECÇÃO PEAK-FIRST ===
    // Busca a timeline SSOT direto do banco (não confia só no que veio do cliente)
    // e detecta picos via z-score + rolling baseline 14d. Picos NÃO dependem de cobertura externa.
    logStage("calculo_baseline", { timeline_points: effectiveTimeline.length });
    const localCandidates = timelineCandidates(effectiveTimeline);

    // === FASE 4: ENRIQUECIMENTO IA — DESABILITADO ===
    const aiEvents: any[] = [];
    console.log("[detect-historical-peaks] ssot fallback finished — localCandidates:", localCandidates.length);
    logStage("deteccao_picos");

    // Picos SSOT são a FONTE PRIMÁRIA. Cobertura externa apenas enriquece.
    const combinedByKey = new Map<string, any>();
    const keyOf = (e: any) => `${String(e.start_date || "").slice(0, 10)}|${normalize(String(e.name || "")).slice(0, 60)}`;
    const dayKey = (e: any) => String(e.start_date || "").slice(0, 10);
    const ssotPeakRaw = ssotPeakEvents(effectiveTimeline);
    for (const sp of ssotPeakRaw) combinedByKey.set(keyOf(sp), sp);
    // Eventos descobertos via news (fase desabilitada) e fallback — apenas se não houver pico SSOT no mesmo dia.
    for (const e of aiEvents) if (!combinedByKey.has(keyOf(e))) combinedByKey.set(keyOf(e), e);
    for (const e of discovered) if (!combinedByKey.has(keyOf(e))) combinedByKey.set(keyOf(e), e);
    let candidateEvents: any[] = [...combinedByKey.values()];
    if (candidateEvents.length === 0) candidateEvents = fallbackEventsFromSources(pubs, start, end);
    // Cap generoso para suportar candidatos de alto volume (Lula, Bolsonaro) — antes era 20.
    candidateEvents = candidateEvents.slice(0, 150);
    console.log("[detect-historical-peaks] clustering finished — candidateEvents:", candidateEvents.length, "ssotPeaks:", ssotPeakRaw.length);
    logStage("classificacao_categoria", { candidate_events: candidateEvents.length });

    const events = candidateEvents.map((evt: any) => {
      const evPubs = matchedSources(evt, pubs, start, end, candidate.full_name);
      const distinctOutlets = new Set(evPubs.map((p) => normalize(p.outlet))).size;
      const day = String(evt.start_date || "").slice(0, 10);
      const counts = countsByClass(evPubs);
      const totalEvidence = evPubs.length;
      // Sentimento exige amostragem mínima de 3 fontes — abaixo disso é estatisticamente irrelevante.
      const sentimentAvailable = totalEvidence >= 5 && distinctOutlets >= 3;
      const sentiment = sentimentAvailable ? aggregateSentiment(evPubs) : { pos: 0, neg: 0, neu: 0 };
      const score = relevanceFromEvidence(evt, evPubs, 0);
      const outletNames = Array.from(new Set(evPubs.map((p) => cleanText(p.outlet)).filter(Boolean))).slice(0, 30);

      // ====== NEW PIPELINE: tier-based confidence, factual category, relevance band ======
      const pipelinePubs = evPubs.map((p) => ({ url: p.url || "", outlet: p.outlet || "" }));
      const conf = pipelineConfidence(pipelinePubs);
      const ssotZ = typeof evt._ssot_z === "number" ? evt._ssot_z : 0;
      const ssotPeak = typeof evt._ssot_peak === "number" ? evt._ssot_peak : 0;
      const newCategory = pipelineCategory(
        evt?.name, evt?.type, evt?.description, evt?.motivo,
        evt?.what_happened, evt?.why_happened, evt?.political_impact, evt?.electoral_impact, evt?.aftermath,
        Array.isArray(evt?.keywords) ? evt.keywords.join(" ") : "",
        Array.isArray(evt?.participants) ? evt.participants.join(" ") : "",
        outletNames.join(" "),
        evPubs.map((p) => `${p.title || ""} ${p.outlet || ""}`).join(" "),
      );
      const politicalImpact =
        newCategory === "stf" || newCategory === "operacoes_pf" || newCategory === "prisoes" ? 1.0 :
        newCategory === "cpi" || newCategory === "tse" || newCategory === "julgamentos" || newCategory === "escandalos" ? 0.8 :
        newCategory === "eleicoes" || newCategory === "debates" ? 0.5 : 0.2;
      const evtEngagement = Number((evt as any)?.internal_engagement ?? (evt as any)?._ssot_engagement ?? 0);
      const relevance = pipelineRelevance({
        mentions: ssotPeak || totalEvidence,
        engagement: evtEngagement,
        durationDays: coverageDurationDays(evPubs),
        independent_strong_sources: conf.independent_strong_sources,
        trusted_sources_count: conf.trusted_sources_count,
        politicalImpact,
      });

      return {
        name: safeSlice(cleanText(evt.name), 200),
        type: cleanText(evt.type || "noticia"),
        keywords: Array.isArray(evt.keywords) ? evt.keywords.map(cleanText).filter(Boolean).slice(0, 10) : [],
        start_date: day || startShort,
        end_date: String(evt.end_date || day || startShort).slice(0, 10),
        description: safeSlice(cleanText(evt.description), 800),
        motivo: safeSlice(cleanText(evt.motivo), 400),
        what_happened: safeSlice(cleanText(evt.what_happened), 1200),
        why_happened: safeSlice(cleanText(evt.why_happened), 1200),
        participants: Array.isArray(evt.participants) ? evt.participants.map(cleanText).filter(Boolean).slice(0, 12) : [],
        political_impact: safeSlice(cleanText(evt.political_impact), 1000),
        electoral_impact: safeSlice(cleanText(evt.electoral_impact), 1000),
        aftermath: safeSlice(cleanText(evt.aftermath), 1200),
        evidence_level: "cobertura_coletada",
        relevance_score: relevance.score,
        relevance_band: relevance.band,
        relevance_breakdown: relevance.breakdown,
        publications_count: totalEvidence,
        distinct_outlets: distinctOutlets,
        coverage_days: coverageDurationDays(evPubs),
        news_count: counts.news,
        videos_count: counts.videos,
        posts_count: counts.posts,
        estimated_volume: 0,
        volume_available: false,
        sentiment_available: sentimentAvailable,
        sentiment_positive: sentiment.pos,
        sentiment_negative: sentiment.neg,
        sentiment_neutral: sentiment.neu,
        outlet_names: outletNames,
        coverage_quality: coverageQuality(totalEvidence, distinctOutlets),
        // NEW: status / category / confidence based on tier-weighted sources
        status: conf.status, // "confirmed" | "probable" | "indeterminate"
        category: newCategory, // 10 official categories
        confidence_score: conf.weight_sum,
        independent_strong_sources: conf.independent_strong_sources,
        trusted_sources_count: conf.trusted_sources_count,
        tier_breakdown: conf.tier_breakdown,
        ssot_z_score: typeof evt._ssot_z === "number" ? evt._ssot_z : null,
        ssot_baseline_volume: typeof evt._ssot_baseline === "number" ? evt._ssot_baseline : null,
        ssot_peak_volume: typeof evt._ssot_peak === "number" ? evt._ssot_peak : null,
        external_score: Math.round(score),
        legacy_score: Math.round(score),
        // Drop tier4-only events (Instagram/TikTok) before display
        _hide_indeterminate: conf.status === "indeterminate" && !(ssotZ >= 4 && ssotPeak >= 100),
        sources: evPubs.map((p) => {
          const c = pipelineClassifySource(p.url || "", p.outlet || "");
          return { name: p.outlet, url: p.url, region: p.outletRegion, publishedAt: p.publishedAt || null, title: cleanText(p.title), kind: classifyPub(p), tier: c.tier, weight: c.weight };
        }),
      };
    }).filter((evt: any) => {
      const eventDate = new Date(`${evt.start_date}T12:00:00Z`).getTime();
      if (Number.isNaN(eventDate)) return false;
      if (eventDate < start.getTime() - 86400000 || eventDate > end.getTime() + 86400000) return false;
      // BLOQUEIO ESTRITO DE DATAS FUTURAS — nenhum pico pode ocorrer depois de hoje.
      if (eventDate > Date.now()) return false;
      if (!evt.name || !evt.description) return false;
      // Bloqueia eventos de campanha rotineira (comício, agenda, visita etc.) — mantido por design.
      const normType = normalize(String(evt.type || "")).replace(/[^a-z_]/g, "");
      if (BLOCKED_EVENT_TYPES.test(normType)) return false;
      if (BLOCKED_NAME_TERMS.test(evt.name)) return false;
      // NEW: drop indeterminate events without a strong spike — eliminates noise/hallucination candidates.
      if (evt._hide_indeterminate) return false;
      return true;
    }).sort((a: any, b: any) => (b.relevance_score || 0) - (a.relevance_score || 0)).slice(0, 120);

    const timelineMap = new Map<string, { date: string; total: number; news: number; videos: number; posts: number }>();
    for (const p of pubs) {
      if (!p.publishedAt) continue;
      const d = p.publishedAt.slice(0, 10);
      const bucket = timelineMap.get(d) || { date: d, total: 0, news: 0, videos: 0, posts: 0 };
      bucket.total++;
      const k = classifyPub(p);
      if (k === "video") bucket.videos++; else if (k === "post") bucket.posts++; else bucket.news++;
      timelineMap.set(d, bucket);
    }
    const externalTimeline = [...timelineMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    // === FASE 4: ENRIQUECIMENTO COM SSOT (social_interactions) ===
    // Para cada pico, busca repercussão real observada nas 16 redes monitoradas,
    // em janela de ±7 dias ao redor do evento. NÃO substitui Google News/GDELT/scores externos.
    logStage("enriquecimento_ssot", { events: events.length, safe_mode: safeMode });
    const correlationLimit = safeMode ? SAFE_CORRELATION_LIMIT : Math.min(NORMAL_CORRELATION_LIMIT, MAX_AI_RECORDS);
    const eventsForCorrelation = timedOut() ? [] : events.slice(0, correlationLimit);
    if (timedOut()) console.error("[detect-historical-peaks] timeout before SSOT enrichment; returning peaks without correlation");
    const correlations = await Promise.allSettled(eventsForCorrelation.map(async (ev: any) => {
      const startMs = new Date(`${ev.start_date}T00:00:00Z`).getTime() - 7 * 86400000;
      const endMs   = new Date(`${ev.end_date || ev.start_date}T23:59:59Z`).getTime() + 7 * 86400000;
      const { data, error } = await admin.rpc("event_ssot_correlation", {
        p_candidate_id: candidate.id,
        p_start: new Date(startMs).toISOString(),
        p_end:   new Date(endMs).toISOString(),
      });
      if (error) { console.warn("[detect-historical-peaks] ssot rpc:", error.message); return null; }
      return data as { total_mentions: number; unique_authors: number; total_engagement: number; by_network: Record<string, number> } | null;
    }));

    // Classifica fontes externas em STRONG (jornalismo / órgãos oficiais / GDELT)
    // vs WEAK (redes sociais externas). Instagram/Facebook/TikTok/Threads sozinhos
    // NÃO contam como evidência jornalística.
    const WEAK_HOSTS = /(^|\.)(instagram\.com|facebook\.com|m\.facebook\.com|fb\.com|tiktok\.com|threads\.net|threads\.com|x\.com|twitter\.com|t\.me|telegram\.me|reddit\.com|pinterest\.com|bsky\.app|mastodon\.|truthsocial\.com)$/i;
    const STRONG_OFFICIAL = /(^|\.)(stf\.jus\.br|tse\.jus\.br|senado\.leg\.br|camara\.leg\.br|gov\.br|planalto\.gov\.br|mpf\.mp\.br|pf\.gov\.br|tcu\.gov\.br)$/i;
    function hostOf(url: string): string {
      try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
    }
    function classifySource(s: { url?: string; kind?: string; name?: string }): "strong" | "weak" {
      const host = hostOf(s.url || "");
      if (!host) return "weak";
      if (STRONG_OFFICIAL.test(host)) return "strong";
      if (WEAK_HOSTS.test(host)) return "weak";
      // GDELT, identifyOutlet-tagged outlets e quaisquer veículos jornalísticos restantes → strong
      return "strong";
    }

    // Remove fontes/URLs externas da resposta — manter usuário dentro da plataforma.
    const sanitizedEventsRaw = events.map((e: any, i: number) => {
      const { sources: _omit, ...rest } = e;
      const srcList: any[] = Array.isArray(_omit) ? _omit : [];
      let strong_sources = 0, weak_sources = 0;
      const strongHosts = new Set<string>(), weakHosts = new Set<string>();
      for (const s of srcList) {
        const h = hostOf(s.url || "");
        if (classifySource(s) === "strong") { strong_sources++; if (h) strongHosts.add(h); }
        else { weak_sources++; if (h) weakHosts.add(h); }
      }
      const c = correlations[i]?.status === "fulfilled" ? (correlations[i] as any).value : null;
      const internal_mentions = Number(c?.total_mentions ?? 0);
      const internal_authors = Number(c?.unique_authors ?? 0);
      const internal_engagement = Number(c?.total_engagement ?? 0);
      const external_evidence_count = Number(e.publications_count ?? 0);
      const has_strong_external = strong_sources >= 1 && strongHosts.size >= 1;
      const has_external_evidence = external_evidence_count >= 1 && Number(e.distinct_outlets ?? 0) >= 1;
      const has_internal_evidence = internal_mentions >= 1;
      const has_real_evidence = has_external_evidence || has_internal_evidence;
      const ai_only = !has_external_evidence;
      const description = e.description && e.description.length > 0
        ? e.description
        : (ai_only
            ? "Pico detectado por volume anômalo nas redes monitoradas. Não houve cobertura jornalística suficiente para identificar a causa exata."
            : e.description);
      return {
        ...rest,
        description,
        sources_count: srcList.length,
        strong_sources,
        weak_sources,
        strong_outlets: strongHosts.size,
        internal_mentions,
        internal_mentions_count: internal_mentions,
        internal_authors,
        internal_engagement,
        internal_by_network: (c?.by_network ?? {}) as Record<string, number>,
        internal_window_days: 14,
        has_external_evidence,
        has_strong_external,
        has_internal_evidence,
        has_real_evidence,
        external_evidence_count,
        is_ai_synthetic: !has_real_evidence,
      };
    });

    // === HARD VALIDATION — apenas picos com relevância política real ===
    // Regra (produto): suprimir microvariações estatísticas irrelevantes.
    // - EXTERNAL_CONFIRMED: aceita com cobertura externa (≥1 publicação + ≥1 veículo).
    // - INTERNAL_TREND: só aceita se o volume absoluto, autores únicos, engajamento
    //   e desvio estatístico forem todos altos o suficiente para representar repercussão real.
    // Picos sem nenhuma evidência são descartados como sintéticos.
    let discarded_synthetic = 0;
    let discarded_insufficient_evidence = 0;
    let discarded_low_relevance = 0;
    let externalPeaks = 0;
    let ssotPeaks = 0;
    const total_detected = sanitizedEventsRaw.length;

    // Calcula o score de relevância política (0-100) e o tipo de pico.
    logStage("scoring_relevancia", { total_detected });
    const scored = sanitizedEventsRaw.map((ev: any) => {
      const mentions = Number(ev.internal_mentions_count ?? 0);
      const authors = Number(ev.internal_authors ?? 0);
      const engagement = Number(ev.internal_engagement ?? 0);
      const z = Number(ev.ssot_z_score ?? 0);
      const baseline = Number(ev.ssot_baseline_volume ?? 0);
      const peakVolume = Number(ev.ssot_peak_volume ?? mentions);
      const externalEv = Number(ev.external_evidence_count ?? 0);
      const networks = ev.internal_by_network ? Object.values(ev.internal_by_network).filter((v: any) => Number(v) > 0).length : 0;

      const strongSources = Number(ev.strong_sources ?? 0);
      const weakSources = Number(ev.weak_sources ?? 0);
      const publications = Number(ev.external_evidence_count ?? 0);
      const activeNetworks = networks;

      // Novo modelo de relevância (0–100), calibrado para evitar inflação.
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
      const externalEvidenceScore = clamp(strongSources * 12 + weakSources * 2, 0, 40);
      const coverageScore = Math.min(25, publications * 3);
      const networkScore = Math.min(20, activeNetworks * 2);
      const volumeScore = clamp(Math.log10(Math.max(1, mentions)) * 8, 0, 25);
      const engagementScore = clamp(Math.log10(Math.max(1, engagement)) * 3, 0, 15);
      const politicalRelevance = Math.round(
        clamp(externalEvidenceScore + coverageScore + networkScore + volumeScore + engagementScore, 0, 100),
      );
      const peakScore = politicalRelevance * Math.log10(Math.max(10, mentions));

      // Classificação do tipo de pico — Instagram/Facebook/TikTok sozinhos NÃO são jornalismo.
      const hasStrongExternal = strongSources >= 1;
      const hasOnlyWeakExternal = !hasStrongExternal && weakSources >= 1;
      const isExternalConfirmed = hasStrongExternal;
      const isExternalSocialOnly = hasOnlyWeakExternal;
      const meetsInternalHardFloor =
        z >= 3.5 &&
        mentions >= Math.max(500, baseline * 3) &&
        authors >= 100 &&
        engagement >= 50000 &&
        peakVolume >= 500;

      return { ev, mentions, politicalRelevance, peakScore, isExternalConfirmed, isExternalSocialOnly, meetsInternalHardFloor };
    });

    const sanitizedEvents = scored.filter(({ ev, mentions, politicalRelevance, peakScore, isExternalConfirmed, isExternalSocialOnly, meetsInternalHardFloor }) => {
      const hasAnyEvidence = ev.external_evidence_count >= 1 || ev.internal_mentions_count >= 1 || Number(ev.ssot_z_score ?? 0) >= 2;
      if (!hasAnyEvidence) ev.is_ai_synthetic = true;

      let valid = false;
      let discard_reason: string | null = null;
      if (!hasAnyEvidence) {
        discard_reason = "no_evidence_ai_synthetic";
      } else if (isExternalConfirmed) {
        valid = true;
        ev.peak_type = "external_confirmed";
        ev.detected_by = "external";
      } else if (isExternalSocialOnly && politicalRelevance >= 40) {
        valid = true;
        ev.peak_type = "external_social";
        ev.detected_by = "external_social";
      } else if (meetsInternalHardFloor && politicalRelevance >= 60) {
        valid = true;
        ev.peak_type = "internal_trend";
        ev.detected_by = "internal_ssot";
      } else {
        discard_reason = !meetsInternalHardFloor ? "below_internal_hard_floor" : "below_political_relevance";
      }

      ev.political_relevance = politicalRelevance;
      ev.peak_score = Math.round(peakScore);
      if (valid) {
        if (ev.peak_type === "external_confirmed") externalPeaks++;
        else ssotPeaks++;
      }

      console.log(JSON.stringify({
        tag: "peak_audit",
        name: ev.name,
        date: ev.start_date,
        z_score: ev.ssot_z_score,
        baseline_volume: ev.ssot_baseline_volume,
        peak_volume: ev.ssot_peak_volume,
        internal_mentions: ev.internal_mentions_count,
        internal_authors: ev.internal_authors,
        internal_engagement: ev.internal_engagement,
        external_evidence_count: ev.external_evidence_count,
        political_relevance: politicalRelevance,
        peak_score: ev.peak_score,
        peak_type: ev.peak_type ?? null,
        discard_reason,
      }));

      if (!valid) {
        if (ev.is_ai_synthetic) discarded_synthetic++;
        else if (discard_reason === "below_political_relevance" || discard_reason === "below_internal_hard_floor") discarded_low_relevance++;
        else discarded_insufficient_evidence++;
        return false;
      }
      return true;
    })
    .map(({ ev }) => ev)
    .sort((a: any, b: any) => (b.peak_score || 0) - (a.peak_score || 0));

    console.log(JSON.stringify({
      tag: "peak_summary",
      total_detected,
      externalPeaks,
      ssotPeaks,
      finalPeaks: sanitizedEvents.length,
      discarded_synthetic,
      discarded_insufficient_evidence,
      discarded_low_relevance,
    }));

    // === FASE 5: ANÁLISE IA — DESABILITADA NA DETECÇÃO ===
    // A análise textual de cada pico é executada sob demanda (botão "Análise IA do pico"),
    // nunca dentro deste pipeline, para evitar timeouts e impedir invenção de fatos.
    logStage("chamada_ia", { safe_mode: safeMode, timed_out: timedOut(), max_ai_records: MAX_AI_RECORDS });
    console.log("[detect-historical-peaks] ai enrichment skipped (deferred to on-demand)");
    for (const ev of sanitizedEvents as any[]) {
      ev.analysis_source = ev.has_external_evidence ? "external_evidence" : "internal_ssot";
      if (safeMode || timedOut()) {
        ev.analysis_status = "safe_mode_keyword_summary";
        ev.analysis = safeAnalysisFromKeywords(ev);
      } else {
        ev.analysis_status = cleanText(ev.what_happened) ? "success" : "pending_on_demand";
        ev.analysis = cleanText(ev.what_happened)
          ? { cause: safeSlice(cleanText(ev.what_happened), 240), confidence: Math.min(80, Number(ev.political_relevance ?? 0)) }
          : { cause: "Análise indisponível", confidence: 0 };
      }
    }
    console.log("[detect-historical-peaks] ai enrichment finished");

    logStage("retorno_final", { final_peaks: sanitizedEvents.length });
    const response = new Response(JSON.stringify({
      success: true,
      events: sanitizedEvents,
      total_detected,
      valid_peaks: sanitizedEvents.length,
      discarded_synthetic,
      discarded_insufficient_evidence,
      externalPeaks,
      ssotPeaks,
      publications_collected: pubs.length,
      discovered_count: discovered.length,
      estimated_reach: estimatedReachOf(pubs),
      external_timeline: externalTimeline,
      safe_mode: safeMode,
      timed_out: timedOut(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    console.log("[detect-historical-peaks] response sent");
    console.timeEnd("detect-historical-peaks");
    return response;

  } catch (error) {
    const err = error as Error;
    console.error("[detect-historical-peaks] fatal:", { stage, message: err?.message, stack: err?.stack });
    try { console.timeEnd("detect-historical-peaks"); } catch { /* noop */ }
    return new Response(JSON.stringify({
      success: false,
      stage,
      error: err?.message || String(error),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});