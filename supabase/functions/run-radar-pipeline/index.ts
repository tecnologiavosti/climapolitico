// run-radar-pipeline (v2)
// ============================================================================
// Pipeline de eventos políticos reais via fontes externas.
// Mudanças v2:
//   - Aliases por candidato (não só full_name)
//   - Múltiplas queries por candidato (alias + alias+contexto)
//   - Blocklist de esporte/trivial ANTES da IA (token-saver + zero ruído)
//   - Single-source aceito se vier de domínio institucional/grande imprensa
//   - Filtro de relevância IA: descarta se relevance < 30
//   - lookback até 365 dias
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const UA = "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0; +https://climapolitico.com.br)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS_PER_FEED = 100;
const DEFAULT_LOOKBACK_DAYS = 30;

const CATEGORIES = [
  "Eleições","STF","TSE","PF","CPI","Congresso","Executivo","Economia",
  "Escândalo","Prisão","Julgamento","Internacional","Outros",
];

const INSTITUTIONAL_DOMAINS = [
  "stf.jus.br","tse.jus.br","stj.jus.br","senado.leg.br","camara.leg.br","gov.br",
  "pf.gov.br","cgu.gov.br","tcu.gov.br","justica.gov.br","planalto.gov.br",
  "agenciabrasil.ebc.com.br","bcb.gov.br","receita.fazenda.gov.br","agu.gov.br",
  "cnj.jus.br","in.gov.br",
];
const MAJOR_NEWS_DOMAINS = [
  // Brasil — grandes jornais/TV
  "g1.globo.com","globo.com","oglobo.globo.com","globonews.globo.com","valor.globo.com",
  "uol.com.br","noticias.uol.com.br","folha.uol.com.br","band.uol.com.br",
  "estadao.com.br","cnnbrasil.com.br","r7.com","terra.com.br","sbtnews.sbt.com.br",
  "recordtv.r7.com","jovempan.com.br",
  // Política / bastidores
  "poder360.com.br","metropoles.com","congressoemfoco.uol.com.br","jota.info",
  "nexojornal.com.br","cartacapital.com.br","veja.abril.com.br","exame.com",
  "infomoney.com.br","correiobraziliense.com.br","gazetadopovo.com.br",
  "istoe.com.br","brasil247.com","diariodocentrodomundo.com.br",
  "oantagonista.com.br","crusoe.com.br",
  // Economia / mercado
  "moneytimes.com.br","br.investing.com","suno.com.br","neofeed.com.br",
  "braziljournal.com","trademap.com.br",
  // Internacional
  "bbc.com","ft.com","bloomberg.com","apnews.com","brasil.elpais.com",
  "dw.com","aljazeera.com","theguardian.com","nytimes.com","reuters.com",
];

// Blocklist (esporte / trivial)
const BLOCK_KEYWORDS = [
  "gol","seleção brasileira","copa","copa do mundo","libertadores","champions",
  "ancelotti","neymar","vini jr","vinicius jr","real madrid","palmeiras","flamengo",
  "corinthians","são paulo fc","santos fc","brasil x","jogo do brasil","placar",
  "futebol","aniversário","parabéns","novela","bbb","big brother","cantora",
  "morre cantor","morre ator","horóscopo","celebridade","fofoca","romance",
];

