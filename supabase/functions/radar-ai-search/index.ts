// Edge Function: radar-ai-search
// Híbrido: RSS em tempo real + IA (agrupa, deduplica, classifica). Sem pipeline, sem cron.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_MODELS = ["gpt-oss-120b", "zai-glm-4.7"];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];

interface ReqBody {
  candidate_id?: string | null;
  candidate_name: string;
  start_date: string;
  end_date: string;
  categories?: string[];
  force_refresh?: boolean;
  /** Pular IA por chunk (modo heurístico). Usado pelo job em background para evitar rate-limit. */
  skip_ai?: boolean;
}

interface RawItem {
  title: string;
  url: string;
  source: string;
  type: "institutional" | "news" | "international" | "aggregator";
  pub_date?: string;
  snippet?: string;
  bucket?: string;
  domain?: string;
}

// ===== 50+ FONTES EXTERNAS =====
const FEEDS: Array<{ name: string; url: string; type: RawItem["type"] }> = [
  // Institucionais
  { name: "Agência Senado", url: "https://www12.senado.leg.br/noticias/ultimas/feed", type: "institutional" },
  { name: "Câmara Notícias", url: "https://www.camara.leg.br/noticias/rss/ultimas", type: "institutional" },
  { name: "STF Notícias", url: "https://noticias.stf.jus.br/postsnoticias/feed/", type: "institutional" },
  { name: "TSE Notícias", url: "https://www.tse.jus.br/comunicacao/noticias/rss-noticias", type: "institutional" },
  { name: "STJ Notícias", url: "https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias.aspx?rss=true", type: "institutional" },
  { name: "Planalto", url: "https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/RSS", type: "institutional" },
  { name: "Agência Brasil Política", url: "https://agenciabrasil.ebc.com.br/rss/politica/feed.xml", type: "institutional" },
  { name: "CGU", url: "https://www.gov.br/cgu/pt-br/assuntos/noticias/RSS", type: "institutional" },
  { name: "TCU", url: "https://portal.tcu.gov.br/imprensa/noticias/rss.htm", type: "institutional" },
  { name: "PF", url: "https://www.gov.br/pf/pt-br/assuntos/noticias/RSS", type: "institutional" },
  { name: "AGU", url: "https://www.gov.br/agu/pt-br/comunicacao/noticias/RSS", type: "institutional" },
  { name: "Ministério da Justiça", url: "https://www.gov.br/mj/pt-br/assuntos/noticias/RSS", type: "institutional" },
  { name: "CNJ", url: "https://www.cnj.jus.br/feed/", type: "institutional" },
  { name: "Banco Central", url: "https://www.bcb.gov.br/api/feed/sitebcb/noticias", type: "institutional" },
  // Notícias Brasil
  { name: "G1 Política", url: "https://g1.globo.com/rss/g1/politica/", type: "news" },
  { name: "Folha Poder", url: "https://feeds.folha.uol.com.br/poder/rss091.xml", type: "news" },
  { name: "Estadão Política", url: "https://politica.estadao.com.br/rss.xml", type: "news" },
  { name: "UOL Política", url: "https://rss.uol.com.br/feed/politica.xml", type: "news" },
  { name: "CNN Brasil Política", url: "https://www.cnnbrasil.com.br/politica/feed/", type: "news" },
  { name: "Poder360", url: "https://www.poder360.com.br/feed/", type: "news" },
  { name: "Metrópoles Política", url: "https://www.metropoles.com/brasil/politica/feed", type: "news" },
  { name: "CartaCapital", url: "https://www.cartacapital.com.br/feed/", type: "news" },
  { name: "JOTA", url: "https://www.jota.info/feed", type: "news" },
  { name: "Congresso em Foco", url: "https://congressoemfoco.uol.com.br/feed/", type: "news" },
  { name: "Veja", url: "https://veja.abril.com.br/feed/", type: "news" },
  { name: "Exame Brasil", url: "https://exame.com/brasil/feed/", type: "news" },
  { name: "Valor Político", url: "https://valor.globo.com/politica/rss/", type: "news" },
  { name: "InfoMoney Política", url: "https://www.infomoney.com.br/politica/feed/", type: "news" },
  { name: "Terra Política", url: "https://www.terra.com.br/rss/0,,EI8177,00.xml", type: "news" },
  { name: "Nexo", url: "https://www.nexojornal.com.br/rss", type: "news" },
  { name: "Crusoé", url: "https://crusoe.com.br/feed/", type: "news" },
  { name: "Correio Braziliense Política", url: "https://www.correiobraziliense.com.br/rss/politica.xml", type: "news" },
  { name: "R7 Política", url: "https://noticias.r7.com/feed/politica", type: "news" },
  { name: "Band Política", url: "https://www.band.uol.com.br/rss/politica.xml", type: "news" },
  { name: "IstoÉ Política", url: "https://istoe.com.br/categoria/politica/feed/", type: "news" },
  { name: "O Globo Política", url: "https://oglobo.globo.com/rss/politica", type: "news" },
  // Internacional
  { name: "BBC Brasil", url: "https://feeds.bbci.co.uk/portuguese/rss.xml", type: "international" },
  { name: "DW Brasil", url: "https://rss.dw.com/atom/rss-br-all", type: "international" },
  { name: "Reuters World", url: "https://feeds.reuters.com/Reuters/worldNews", type: "international" },
  { name: "AP World", url: "https://feeds.apnews.com/rss/apf-topnews", type: "international" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss", type: "international" },
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", type: "international" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", type: "international" },
  // Agregadores (Google News com query do candidato é injetado em runtime)
];

