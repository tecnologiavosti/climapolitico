// IA histórica para "Picos de Menções": descobre acontecimentos políticos reais
// cruzando imprensa, vídeos, decisões, eleições e a série local de menções.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { firecrawlSearch, dedupePublications, estimatedReachOf, type ExternalPublication } from "../_shared/external-collector.ts";
import { buildContextualQueries } from "../_shared/politician-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TimelinePoint = { date: string; count: number; isPeak?: boolean };

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

function meetsCoverageThreshold(counts: { news: number; videos: number; posts: number }, totalEvidence: number, distinctOutlets: number): boolean {
  // Regras de validação solicitadas:
  // 3 notícias OU 2 notícias + vídeo OU 2 notícias + posts OU 10 evidências totais.
  // Sempre exigir ao menos 2 veículos distintos — um pico não pode vir de uma única fonte.
  if (distinctOutlets < 2) return false;
  if (counts.news >= 3) return true;
  if (counts.news >= 2 && counts.videos >= 1) return true;
  if (counts.news >= 2 && counts.posts >= 1) return true;
  if (totalEvidence >= 10) return true;
  return false;
}

function relevanceFromEvidence(evt: any, pubs: ExternalPublication[], _mentions: number): number {
  const distinctOutlets = new Set(pubs.map((p) => normalize(p.outlet))).size;
  const reach = pubs.reduce((sum, p) => sum + (p.outletReach || 3), 0);
  const counts = countsByClass(pubs);
  const diversity = (counts.news > 0 ? 1 : 0) + (counts.videos > 0 ? 1 : 0) + (counts.posts > 0 ? 1 : 0);
  const officialBonus = pubs.some((p) => /\.(gov|jus|leg)\.br|gov\.br|tse\.jus\.br|stf\.jus\.br|senado\.leg\.br|camara\.leg\.br/i.test(hostNameOf(p.url))) ? 10 : 0;
  const score = Math.min(36, distinctOutlets * 7)        // diversidade de veículos
    + Math.min(22, pubs.length * 1.6)                     // volume total
    + Math.min(12, counts.news * 2)                       // notícias
    + Math.min(8, counts.videos * 3)                      // vídeos
    + Math.min(8, counts.posts * 2)                       // posts
    + Math.min(10, reach * 1.2)                           // alcance
    + Math.min(10, coverageDurationDays(pubs) * 1.5)      // persistência temporal
    + diversity * 4                                       // diversidade de tipos
    + politicalImpactWeight(String(evt?.type || evt?.name || ""))
    + officialBonus;
  return Math.max(30, Math.min(100, Math.round(score)));
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
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { candidateId, startDate, endDate, localTimeline = [] } = await req.json();
    if (!candidateId || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: "candidateId, startDate e endDate são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate, true);
    const startShort = start.toISOString().slice(0, 10);
    const endShort = end.toISOString().slice(0, 10);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: candidate } = await admin.from("candidates").select("id, full_name, party, user_id").eq("id", candidateId).maybeSingle();
    if (!candidate || candidate.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === FASE 1: DESCOBERTA HISTÓRICA (antes de qualquer busca) ===
    // A IA enumera os acontecimentos políticos conhecidos do candidato no período,
    // garantindo cobertura de prisão, impeachment, debates, CPIs, decisões do STF, BRICS etc.
    const discovered = await discoverKnownEvents(candidate.full_name, candidate.party, startShort, endShort);
    console.log(`[detect-historical-peaks] discovered ${discovered.length} known events`);

    // === FASE 2: COBERTURA DIRECIONADA POR EVENTO CONHECIDO ===
    const focusedSettled = await Promise.allSettled(
      discovered.slice(0, 40).map((evt) => fetchCoverageForKnownEvent(evt, candidate.full_name)),
    );
    const focusedPubs = focusedSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []);

    // === FASE 3: COLETA AMPLA (descobre eventos adicionais não previstos pela IA) ===
    const contextual = buildContextualQueries(candidate.full_name, 6);
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
    ])).slice(0, days > 370 ? 32 : 22);

    const tbs = days <= 31 ? "qdr:m" : "qdr:y";
    const [googleSettled, gdeltSettled, firecrawlSettled] = await Promise.all([
      Promise.allSettled(queryRoots.map((q) => fetchGoogleHistorical(q, startShort, endShort, 15))),
      Promise.allSettled(queryRoots.slice(0, 12).map((q) => fetchGdeltHistorical(q, start, end, 40))),
      Promise.allSettled(queryRoots.slice(0, 8).map((q) => firecrawlSearch(`${q} ${start.getFullYear()} ${end.getFullYear()}`, { limit: 8, tbs: tbs as "qdr:m" | "qdr:y" }))),
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
    }).slice(0, 320);

    const localCandidates = timelineCandidates(Array.isArray(localTimeline) ? localTimeline : []);

    // === FASE 4: ENRIQUECIMENTO E DESCOBERTA COMPLEMENTAR PELA IA ===
    let aiEvents: any[] = [];
    if (pubs.length > 0 || discovered.length > 0) {
      const corpus = pubs.slice(0, 110).map((p, i) =>
        `[${i + 1}] (${p.outlet}, ${p.publishedAt?.slice(0, 10) || "?"}, ${p.source}) ${cleanText(p.title).slice(0, 180)} — ${cleanText(p.snippet).slice(0, 220)} | ${p.url}`
      ).join("\n");
      const localSignal = localCandidates.map((p: any) => `${p.date}: ${p.count} menções (${Math.round(p.growth || 0)}%)`).join("\n") || "sem sinal interno relevante";
      const knownList = discovered.map((e, i) => `${i + 1}. [${e.start_date}] ${e.name} — ${cleanText(e.description || "").slice(0, 160)}`).join("\n") || "nenhum evento pré-identificado";

      const prompt = `Você é um analista político histórico brasileiro. Confirme, enriqueça e COMPLEMENTE a lista de acontecimentos de ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ""} entre ${startShort} e ${endShort}.

EVENTOS HISTÓRICOS PRÉ-IDENTIFICADOS (mantenha todos os reais, ajuste datas/descrições conforme as fontes, descarte apenas se forem claramente falsos):
${knownList}

PUBLICAÇÕES EXTERNAS COLETADAS:
${corpus || "sem publicações externas"}

SINAIS INTERNOS DE CRESCIMENTO:
${localSignal}

INSTRUÇÕES:
- Retorne TODOS os eventos pré-identificados que tenham confirmação histórica, múltiplas fontes confiáveis conhecidas e data coerente, mesmo que a cobertura coletada agora seja parcial ou vazia — use seu conhecimento histórico para preencher descrição, impacto e participantes.
- ADICIONE eventos novos encontrados nas publicações que não estavam na lista.
- Para cada evento, indique sourceIndices (1-based) das publicações que documentam o fato. Se nenhuma publicação coletada cobrir o evento, devolva [] em sourceIndices — não invente índices.
- Priorize relevância histórica e institucional, não volume bruto.
- Mire em 20+ eventos quando o período cobrir um ciclo eleitoral ou mandato.

Responda APENAS JSON válido:
{
  "events": [
    {
      "name": "...",
      "type": "eleicao|debate|entrevista|discurso|coletiva|decisao_judicial|cpi|operacao|votacao|agenda|impeachment|posse|julgamento|prisao|noticia",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "description": "...",
      "motivo": "...",
      "what_happened": "...",
      "why_happened": "...",
      "participants": ["..."],
      "political_impact": "...",
      "electoral_impact": "...",
      "aftermath": "...",
      "keywords": ["..."],
      "sourceIndices": [1,2],
      "relevance_score": 0
    }
  ]
}`;
      try {
        const ai = await callAICerebrasFirst({
          systemMsg: "Você detecta acontecimentos políticos reais cruzando conhecimento histórico e fontes documentadas. Responda só JSON em pt-BR.",
          userPrompt: prompt,
          jsonMode: true,
          maxTokens: 8000,
          temperature: 0.15,
          tag: "detect-historical-peaks-enrich",
        });
        const content = ai.content || "";
        let parsed: any = {};
        try { parsed = JSON.parse(content); }
        catch { const m = content.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
        aiEvents = Array.isArray(parsed?.events) ? parsed.events : [];
      } catch (error) {
        console.error("[detect-historical-peaks] enrich AI failed", (error as Error).message);
      }
    }

    // Combina eventos da IA enriquecida + descobertos não cobertos.
    const combinedByKey = new Map<string, any>();
    const keyOf = (e: any) => `${String(e.start_date || "").slice(0, 10)}|${normalize(String(e.name || "")).slice(0, 60)}`;
    for (const e of aiEvents) combinedByKey.set(keyOf(e), e);
    for (const e of discovered) if (!combinedByKey.has(keyOf(e))) combinedByKey.set(keyOf(e), e);
    let candidateEvents: any[] = [...combinedByKey.values()];
    if (candidateEvents.length === 0) candidateEvents = fallbackEventsFromSources(pubs, start, end);

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
        relevance_score: Math.round(score),
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
        sources: evPubs.map((p) => ({ name: p.outlet, url: p.url, region: p.outletRegion, publishedAt: p.publishedAt || null, title: cleanText(p.title), kind: classifyPub(p) })),
      };
    }).filter((evt: any) => {
      const eventDate = new Date(`${evt.start_date}T12:00:00Z`).getTime();
      if (Number.isNaN(eventDate)) return false;
      if (eventDate < start.getTime() - 86400000 || eventDate > end.getTime() + 86400000) return false;
      if (!evt.name || !evt.description) return false;
      // Bloqueia eventos de campanha rotineira (comício, agenda, visita etc.).
      const normType = normalize(String(evt.type || "")).replace(/[^a-z_]/g, "");
      if (BLOCKED_EVENT_TYPES.test(normType)) return false;
      if (BLOCKED_NAME_TERMS.test(evt.name)) return false;
      // Pico só existe com repercussão real.
      return meetsCoverageThreshold(
        { news: evt.news_count, videos: evt.videos_count, posts: evt.posts_count },
        evt.publications_count,
        evt.distinct_outlets,
      );
    }).sort((a: any, b: any) => (b.relevance_score || 0) - (a.relevance_score || 0)).slice(0, 40);

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
    const correlations = await Promise.allSettled(events.map(async (ev: any) => {
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

    // Remove fontes/URLs externas da resposta — manter usuário dentro da plataforma.
    const sanitizedEvents = events.map((e: any, i: number) => {
      const { sources: _omit, ...rest } = e;
      const c = correlations[i].status === "fulfilled" ? (correlations[i] as any).value : null;
      return {
        ...rest,
        sources_count: Array.isArray(_omit) ? _omit.length : 0,
        internal_mentions:   Number(c?.total_mentions   ?? 0),
        internal_authors:    Number(c?.unique_authors   ?? 0),
        internal_engagement: Number(c?.total_engagement ?? 0),
        internal_by_network: (c?.by_network ?? {}) as Record<string, number>,
        internal_window_days: 14,
      };
    });

    return new Response(JSON.stringify({
      events: sanitizedEvents,
      publications_collected: pubs.length,
      discovered_count: discovered.length,
      estimated_reach: estimatedReachOf(pubs),
      external_timeline: externalTimeline,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("[detect-historical-peaks]", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});