// Aliases por candidato (chave = nome normalizado lowercase sem acentos)
const ALIAS_MAP: Record<string, string[]> = {
  "luiz inacio lula da silva": ["Lula", "presidente Lula", "governo Lula", "Luiz Inácio Lula da Silva"],
  "lula": ["Lula", "presidente Lula", "governo Lula"],
  "jair bolsonaro": ["Jair Bolsonaro", "Bolsonaro", "ex-presidente Bolsonaro"],
  "bolsonaro": ["Jair Bolsonaro", "Bolsonaro", "ex-presidente Bolsonaro"],
  "flavio bolsonaro": ["Flávio Bolsonaro", "senador Flávio Bolsonaro"],
  "flávio bolsonaro": ["Flávio Bolsonaro", "senador Flávio Bolsonaro"],
  "eduardo bolsonaro": ["Eduardo Bolsonaro", "deputado Eduardo Bolsonaro"],
  "tarcisio de freitas": ["Tarcísio de Freitas", "governador Tarcísio"],
  "tarcísio de freitas": ["Tarcísio de Freitas", "governador Tarcísio"],
  "tarcisio": ["Tarcísio de Freitas", "governador Tarcísio"],
  "ratinho junior": ["Ratinho Junior", "governador do Paraná Ratinho"],
  "ronaldo caiado": ["Ronaldo Caiado", "governador Caiado"],
  "ciro gomes": ["Ciro Gomes"],
  "lindbergh farias": ["Lindbergh Farias"],
  "nikolas ferreira": ["Nikolas Ferreira"],
  "michelle bolsonaro": ["Michelle Bolsonaro"],
  "geraldo alckmin": ["Geraldo Alckmin", "vice-presidente Alckmin"],
  "fernando haddad": ["Fernando Haddad", "ministro Haddad"],
  "simone tebet": ["Simone Tebet", "ministra Tebet"],
  "pacheco": ["Rodrigo Pacheco"],
  "lira": ["Arthur Lira"],
};

// Contextual role keywords — disparam match mesmo SEM o nome do candidato no título.
// Devem ser específicos o suficiente para evitar falso positivo (ex.: "governo" sozinho não basta).
const ROLE_MAP: Record<string, string[]> = {
  "lula": ["planalto","palacio do planalto","palácio do planalto","governo lula","presidente da republica","presidente da república","executivo federal","presidencia da republica","presidência da república"],
  "luiz inacio lula da silva": ["planalto","palacio do planalto","palácio do planalto","governo lula","presidente da republica","presidente da república","executivo federal"],
  "jair bolsonaro": ["ex-presidente","clã bolsonaro","cla bolsonaro","bolsonarismo","pl de bolsonaro","inelegivel","inelegível"],
  "bolsonaro": ["ex-presidente","clã bolsonaro","cla bolsonaro","bolsonarismo","inelegivel","inelegível"],
  "flavio bolsonaro": ["senador flavio","senador flávio","filho de bolsonaro","rachadinha","caso queiroz","gabinete do senador"],
  "flávio bolsonaro": ["senador flavio","senador flávio","filho de bolsonaro","rachadinha","caso queiroz"],
  "eduardo bolsonaro": ["deputado eduardo","filho de bolsonaro","03"],
  "tarcisio de freitas": ["governador de sao paulo","governador de são paulo","palacio dos bandeirantes","palácio dos bandeirantes","governo de sp"],
  "tarcísio de freitas": ["governador de são paulo","palácio dos bandeirantes","governo de sp"],
  "tarcisio": ["governador de são paulo","palácio dos bandeirantes","governo de sp"],
  "ratinho junior": ["governador do parana","governador do paraná","palacio iguacu","palácio iguaçu"],
  "ronaldo caiado": ["governador de goias","governador de goiás","palacio das esmeraldas","palácio das esmeraldas"],
  "geraldo alckmin": ["vice-presidente","mdic","ministerio do desenvolvimento","ministério do desenvolvimento"],
  "fernando haddad": ["ministro da fazenda","ministerio da fazenda","ministério da fazenda","equipe economica","equipe econômica"],
  "simone tebet": ["ministra do planejamento","ministerio do planejamento","ministério do planejamento"],
  "pacheco": ["presidente do senado","mesa do senado"],
  "lira": ["presidente da camara","presidente da câmara","mesa da camara","mesa da câmara"],
};