function hashPeriod(b: ReqBody): string {
  const cats = [...(b.categories ?? [])].sort().join(",");
  // v5: bumped to invalidate any cache built with the 2024+ historical bug.
  return `radar-v5|${b.candidate_id ?? "all"}|${b.candidate_name}|${b.start_date}|${b.end_date}|${cats}`;
}

function safeNum(v: any, def = 0, min = 0, max = 100) {
  const n = Number(v);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INSTITUTIONAL_RE = /\b(STF|TSE|PF|Senado|Câmara|Camara|Planalto|STJ|TCU|CGU|AGU|CNJ|Banco Central|Ministério|Ministerio)\b/i;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_RUNTIME = 120_000;
const CACHE_BATCH_SIZE = 200;
const POLITICAL_RELEVANCE_RE = /\b(STF|TSE|PF|Polícia Federal|operacao|operação|escandalo|escândalo|crise|CPI|investigacao|investigação|cassacao|cassação|julgamento|denuncia|denúncia|impeachment|prisao|prisão|inelegivel|inelegível|corrupcao|corrupção|votacao|votação|congresso|senado|camara|câmara|plenario|plenário|supremo|tribunal|eleicao|eleição|eleitoral|presidencial|pesquisa|Datafolha|Quaest|Ipec|PoderData|reforma tributaria|reforma fiscal|orcamento|orçamento|economia|banco central|dolar|dólar|juros|crime eleitoral|rachadinha|joias|minuta|golpe|8 de janeiro|delacao|delação|inquerito|inquérito)\b/i;
const STRONG_IMPACT_RE = /\b(operação|operacao|PF|STF|TSE|CPI|cassação|cassacao|julgamento|denúncia|denuncia|investigação|investigacao|impeachment|prisão|prisao|corrupção|corrupcao|inelegível|inelegivel|condenação|condenacao|busca e apreensão|busca e apreensao|quebra de sigilo|réu|reu|indiciado|indiciamento|delacao|delação|golpe|8 de janeiro)\b/i;
const CRITICAL_IMPACT_RE = /\b(prisão|prisao|condenação|condenacao|cassação|cassacao|impeachment|inelegível|inelegivel|operação PF|operação da PF|busca e apreensão|corrupção|corrupcao|golpe|8 de janeiro|STF decide|TSE condena)\b/i;
const SPORTS_NOISE_RE = /\b(palpite|futebol|copa do mundo|copa america|copa américa|brasileirao|brasileirão|libertadores|cartola|aposta|odds|seleção brasileira|selecao brasileira|jogo de hoje)\b/i;
const ROUTINE_NOISE_RE = /\b(agenda|visita|visita rotineira|cumpre agenda|participa de encontro|reunião protocolar|reuniao protocolar|inaugura|inauguração|inauguracao|agenda de campanha|caminhada|carreata|comício local|comicio local)\b/i;
const BANNED_TRIVIAL_RE = /\b(entrevista exclusiva|bate-papo|podcast|live com|comentário sobre copa|comentario sobre copa|palpite de)\b/i;

function sourceTypeFromName(name: string): RawItem["type"] {
  return INSTITUTIONAL_RE.test(name) ? "institutional" : "news";
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`);
  if (isNaN(start) || isNaN(end)) return 30;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

function targetRange(startDate: string, endDate: string): string {
  const days = daysBetween(startDate, endDate);
  if (days <= 8) return "5-30 eventos";
  if (days <= 35) return "20-80 eventos";
  if (days <= 370) return "300-1000 eventos por ano para nomes de alta cobertura";
  return "300-1000 eventos por ano, distribuídos uniformemente por ano e mês";
}

function expectedMinimumEvents(candidateName: string, startDate: string, endDate: string): number {
  const years = Math.max(daysBetween(startDate, endDate) / 365, 7 / 365);
  const n = normalize(candidateName);
  const yearly = n.includes("lula") || n.includes("luiz inacio") ? 300 : n.includes("jair") || (n.includes("bolsonaro") && !n.includes("flavio")) ? 400 : n.includes("flavio") ? 150 : 120;
  return Math.max(10, Math.min(1200, Math.floor(yearly * years * 0.55)));
}

function monthBuckets(startDate: string, endDate: string): Array<{ key: string; start: string; end: string; label: string }> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
  const buckets: Array<{ key: string; start: string; end: string; label: string }> = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end && buckets.length < 120) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const bucketStart = new Date(Math.max(start.getTime(), Date.UTC(y, m, 1)));
    const bucketEnd = new Date(Math.min(end.getTime(), Date.UTC(y, m + 1, 0, 23, 59, 59)));
    buckets.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      start: bucketStart.toISOString().slice(0, 10),
      end: bucketEnd.toISOString().slice(0, 10),
      label: `${String(m + 1).padStart(2, "0")}/${y}`,
    });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return buckets;
}

function sampledBuckets(startDate: string, endDate: string): Array<{ key: string; start: string; end: string; label: string }> {
  const buckets = monthBuckets(startDate, endDate);
  if (buckets.length <= 18) return buckets;
  const yearly = new Map<string, typeof buckets>();
  for (const b of buckets) {
    const year = b.key.slice(0, 4);
    if (!yearly.has(year)) yearly.set(year, []);
    yearly.get(year)!.push(b);
  }
  const sampled: typeof buckets = [];
  for (const [, list] of yearly) {
    const picks = list.length <= 4 ? list : [list[0], list[Math.floor(list.length / 3)], list[Math.floor((list.length * 2) / 3)], list[list.length - 1]];
    for (const p of picks) if (!sampled.some((x) => x.key === p.key)) sampled.push(p);
  }
  return sampled.slice(0, 12).sort((a, b) => a.key.localeCompare(b.key));
}

function domainFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== TEXT SANITIZER (encoding + smart quotes + control chars) =====
function sanitizeRadarText(input: unknown): string {
  if (input == null) return "";
  let s = String(input);
  // Remove control characters (incl. DEL and C1)
  s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
  // Remove zero-width and BOM
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
  // Smart quotes / dashes / bullets / nbsp
  const map: Record<string, string> = {
    "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'",
    "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"',
    "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-",
    "\u2022": "-", "\u2023": "-", "\u25E6": "-", "\u2043": "-",
    "\u00A0": " ", "\u202F": " ", "\u2009": " ", "\u200A": " ",
    "\u2026": "...",
  };
  s = s.replace(/[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2013\u2014\u2015\u2212\u2022\u2023\u25E6\u2043\u00A0\u202F\u2009\u200A\u2026]/g, (c) => map[c] ?? c);
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ===== RSS PARSING =====
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : "";
}

function pickLink(block: string): string {
  // RSS <link>...</link> or Atom <link href="..."/>
  const linkText = pickTag(block, "link");
  if (linkText && linkText.startsWith("http")) return linkText;
  const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : linkText;
}

function parseFeed(xml: string, source: string, type: RawItem["type"]): RawItem[] {
  const items: RawItem[] = [];
  const itemRe = /<(item|entry)[\s\S]*?<\/(item|entry)>/gi;
  const blocks = xml.match(itemRe) ?? [];
  for (const block of blocks) {
    const title = pickTag(block, "title");
    if (!title) continue;
    const url = pickLink(block);
    const pub = pickTag(block, "pubDate") || pickTag(block, "published") || pickTag(block, "updated");
    const desc = pickTag(block, "description") || pickTag(block, "summary") || pickTag(block, "content");
    items.push({
      title: title.slice(0, 400),
      url: url.slice(0, 800),
      source,
      type,
      pub_date: pub || undefined,
      snippet: desc ? desc.slice(0, 600) : undefined,
    });
  }
  return items;
}

async function fetchFeed(name: string, url: string, type: RawItem["type"], bucket?: string): Promise<RawItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPoliticoRadar/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml, name, type).map((item) => ({ ...item, bucket, domain: domainFromUrl(item.url) }));
  } catch {
    return [];
  }
}

// ===== CANDIDATE MATCHING (aliases + fuzzy) =====
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAliases(fullName: string): string[] {
  const norm = normalize(fullName);
  const weakTokens = new Set(["silva", "santos", "souza", "costa", "oliveira", "pereira", "alves", "ferreira", "lima"]);
  const parts = norm.split(" ").filter((p) => p.length >= 3 && !weakTokens.has(p));
  const aliases = new Set<string>([norm]);
  const compact = norm.replace(/\s+/g, " ");
  if (parts.length >= 2) {
    aliases.add(`${parts[0]} ${parts[parts.length - 1]}`); // first + last
    if (parts[parts.length - 1].length >= 6) aliases.add(parts[parts.length - 1]); // last name only when distinctive
  }
  if (parts[0]) aliases.add(parts[0]);
  if (compact.includes("flavio") && compact.includes("bolsonaro")) {
    ["flavio bolsonaro", "flávio bolsonaro", "senador flavio bolsonaro", "senador flávio bolsonaro", "flavio nantes bolsonaro", "flávio nantes bolsonaro"].forEach((a) => aliases.add(normalize(a)));
  }
  if (compact.includes("lula") || compact.includes("luiz inacio")) {
    ["lula", "luiz inacio lula da silva", "luiz inácio lula da silva", "presidente lula"].forEach((a) => aliases.add(normalize(a)));
  }
  if (compact.includes("bolsonaro") && !compact.includes("flavio")) {
    ["jair bolsonaro", "ex presidente bolsonaro", "presidente bolsonaro", "bolsonaro"].forEach((a) => aliases.add(normalize(a)));
  }
  return Array.from(aliases).filter((a) => a.length >= 4);
}

function similarity(a: string, b: string): number {
  const aa = normalize(a);
  const bb = normalize(b);
  if (!aa || !bb) return 0;
  if (aa.includes(bb) || bb.includes(aa)) return 1;
  const aTokens = new Set(aa.split(" ").filter((x) => x.length >= 3));
  const bTokens = new Set(bb.split(" ").filter((x) => x.length >= 3));
  const intersection = [...aTokens].filter((x) => bTokens.has(x)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  const tokenScore = intersection / union;
  let prefixMatches = 0;
  for (const at of aTokens) {
    if ([...bTokens].some((bt) => at.startsWith(bt) || bt.startsWith(at))) prefixMatches++;
  }
  return Math.max(tokenScore, prefixMatches / Math.max(1, aTokens.size));
}

function matchesCandidate(item: RawItem, aliases: string[]): boolean {
  const hay = normalize(`${item.title} ${item.snippet ?? ""}`);
  return aliases.some((a) => hay.includes(a) || similarity(a, hay) > 0.75);
}

function eventMatchesCandidate(event: any, aliases: string[]): boolean {
  const hay = normalize(`${event.title ?? ""} ${event.summary ?? ""} ${(event.entities ?? []).join(" ")}`);
  return aliases.some((a) => hay.includes(a) || similarity(a, hay) > 0.75);
}

function isRelevantPoliticalText(text: string): boolean {
  const clean = sanitizeRadarText(text);
  if (!clean || SPORTS_NOISE_RE.test(clean) || BANNED_TRIVIAL_RE.test(clean)) return false;
  if (ROUTINE_NOISE_RE.test(clean) && !POLITICAL_RELEVANCE_RE.test(clean)) return false;
  return POLITICAL_RELEVANCE_RE.test(clean) || STRONG_IMPACT_RE.test(clean);
}

function categoryForText(text: string, sourceTypes: string[] = []): string {
  if (/\b(PF|Polícia Federal|operação|operacao|prisão|prisao|busca e apreensão|busca e apreensao)\b/i.test(text)) return "PF";
  if (/\b(STF|Supremo|julgamento|inquérito|inquerito|réu|reu)\b/i.test(text)) return "STF";
  if (/\b(TSE|eleição|eleicao|inelegível|inelegivel|cassação|cassacao|pesquisa eleitoral)\b/i.test(text)) return "TSE";
  if (/\b(CPI|Senado|Câmara|Camara|Congresso|votação|votacao)\b/i.test(text)) return "Congresso";
  if (/\b(economia|Banco Central|dólar|dolar|juros|inflação|inflacao|arcabouço|arcabouco)\b/i.test(text)) return "Economia";
  if (/\b(escândalo|escandalo|denúncia|denuncia|corrupção|corrupcao|crise)\b/i.test(text)) return "Escândalos";
  if (sourceTypes.includes("international")) return "Internacional";
  return "Outros";
}

function sourceWeight(name: string, type?: string): number {
  if (type === "institutional" || INSTITUTIONAL_RE.test(name)) return 1.0;
  if (/\b(Reuters|Bloomberg|Financial Times|BBC|AP|NYT|Valor|Estadão|Folha|Globo|G1|UOL|CNN|JOTA|Poder360|Metrópoles|Agência Brasil)\b/i.test(name)) return 0.85;
  if (type === "international") return 0.75;
  if (type === "aggregator" || /Google News/i.test(name)) return 0.45;
  return 0.6;
}

function scoreEvent(e: any): { importance: number; social_score: number; institutional_sources: number; source_count: number } {
  const sources = Array.isArray(e.sources) ? e.sources : [];
  const source_count = Math.max(1, sources.length || safeNum(e.source_count, 1, 1, 999));
  const institutional_sources = sources.filter((s: any) => s?.type === "institutional" || INSTITUTIONAL_RE.test(String(s?.name ?? ""))).length;
  const text = `${e.title ?? ""} ${e.summary ?? ""} ${e.political_impact ?? ""}`;
  const mediaWeight = Math.min(10, sources.reduce((sum: number, s: any) => sum + sourceWeight(String(s?.name ?? ""), s?.type), 0));
  const impactScore = CRITICAL_IMPACT_RE.test(text) ? 1 : STRONG_IMPACT_RE.test(text) ? 0.75 : POLITICAL_RELEVANCE_RE.test(text) ? 0.45 : 0.2;
  const social_relevance = Math.min(100, 18 + source_count * 7 + institutional_sources * 12 + mediaWeight * 4 + impactScore * 35);
  const raw = source_count * 2 + institutional_sources * 12 + mediaWeight * 8 + social_relevance * 0.3 + impactScore * 20;
  return {
    importance: safeNum(raw, 0),
    social_score: safeNum(social_relevance, 0),
    institutional_sources,
    source_count,
  };
}

// Dedupe MUITO mais conservador: só remove duplicatas quase idênticas no MESMO mês.
// O(n): Map por mês + título normalizado para evitar travar em alto volume.
function dedupeEvents(events: any[]): any[] {
  const seen = new Map<string, any>();
  for (const ev of events) {
    const month = (ev.event_date ?? "").slice(0, 7) || "unknown";
    const key = normalize(`${ev.title ?? ""}`).split(" ").filter((t) => t.length > 3).slice(0, 10).join(" ");
    if (!key) continue;
    const mapKey = `${month}|${key}`;
    const prev = seen.get(mapKey);
    if (!prev || (ev.importance ?? 0) > (prev.importance ?? 0)) {
      if (prev) ev.sources = [...(ev.sources ?? []), ...(prev.sources ?? [])].slice(0, 25);
      seen.set(mapKey, ev);
    }
  }
  return [...seen.values()].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
}

// Cluster O(n): buckets por mês/dia/título. Nunca compara todos com todos.
function clusterEvents(events: any[]): any[] {
  const clusters = new Map<string, any>();
  const sorted = [...events].filter((e) => e?.event_date).sort((a, b) => Date.parse(a.event_date) - Date.parse(b.event_date));
  for (const ev of sorted) {
    const evMonth = (ev.event_date ?? "").slice(0, 7);
    const dayBucket = Math.floor(Date.parse(ev.event_date) / (2 * 86_400_000));
    const titleKey = normalize(ev.title ?? "").split(" ").filter((t) => t.length > 3).slice(0, 8).join(" ");
    const key = `${evMonth}|${dayBucket}|${titleKey}`;
    const match = clusters.get(key);
    if (!match) {
      clusters.set(key, { ...ev, sources: [...(ev.sources ?? [])] });
      continue;
    }
    const sourceMap = new Map<string, any>();
    for (const s of [...(match.sources ?? []), ...(ev.sources ?? [])]) sourceMap.set(`${s.name}|${s.url}`, s);
    match.sources = [...sourceMap.values()].slice(0, 25);
    if ((ev.summary ?? "").length > (match.summary ?? "").length) match.summary = ev.summary;
    if ((ev.importance ?? 0) > (match.importance ?? 0)) match.title = ev.title;
    const score = scoreEvent(match);
    match.source_count = score.source_count;
    match.institutional_sources = score.institutional_sources;
    match.social_score = score.social_score;
    match.importance = Math.max(score.importance, match.importance ?? 0, ev.importance ?? 0);
  }
  return [...clusters.values()];
}

function inDateRange(item: RawItem, startMs: number, endMs: number): boolean {
  if (!item.pub_date) return true; // keep if unknown — AI will discard
  const t = Date.parse(item.pub_date);
  if (isNaN(t)) return true;
  return t >= startMs && t <= endMs;
}

// ===== AI normalization =====
function extractText(provider: string, data: any): string {
  if (provider === "gemini") {
    return data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

function normalizeEvents(raw: any[]): any[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((e) => e && typeof e.title === "string" && e.title.length > 3)
    .map((e, i) => {
      const sources = Array.isArray(e.sources)
        ? e.sources
            .map((s: any) => {
              if (typeof s === "string") return { name: s, url: "", type: sourceTypeFromName(s) };
              return { name: String(s?.name ?? s?.source ?? "Fonte"), url: String(s?.url ?? ""), type: s?.type ?? sourceTypeFromName(String(s?.name ?? "")) };
            })
            .filter((s: any) => s.name)
        : [];
      const event_date = e.event_date ?? e.date ?? null;
      const score = scoreEvent({ ...e, sources });
      const text = `${e.title ?? ""} ${e.summary ?? ""} ${e.political_impact ?? ""}`;
      return {
        id: e.id ?? `${Date.now()}-${i}`,
        title: sanitizeRadarText(e.title).slice(0, 280),
        summary: sanitizeRadarText(e.summary ?? "").slice(0, 1500),
        category: sanitizeRadarText(e.category && e.category !== "Institucional" ? e.category : categoryForText(text, sources.map((s: any) => s.type))),
        event_date,
        source_count: score.source_count,
        institutional_sources: score.institutional_sources,
        social_score: score.social_score,
        importance: score.importance,
        political_impact: e.political_impact ? sanitizeRadarText(e.political_impact).slice(0, 600) : "",
        entities: Array.isArray(e.entities) ? e.entities.slice(0, 10).map((x: any) => sanitizeRadarText(x).slice(0, 80)) : [],
        sources: sources.slice(0, 25).map((s: any) => ({
          name: sanitizeRadarText(s.name).slice(0, 120),
          url: String(s.url ?? "").slice(0, 600),
          type: s.type ?? "news",
        })),
      };
    })
    .filter((e) => isRelevantPoliticalText(`${e.title} ${e.summary} ${e.category}`))
    .sort((a, b) => {
      const ta = a.event_date ? Date.parse(a.event_date) : 0;
      const tb = b.event_date ? Date.parse(b.event_date) : 0;
      return tb - ta;
    });
}

// ===== TEMPORAL DIVERSITY: distribuição equilibrada por mês/ano sem inventar datas =====
function applyTemporalDiversity(events: any[], maxPerDay = 30): any[] {
  if (events.length === 0) return events;
  const deduped = dedupeEvents(events).filter((ev) => ev.event_date && !isNaN(Date.parse(ev.event_date)));
  const byDay = new Map<string, any[]>();
  for (const ev of deduped) {
    const day = (ev.event_date ?? "").slice(0, 10) || "unknown";
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(ev);
  }
  const capped: any[] = [];
  for (const [, list] of byDay) {
    list.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    capped.push(...list.slice(0, maxPerDay));
  }
  const byMonth = new Map<string, any[]>();
  for (const ev of capped) {
    const m = (ev.event_date ?? "").slice(0, 7) || "unknown";
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(ev);
  }
  const monthLimit = Math.max(80, Math.ceil(capped.length / Math.max(1, byMonth.size)) + 40);
  const balanced: any[] = [];
  for (const [, list] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    balanced.push(...list.slice(0, monthLimit));
  }
  balanced.sort((a, b) => {
    const ta = a.event_date ? Date.parse(a.event_date) : 0;
    const tb = b.event_date ? Date.parse(b.event_date) : 0;
    return tb - ta;
  });
  return balanced;
}

function parseAiJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // continua para tentar objeto
      }
    }
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return { events: [] };
      }
    }
    return { events: [] };
  }
}

function buildRssFallbackEvents(items: RawItem[], candidateName: string, aliases: string[], startMs: number, endMs: number): any[] {
  const primary = items.filter((it) => matchesCandidate(it, aliases) && inDateRange(it, startMs, endMs) && isRelevantPoliticalText(`${it.title} ${it.snippet ?? ""}`));
  const relaxed = primary.length > 0 ? primary : items.filter((it) => matchesCandidate(it, aliases) && isRelevantPoliticalText(`${it.title} ${it.snippet ?? ""}`));
  const seen = new Set<string>();
  return relaxed
    .filter((it) => {
      const key = normalize(it.url || it.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 200)
    .map((it, i) => {
      const text = `${it.title} ${it.snippet ?? ""}`;
      const sources = [{ name: sanitizeRadarText(it.source), url: it.url, type: it.type }];
      const score = scoreEvent({ title: it.title, summary: it.snippet, sources });
      return {
        id: `rss-fallback-${Date.now()}-${i}`,
        title: sanitizeRadarText(it.title),
        summary: sanitizeRadarText(it.snippet || `Evento político público envolvendo ${candidateName}, detectado automaticamente em fonte externa.`),
        category: categoryForText(text, [it.type]),
        event_date: it.pub_date && !isNaN(Date.parse(it.pub_date)) ? new Date(it.pub_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        source_count: score.source_count,
        institutional_sources: score.institutional_sources,
        social_score: score.social_score,
        importance: score.importance,
        political_impact: score.importance >= 70 ? "Evento com alto impacto político detectado em fonte pública." : "Evento político detectado em fonte pública.",
        entities: [candidateName, sanitizeRadarText(it.source)],
        sources,
      };
    });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  console.time("TOTAL_RADAR");
  const started = Date.now();
  const watchdog = (stage: string) => {
    if (Date.now() - started > MAX_RUNTIME) throw new Error(`RADAR_TIMEOUT:${stage}`);
  };
  const endTotal = () => {
    try { console.timeEnd("TOTAL_RADAR"); } catch { /* noop */ }
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "missing_auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CEREBRAS_KEY = Deno.env.get("CEREBRAS_API_KEY");
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!CEREBRAS_KEY && !GROQ_KEY && !GEMINI_KEY) {
      console.warn("[RADAR-AI] nenhum provedor de IA configurado; fallback RSS será usado");
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "invalid_auth" }, 401);
    const userId = userData.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const body = (await req.json().catch(() => null)) as ReqBody | null;
    if (!body?.candidate_name || !body?.start_date || !body?.end_date) {
      return jsonResponse({ error: "campos obrigatórios: candidate_name, start_date, end_date" }, 400);
    }
    const safeBody = body;

    const period_hash = hashPeriod(safeBody);
    const startMs = Date.parse(safeBody.start_date + "T00:00:00Z");
    const endMs = Date.parse(safeBody.end_date + "T23:59:59Z");

    console.log("LOG 1: candidate_name =", body.candidate_name);
    console.log("LOG 2: period =", { start_date: body.start_date, end_date: body.end_date, force_refresh: !!body.force_refresh });

    // Cache lookup (2h) — Atualizar sempre bypassa pelo force_refresh
    watchdog("CACHE_LOOKUP");
    if (!body.force_refresh) {
      const { data: cached } = await admin
        .from("radar_cache")
        .select("response_json,expires_at,event_count,created_at")
        .eq("user_id", userId)
        .eq("period_hash", period_hash)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      const cachedEvents = Array.isArray(cached?.response_json) ? cached.response_json : [];
      if (cachedEvents.length > 0) {
        console.timeEnd("TOTAL_RADAR");
        return jsonResponse({
          events: cachedEvents,
          cached: true,
          cached_at: cached?.created_at,
          count: cachedEvents.length,
        });
      }
      if (cached?.response_json) console.log("Skipping empty cache");
    } else {
      console.log("[RADAR] force_refresh=true: ignorando cache e rodando IA novamente");
    }

    // ===== 1. FETCH RSS EM PARALELO + BUSCAS TEMPORAIS =====
    const aliases = buildAliases(body.candidate_name);
    const buckets = sampledBuckets(body.start_date, body.end_date);
    const expectedMin = expectedMinimumEvents(body.candidate_name, body.start_date, body.end_date);
    const relevanceTerms = `(STF OR TSE OR PF OR CPI OR investigação OR julgamento OR denúncia OR escândalo OR corrupção OR votação OR economia)`;
    const temporalQueries = buckets.flatMap((bucket) => {
      const after = `after:${bucket.start}`;
      const before = `before:${bucket.end}`;
      const base = `"${body.candidate_name}" ${after} ${before}`;
      return [
        { q: `${base} política ${relevanceTerms}`, label: `Google News política ${bucket.label}` },
      ];
    });
    // Cap total feeds aggressively to stay within edge-runtime CPU/memory limits.
    // Top institutional + top news feeds only (first ~18), plus up to 12 temporal queries.
    const baseFeeds = FEEDS.slice(0, 18).map((f) => ({ ...f, bucket: "live" }));
    const dynamicFeeds = [
      ...baseFeeds,
      ...temporalQueries.slice(0, 12).map((query) => ({
        name: query.label,
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(query.q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
        type: "aggregator" as const,
        bucket: query.label.match(/(\d{2}\/\d{4})/)?.[1] ?? "temporal",
      })),
    ];

    const t0 = Date.now();
    // Batched fetches (max 10 concurrent) to limit memory peak.
    const allItems: RawItem[] = [];
    watchdog("FETCH");
    console.time("FETCH");
    for (let i = 0; i < dynamicFeeds.length; i += 10) {
      const batch = dynamicFeeds.slice(i, i + 10);
      const results = await Promise.all(batch.map((f) => fetchFeed(f.name, f.url, f.type, f.bucket)));
      for (const arr of results) allItems.push(...arr);
    }
    console.timeEnd("FETCH");
    const fetchMs = Date.now() - t0;

    watchdog("CHUNK_PROCESSING");
    console.time("CHUNK_PROCESSING");
    // Filtrar por candidato + período
    const filtered = allItems.filter((it) => matchesCandidate(it, aliases) && inDateRange(it, startMs, endMs) && isRelevantPoliticalText(`${it.title} ${it.snippet ?? ""}`));
    console.timeEnd("CHUNK_PROCESSING");

    watchdog("DEDUPE");
    console.time("DEDUPE");
    // Dedup por URL
    const seen = new Set<string>();
    const unique = filtered.filter((it) => {
      const k = it.url || it.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    console.timeEnd("DEDUPE");

    console.log(`[RADAR] ${body.candidate_name}: ${allItems.length} brutos, ${unique.length} filtrados, ${buckets.length} janelas em ${fetchMs}ms`);

    // ===== 2. PROMPT IA =====
    const catFilter =
      body.categories && body.categories.length > 0 && !body.categories.includes("Todos")
        ? `Filtrar APENAS para as categorias: ${body.categories.join(", ")}.`
        : "Cobrir todas as categorias políticas.";

    const systemPrompt = `Você é um motor de political intelligence. Responda somente com JSON válido, sem markdown.`;

    const sourcesPayload = unique.slice(0, 220).map((it) => ({
      title: it.title,
      url: it.url,
      source: it.source,
      type: it.type,
      date: it.pub_date ?? null,
      bucket: it.bucket ?? null,
      snippet: it.snippet?.slice(0, 160) ?? "",
    }));

    const userPrompt = `Você é um motor de political intelligence histórico.

OBJETIVO:
Retorne acontecimentos políticos REAIS envolvendo "${body.candidate_name}" ocorridos ESTRITAMENTE entre ${body.start_date} e ${body.end_date}.

REGRAS CRÍTICAS DE DATA (não negociáveis):
- TODO event_date DEVE estar entre ${body.start_date} e ${body.end_date} (inclusive). Eventos fora dessa janela são INVÁLIDOS e devem ser descartados.
- NÃO priorize notícias recentes. NÃO use conhecimento geral genérico.
- Considere APENAS eventos documentados historicamente, com data verificável.
- Se o período inclui anos antigos (2010-2023), use seu conhecimento histórico documentado. NÃO restrinja a 2024+.
- Distribua eventos por TODOS os meses do período, não concentre em datas recentes.

FONTES PREFERIDAS (cite quando souber):
STF, TSE, Senado, Câmara, PF, CGU, TCU, Planalto, G1, Folha, Estadão, UOL, CNN Brasil, Reuters, Poder360, Metrópoles, BBC Brasil, JOTA, Congresso em Foco, O Globo, Valor, Exame, CartaCapital, Veja.

VOLUME ESPERADO:
- Mínimo absoluto: 20-50 eventos por chunk de 30 dias quando houver cobertura pública.
- Meta operacional total deste candidato/período: ${expectedMin} eventos.
- Faixa esperada: ${targetRange(body.start_date, body.end_date)}.

Janelas mensais amostradas para cobertura uniforme:
${JSON.stringify(buckets)}
${catFilter}

PRIORIZAR (eventos com peso político real):
crises, escândalos, operações da PF, julgamentos do STF/TSE, votações relevantes, denúncias formais, processos, investigações, CPIs, decisões judiciais, cassações, inelegibilidade, prisão, condenação, corrupção, delações, debates eleitorais, embates institucionais, nomeações e exonerações de impacto, movimentações partidárias significativas, declarações com repercussão nacional, atos do Executivo, decisões econômicas com impacto político (BC, juros, reforma).

IGNORAR:
palpite esportivo, futebol, Copa, apostas; entrevista banal sem consequência política; visita rotineira, agenda comum, cerimônia protocolar; comentário sem impacto institucional ou eleitoral.

Notícias brutas coletadas via RSS (${sourcesPayload.length} itens — pode estar vazio para períodos antigos; nesse caso USE conhecimento histórico documentado):
${JSON.stringify(sourcesPayload)}

Retorne JSON neste formato:
{"events":[
{
"title":"",
"summary":"",
"date":"YYYY-MM-DD",
"event_date":"YYYY-MM-DD",
"category":"",
"sources":[{"name":"","url":"","type":"institutional|news|international|aggregator"}],
"importance":0,
"social_score":0,
"political_impact":"",
"entities":[""]
}
]}

SCORING:
importance = (source_count * 2) + (institutional_sources * 12) + (media_weight * 8) + (social_relevance * 0.3) + (impact_score * 20), clamp 0-100. NUNCA use valor fixo.
social_score deve variar conforme cobertura pública real. Nunca use default 35.

VALIDAÇÃO FINAL (faça antes de responder):
1. Cada event_date está entre ${body.start_date} e ${body.end_date}? Se não, REMOVA.
2. Cobriu múltiplos meses do período? Se o período tem >1 mês e tudo caiu em 1 mês, REVISE.
3. Para períodos antigos (anteriores a 2024), você retornou eventos históricos REAIS daquele ano?`;

    console.log("LOG 3: prompt enviado =", userPrompt);

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    async function callOpenAICompat(provider: "cerebras" | "groq", model: string, key: string) {
      const res = await fetch(provider === "cerebras" ? CEREBRAS_URL : GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: provider === "cerebras" ? 8192 : 6144,
        }),
        signal: AbortSignal.timeout(provider === "cerebras" ? 40_000 : 35_000),
      });
      const raw = await res.text();
      return { ok: res.ok, status: res.status, raw, provider, model };
    }

    async function callGemini(model: string, key: string) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(40_000),
        },
      );
      const raw = await res.text();
      return { ok: res.ok, status: res.status, raw, provider: "gemini", model };
    }

    const attempts: Array<() => Promise<{ ok: boolean; status: number; raw: string; provider: string; model: string }>> = [];
    if (CEREBRAS_KEY) CEREBRAS_MODELS.forEach((m) => attempts.push(() => callOpenAICompat("cerebras", m, CEREBRAS_KEY)));
    if (GROQ_KEY) GROQ_MODELS.forEach((m) => attempts.push(() => callOpenAICompat("groq", m, GROQ_KEY)));
    if (GEMINI_KEY) GEMINI_MODELS.forEach((m) => attempts.push(() => callGemini(m, GEMINI_KEY)));

    let text = "{}";
    let usedProvider = "none";
    let lastFailure = "";
    let rawAiResponse = "";
    for (const attempt of attempts) {
      try {
        const result = await attempt();
        rawAiResponse = result.raw;
        if (!result.ok) {
          lastFailure = `${result.provider}:${result.model} HTTP ${result.status} ${result.raw.slice(0, 200)}`;
          console.warn(`[RADAR-AI] ${lastFailure}`);
          if (result.status === 429 || result.status === 402) await sleep(900);
          continue;
        }
        const data = JSON.parse(result.raw);
        text = extractText(result.provider, data) || "{}";
        usedProvider = `${result.provider}:${result.model}`;
        break;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        console.warn(`[RADAR-AI] provider failed: ${lastFailure}`);
      }
    }

    async function saveCache(nonEmptyEvents: any[]) {
      if (nonEmptyEvents.length === 0) {
        console.log("Skipping empty cache");
        return;
      }
      watchdog("CACHE_SAVE");
      console.time("CACHE_SAVE");
      for (let i = 0; i < nonEmptyEvents.length; i += CACHE_BATCH_SIZE) {
        console.log("CACHE_SAVE batch", i, Math.min(i + CACHE_BATCH_SIZE, nonEmptyEvents.length), "of", nonEmptyEvents.length);
      }
      await admin.from("radar_cache").upsert(
        {
          user_id: userId,
          candidate_id: safeBody.candidate_id ?? null,
          candidate_name: safeBody.candidate_name,
          period_hash,
          start_date: safeBody.start_date,
          end_date: safeBody.end_date,
          categories: safeBody.categories ?? [],
          response_json: nonEmptyEvents,
          event_count: nonEmptyEvents.length,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
        },
        { onConflict: "user_id,period_hash" },
      );
      console.timeEnd("CACHE_SAVE");
    }

    async function returnRssFallback(reason: string, statusWhenEmpty = 502) {
      console.warn(`[RADAR] fallback RSS acionado: ${reason}`);
      const fallbackRaw = buildRssFallbackEvents(allItems, safeBody.candidate_name, aliases, startMs, endMs);
      const fallbackEvents = applyTemporalDiversity(fallbackRaw, 30);
      console.log("LOG 6: eventos após filtro =", { fallback: true, count: fallbackEvents.length, sample: fallbackEvents.slice(0, 3) });
      if (fallbackEvents.length === 0) {
        console.log("Skipping empty cache");
        endTotal();
        return jsonResponse({
          error: "AI returned 0 events",
          message: "A IA falhou e o fallback RSS não encontrou notícias públicas para este candidato/período.",
          detail: reason,
          stack: `radar-ai-search > ${reason}`,
          fallback: true,
          events: [],
          cached: false,
          count: 0,
          raw_items: unique.length,
        }, statusWhenEmpty);
      }
      await saveCache(fallbackEvents);
      endTotal();
      return jsonResponse({
        events: fallbackEvents,
        cached: false,
        count: fallbackEvents.length,
        provider: "rss_fallback",
        fallback: true,
        message: "IA indisponível; eventos criados automaticamente via RSS público.",
        raw_items: unique.length,
        sources_fetched: dynamicFeeds.length,
        fetch_ms: fetchMs,
      });
    }

    if (usedProvider === "none") {
      return await returnRssFallback(`ai_unavailable: ${lastFailure.slice(0, 300)}`);
    }

    console.log("LOG 4: resposta bruta da IA =", rawAiResponse.slice(0, 4000));

    watchdog("SCORING");
    console.time("SCORING");
    const parsed = parseAiJson(text);

    const parsedEvents = normalizeEvents(parsed.events ?? parsed);
    console.log("LOG 5: eventos parseados =", { count: parsedEvents.length, sample: parsedEvents.slice(0, 3) });
    if (parsedEvents.length === 0) {
      console.error("AI returned 0 events");
      console.timeEnd("SCORING");
      return await returnRssFallback("AI returned 0 events");
    }

    const candidateFiltered = parsedEvents.filter((event) => eventMatchesCandidate(event, aliases));
    const filteredEvents = candidateFiltered.length > 0 ? candidateFiltered : parsedEvents;
    let events = applyTemporalDiversity(clusterEvents(filteredEvents), 30);
    const rssFallbackRaw = buildRssFallbackEvents(allItems, safeBody.candidate_name, aliases, startMs, endMs);
    if (events.length < Math.min(expectedMin, 100) && rssFallbackRaw.length > 0) {
      console.warn(`[RADAR] IA abaixo da meta (${events.length}/${expectedMin}); mesclando evidências RSS temporais`);
      events = applyTemporalDiversity(clusterEvents([...events, ...rssFallbackRaw]), 30);
    }
    console.timeEnd("SCORING");
    console.log("LOG 6: eventos após filtro =", { count: events.length, expectedMin, before_diversity: filteredEvents.length, rss_candidates: rssFallbackRaw.length, sample: events.slice(0, 3) });

    // Logs históricos obrigatórios
    const dateList = events.map((e: any) => e.event_date).filter((d: string) => d && !isNaN(Date.parse(d))).sort();
    console.log("RADAR RANGE", safeBody.start_date, safeBody.end_date);
    console.log("EVENTS FOUND", events.length);
    console.log("OLDEST EVENT", dateList[0] ?? "n/a", "| NEWEST EVENT", dateList[dateList.length - 1] ?? "n/a");

    if (events.length === 0) {
      console.error("AI returned 0 events");
      return await returnRssFallback("AI returned 0 events after candidate filter");
    }

    // Cache 2h — nunca salvar cache vazio
    await saveCache(events);

    endTotal();
    return jsonResponse({
      events,
      cached: false,
      count: events.length,
      provider: usedProvider,
      raw_items: unique.length,
      sources_fetched: dynamicFeeds.length,
      fetch_ms: fetchMs,
    });
  } catch (e) {
    console.error("[RADAR-AI] erro inesperado", e);
    endTotal();
    return jsonResponse({
      error: "radar_failed",
      message: "O Radar Político não conseguiu concluir a busca agora. Tente novamente em instantes.",
      detail: (e as Error).message,
      fallback: true,
      events: [],
      cached: false,
      count: 0,
    });
  }
});