function roleKeywordsFor(fullName: string): string[] {
  const key = normalize(fullName);
  if (ROLE_MAP[key]) return ROLE_MAP[key];
  const parts = key.split(/\s+/);
  for (const p of parts) if (ROLE_MAP[p]) return ROLE_MAP[p];
  return [];
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function aliasesFor(fullName: string): string[] {
  const key = normalize(fullName);
  if (ALIAS_MAP[key]) return ALIAS_MAP[key];
  // procura por sobrenome/última palavra
  const parts = key.split(/\s+/);
  for (const p of parts) if (ALIAS_MAP[p]) return ALIAS_MAP[p];
  // fallback: nome completo + último sobrenome
  const last = parts[parts.length - 1];
  return [fullName, last.charAt(0).toUpperCase() + last.slice(1)];
}

interface NewsItem {
  title: string;
  url: string;
  source_name: string;
  published_at: string;
  domain: string;
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function stripTags(s: string): string {
  return (s || "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function classifyDomain(url: string): { domain: string; type: "institutional"|"news"|"social" } {
  try {
    const u = new URL(url);
    const d = u.hostname.replace(/^www\./, "");
    if (INSTITUTIONAL_DOMAINS.some((id) => d.endsWith(id))) return { domain: d, type: "institutional" };
    return { domain: d, type: "news" };
  } catch {
    return { domain: "unknown", type: "news" };
  }
}

function isBlocked(title: string): boolean {
  const t = normalize(title);
  return BLOCK_KEYWORDS.some((kw) => t.includes(normalize(kw)));
}

async function fetchGoogleNews(query: string, lookbackDays: number): Promise<NewsItem[]> {
  const window = Math.min(lookbackDays, 365);
  const q = encodeURIComponent(`"${query}" when:${window}d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const res = await timeout(fetch(url, { headers: { "User-Agent": UA } }), FETCH_TIMEOUT_MS);
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(xml)) && items.length < MAX_ITEMS_PER_FEED) {
      const block = m[1];
      const title = stripTags((block.match(/<title>([\s\S]*?)<\/title>/)?.[1]) || "");
      const link = stripTags((block.match(/<link>([\s\S]*?)<\/link>/)?.[1]) || "");
      const pub = stripTags((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]) || "");
      const src = stripTags((block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]) || "");
      if (!title || !link) continue;
      if (isBlocked(title)) continue;
      const { domain } = classifyDomain(link);
      items.push({
        title,
        url: link,
        source_name: src || domain,
        published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
        domain,
      });
    }
    return items;
  } catch {
    return [];
  }
}

// ---- RSS de grande imprensa + institucional (compartilhado entre candidatos) ----
// Tiers controlam TTL de cache: 1=5min, 2=20min, 3=60min
const RSS_FEEDS: { name: string; url: string; tier: 1 | 2 | 3 }[] = [
  // Tier 1 — Institucionais
  { name: "STF",                  url: "https://portal.stf.jus.br/RSS/?modulo=noticias", tier: 1 },
  { name: "TSE",                  url: "https://www.tse.jus.br/imprensa/noticias-tse/rss", tier: 1 },
  { name: "STJ",                  url: "https://www.stj.jus.br/sites/portalp/Paginas/RSS/Noticias.aspx", tier: 1 },
  { name: "Senado",               url: "https://www12.senado.leg.br/noticias/ultimas/feed", tier: 1 },
  { name: "Câmara",               url: "https://www.camara.leg.br/noticias/rss", tier: 1 },
  { name: "Planalto",             url: "https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/RSS", tier: 1 },
  { name: "Agência Brasil - Política", url: "https://agenciabrasil.ebc.com.br/rss/politica/feed.xml", tier: 1 },
  { name: "Agência Brasil - Geral",    url: "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", tier: 1 },
  { name: "Polícia Federal",      url: "https://www.gov.br/pf/pt-br/assuntos/noticias/RSS", tier: 1 },
  { name: "CGU",                  url: "https://www.gov.br/cgu/pt-br/assuntos/noticias/RSS", tier: 1 },
  { name: "TCU",                  url: "https://portal.tcu.gov.br/imprensa/noticias/rss.htm", tier: 1 },
  { name: "Min. Justiça",         url: "https://www.gov.br/mj/pt-br/assuntos/noticias/RSS", tier: 1 },
  { name: "Banco Central",        url: "https://www.bcb.gov.br/api/feed/pt-br/sitebcb/noticias", tier: 1 },
  { name: "Receita Federal",      url: "https://www.gov.br/receitafederal/pt-br/assuntos/noticias/RSS", tier: 1 },
  { name: "AGU",                  url: "https://www.gov.br/agu/pt-br/comunicacao/noticias/RSS", tier: 1 },
  { name: "CNJ",                  url: "https://www.cnj.jus.br/feed/", tier: 1 },

  // Tier 1 — Grandes jornais / TV
  { name: "G1 - Política",        url: "https://g1.globo.com/rss/g1/politica/", tier: 1 },
  { name: "G1 - Brasil",          url: "https://g1.globo.com/rss/g1/", tier: 1 },
  { name: "O Globo - Política",   url: "https://oglobo.globo.com/rss.xml?secao=politica", tier: 1 },
  { name: "UOL - Política",       url: "https://rss.uol.com.br/feed/politica.xml", tier: 1 },
  { name: "UOL - Notícias",       url: "https://rss.uol.com.br/feed/noticias.xml", tier: 1 },
  { name: "Folha - Poder",        url: "https://feeds.folha.uol.com.br/poder/rss091.xml" , tier: 1 },
  { name: "Folha - Política",     url: "https://feeds.folha.uol.com.br/politica/rss091.xml", tier: 1 },
  { name: "Estadão - Política",   url: "https://www.estadao.com.br/arc/outboundfeeds/rss/section/politica/", tier: 1 },
  { name: "CNN Brasil",           url: "https://www.cnnbrasil.com.br/feed/", tier: 1 },
  { name: "CNN Brasil - Política",url: "https://www.cnnbrasil.com.br/politica/feed/", tier: 1 },
  { name: "Reuters Brasil",       url: "https://www.reuters.com/arc/outboundfeeds/rss/category/world/americas/?outputType=xml", tier: 1 },
  { name: "Valor Econômico",      url: "https://valor.globo.com/rss/", tier: 1 },
  { name: "Terra - Política",     url: "https://www.terra.com.br/rss/politica/", tier: 1 },
  { name: "R7 - Política",        url: "https://noticias.r7.com/feed.xml", tier: 1 },
  { name: "Band News",            url: "https://www.band.uol.com.br/rss/noticias.xml", tier: 1 },
  { name: "SBT News",             url: "https://www.sbtnews.com.br/feed", tier: 1 },
  { name: "Jovem Pan",            url: "https://jovempan.com.br/feed", tier: 1 },

  // Tier 2 — Política / bastidores
  { name: "Poder360",             url: "https://www.poder360.com.br/feed/", tier: 2 },
  { name: "Metrópoles",           url: "https://www.metropoles.com/feed", tier: 2 },
  { name: "Metrópoles - Política",url: "https://www.metropoles.com/politica/feed", tier: 2 },
  { name: "Congresso em Foco",    url: "https://congressoemfoco.uol.com.br/feed/", tier: 2 },
  { name: "JOTA",                 url: "https://www.jota.info/feed", tier: 2 },
  { name: "Nexo",                 url: "https://www.nexojornal.com.br/rss", tier: 2 },
  { name: "CartaCapital",         url: "https://www.cartacapital.com.br/feed/", tier: 2 },
  { name: "Veja - Política",      url: "https://veja.abril.com.br/politica/feed", tier: 2 },
  { name: "Exame",                url: "https://exame.com/feed/", tier: 2 },
  { name: "InfoMoney",            url: "https://www.infomoney.com.br/feed/", tier: 2 },
  { name: "Correio Braziliense",  url: "https://www.correiobraziliense.com.br/rss/politica.xml", tier: 2 },
  { name: "Gazeta do Povo",       url: "https://www.gazetadopovo.com.br/feed/", tier: 2 },
  { name: "IstoÉ",                url: "https://istoe.com.br/feed/", tier: 2 },
  { name: "Brasil 247",           url: "https://www.brasil247.com/rss", tier: 2 },
  { name: "Diário do Centro do Mundo", url: "https://www.diariodocentrodomundo.com.br/feed/", tier: 2 },
  { name: "O Antagonista",        url: "https://oantagonista.com.br/feed/", tier: 2 },
  { name: "Crusoé",               url: "https://crusoe.com.br/feed/", tier: 2 },

  // Tier 2 — Economia / mercado
  { name: "Money Times",          url: "https://www.moneytimes.com.br/feed/", tier: 2 },
  { name: "Investing Brasil",     url: "https://br.investing.com/rss/news.rss", tier: 2 },
  { name: "Suno Notícias",        url: "https://www.suno.com.br/noticias/feed/", tier: 2 },
  { name: "NeoFeed",              url: "https://neofeed.com.br/feed/", tier: 2 },
  { name: "Brazil Journal",       url: "https://braziljournal.com/feed/", tier: 2 },

  // Tier 3 — Internacional
  { name: "BBC Brasil",           url: "https://feeds.bbci.co.uk/portuguese/rss.xml", tier: 3 },
  { name: "DW Brasil",            url: "https://rss.dw.com/rdf/rss-br-all", tier: 3 },
  { name: "El País Brasil",       url: "https://brasil.elpais.com/rss/brasil/portada.xml", tier: 3 },
  { name: "Al Jazeera",           url: "https://www.aljazeera.com/xml/rss/all.xml", tier: 3 },
  { name: "The Guardian World",   url: "https://www.theguardian.com/world/rss", tier: 3 },
  { name: "NYT World",            url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", tier: 3 },
  { name: "AP News - Politics",   url: "https://feeds.apnews.com/apf-politics", tier: 3 },
];

const TIER_TTL_MS: Record<1 | 2 | 3, number> = { 1: 5 * 60_000, 2: 20 * 60_000, 3: 60 * 60_000 };
const rssCache = new Map<string, { items: NewsItem[]; expires: number }>();

async function fetchRssFeed(name: string, url: string, tier: 1 | 2 | 3): Promise<NewsItem[]> {
  const cached = rssCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.items;
  const ttl = TIER_TTL_MS[tier];
  try {
    const res = await timeout(fetch(url, { headers: { "User-Agent": UA } }), FETCH_TIMEOUT_MS);
    if (!res.ok) { rssCache.set(url, { items: [], expires: Date.now() + ttl }); return []; }
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemRegex = /<item[\s\S]*?>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(xml)) && items.length < MAX_ITEMS_PER_FEED) {
      const block = m[1];
      const title = stripTags((block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]) || "");
      const link = stripTags((block.match(/<link>([\s\S]*?)<\/link>/)?.[1]) || "");
      const pub = stripTags((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]) || "");
      if (!title || !link) continue;
      if (isBlocked(title)) continue;
      const { domain } = classifyDomain(link);
      items.push({
        title, url: link, source_name: name || domain,
        published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
        domain,
      });
    }
    rssCache.set(url, { items, expires: Date.now() + ttl });
    return items;
  } catch {
    rssCache.set(url, { items: [], expires: Date.now() + ttl });
    return [];
  }
}

async function fetchAllRss(): Promise<NewsItem[]> {
  const results = await Promise.all(RSS_FEEDS.map((f) => fetchRssFeed(f.name, f.url, f.tier)));
  return results.flat();
}

function filterByAliases(
  items: NewsItem[],
  aliases: string[],
  lookbackDays: number,
  roleKeywords: string[] = [],
): NewsItem[] {
  const cutoff = Date.now() - lookbackDays * 86400_000;
  const normAliases = aliases.map((a) => normalize(a)).filter((a) => a.length >= 3);
  const normRoles = roleKeywords.map((r) => normalize(r)).filter((r) => r.length >= 4);
  return items.filter((it) => {
    if (new Date(it.published_at).getTime() < cutoff) return false;
    const t = normalize(it.title);
    // alias match (forte) OU role context match (institucional/cargo) — IA depois descarta ruído
    return normAliases.some((a) => t.includes(a)) || normRoles.some((r) => t.includes(r));
  });
}

function normalizeTitle(t: string): string {
  return normalize(t).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function clusterByDay(items: NewsItem[]): Map<string, NewsItem[]> {
  const groups = new Map<string, NewsItem[]>();
  for (const it of items) {
    const day = it.published_at.slice(0, 10);
    const normTitle = normalizeTitle(it.title);
    const keyTokens = normTitle.split(" ").filter((w) => w.length > 4).slice(0, 3).sort().join("-");
    const key = `${day}::${keyTokens || normTitle.slice(0, 30)}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  return groups;
}

async function classifyCluster(headlines: string[], candidateName: string): Promise<{
  title: string;
  summary: string;
  category: string;
  relevance: number;
} | null> {
  const prompt = `Notícias brasileiras sobre "${candidateName}". Determine se representa evento POLÍTICO relevante nacional.

Ignore: futebol, agenda comum, post viral, aniversário, novela, celebridade.

Retorne SOMENTE JSON:
{"title":"título canônico curto","summary":"resumo 1-2 frases PT-BR","category":"UMA de [${CATEGORIES.join(", ")}]","relevance":0-100}

Relevância:
- 70+: grande (crise nacional, STF, PF, CPI, escândalo, prisão, decisão histórica)
- 40-69: médio (decisão política relevante, votação, fala com impacto)
- 20-39: pequeno (declaração comum, agenda institucional, mas politicamente relevante)
- <20: trivial/irrelevante (será descartado)

Manchetes:
${headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join("\n")}`;

  try {
    const res = await timeout(fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    }), 20_000);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    return {
      title: String(parsed.title ?? headlines[0]).slice(0, 200),
      summary: String(parsed.summary ?? ""),
      category: CATEGORIES.includes(parsed.category) ? parsed.category : "Outros",
      relevance: Math.max(0, Math.min(100, Number(parsed.relevance) || 0)),
    };
  } catch {
    return null;
  }
}

async function calcSocialScore(supabase: any, candidateId: string, day: string): Promise<number> {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 3);

  const { data, error } = await supabase
    .from("social_interactions")
    .select("likes_count,shares_count,comments_count,replies_count,author_id,platform")
    .eq("candidate_id", candidateId)
    .gte("posted_at", start.toISOString())
    .lt("posted_at", end.toISOString())
    .limit(5000);
  if (error || !data) return 0;

  const allowed = new Set(["x","twitter","youtube","telegram","reddit","bluesky"]);
  const filtered = data.filter((r: any) => allowed.has((r.platform || "").toLowerCase()));
  if (filtered.length === 0) return 0;

  let engagement = 0;
  const authors = new Set<string>();
  for (const r of filtered) {
    engagement += (r.likes_count || 0) + (r.shares_count || 0) + (r.comments_count || 0) + (r.replies_count || 0);
    if (r.author_id) authors.add(r.author_id);
  }
  const score = Math.log10(engagement + 1) * 15 + Math.log10(authors.size + 1) * 10;
  return Math.min(100, Math.round(score));
}

function computeImportance(opts: {
  sourceCount: number;
  institutionalCount: number;
  socialScore: number;
  relevance: number;
}): number {
  const sourceScore = Math.min(100, opts.sourceCount * 10);
  const institutionalScore = Math.min(100, opts.institutionalCount * 25);
  const importance =
    0.30 * sourceScore +
    0.25 * institutionalScore +
    0.15 * opts.socialScore +
    0.30 * opts.relevance;
  return Math.round(Math.min(100, importance));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const targetCandidate: string | undefined = body?.candidate_id;
    const lookback: number = Math.max(1, Math.min(365, body?.lookback_days || DEFAULT_LOOKBACK_DAYS));

    let candQ = supabase.from("candidates").select("id,user_id,full_name").eq("status", "active");
    if (targetCandidate) candQ = candQ.eq("id", targetCandidate);
    const { data: candidates, error: candErr } = await candQ.limit(50);
    if (candErr) throw candErr;

    let totalInserted = 0;
    const perCandidate: Record<string, { inserted: number; clusters: number; items: number }> = {};

    // Pré-carrega todos os RSS feeds uma vez (compartilhado entre candidatos)
    const rssPool = await fetchAllRss();

    for (const c of candidates ?? []) {
      const aliases = aliasesFor(c.full_name);
      // coleta múltiplas queries por candidato
      const all: NewsItem[] = [];
      for (const alias of aliases) {
        const items = await fetchGoogleNews(alias, lookback);
        all.push(...items);
      }
      // adiciona itens RSS que casam com aliases do candidato
      all.push(...filterByAliases(rssPool, aliases, lookback));
      // dedupe por url
      const byUrl = new Map<string, NewsItem>();
      for (const it of all) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
      const unique = [...byUrl.values()];

      const clusters = clusterByDay(unique);
      let inserted = 0;

      for (const [key, group] of clusters) {
        const day = key.split("::")[0];
        // dedupe por domínio dentro do cluster
        const uniqByDomain = new Map<string, NewsItem>();
        for (const it of group) if (!uniqByDomain.has(it.domain)) uniqByDomain.set(it.domain, it);
        const uniqueSources = [...uniqByDomain.values()];

        const institutionalCount = uniqueSources.filter((u) =>
          INSTITUTIONAL_DOMAINS.some((id) => u.domain.endsWith(id))
        ).length;
        const majorMediaCount = uniqueSources.filter((u) =>
          MAJOR_NEWS_DOMAINS.some((d) => u.domain.endsWith(d))
        ).length;

        // aceita single-source SE for institucional ou grande imprensa
        const hasQuality = institutionalCount > 0 || majorMediaCount > 0;
        // aceita single-source (recall maximizado); IA filtra ruído depois
        if (uniqueSources.length < 1) continue;

        const headlines = uniqueSources.map((u) => `${u.title} (${u.domain})`);
        const cls = await classifyCluster(headlines, c.full_name);
        if (!cls || cls.relevance < 20) continue;

        const socialScore = await calcSocialScore(supabase, c.id, day);
        const importance = computeImportance({
          sourceCount: uniqueSources.length,
          institutionalCount,
          socialScore,
          relevance: cls.relevance,
        });

        const sourcesJson = uniqueSources.map((u) => {
          const { type } = classifyDomain(u.url);
          return {
            source_name: u.source_name,
            url: u.url,
            type,
            published_at: u.published_at,
          };
        });

        const eventDate = new Date(day).toISOString();
        const { data: existing } = await supabase
          .from("political_events")
          .select("id")
          .eq("candidate_id", c.id)
          .eq("user_id", c.user_id)
          .gte("event_date", `${day}T00:00:00Z`)
          .lt("event_date", `${day}T23:59:59Z`)
          .ilike("title", `%${cls.title.slice(0, 40)}%`)
          .limit(1)
          .maybeSingle();

        const payload: Record<string, unknown> = {
          candidate_id: c.id,
          user_id: c.user_id,
          title: cls.title,
          event_name: cls.title,
          summary: cls.summary,
          ai_summary: cls.summary,
          category: cls.category,
          category_v2: cls.category,
          event_date: eventDate,
          event_type: "noticia",
          source_count: uniqueSources.length,
          total_sources: uniqueSources.length,
          institutional_sources: institutionalCount,
          social_score: socialScore,
          importance,
          importance_score: importance,
          status: "active",
          sources_json: sourcesJson,
          detection_source: "radar-pipeline",
          updated_at: new Date().toISOString(),
        };

        if (existing?.id) {
          await supabase.from("political_events").update(payload).eq("id", existing.id);
        } else {
          const { data: created } = await supabase
            .from("political_events")
            .insert(payload)
            .select("id")
            .single();
          if (created?.id) {
            const sourceRows = uniqueSources.map((u) => {
              const { type } = classifyDomain(u.url);
              return {
                event_id: created.id,
                source_name: u.source_name,
                source_type: type === "institutional" ? "institutional" : "news",
                url: u.url,
                title: u.title,
                published_at: u.published_at,
                is_institutional: type === "institutional",
                is_major_media: MAJOR_NEWS_DOMAINS.some((d) => u.domain.endsWith(d)),
                credibility_score: type === "institutional" ? 0.95 : 0.7,
              };
            });
            await supabase.from("event_sources").upsert(sourceRows, { onConflict: "event_id,url" });
            inserted++;
            totalInserted++;
          }
        }
      }

      perCandidate[c.full_name] = { inserted, clusters: clusters.size, items: unique.length };
    }

    return new Response(
      JSON.stringify({ ok: true, totalInserted, perCandidate, lookback }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[run-radar-pipeline] error", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
