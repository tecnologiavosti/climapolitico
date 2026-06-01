// External collector for political events / repercussion.
// Uses Firecrawl Search (Google News-like) and GDELT DOC API (free, no auth).
// All outputs normalized to a common ExternalPublication shape.

import { identifyOutlet, estimateReach, type Region } from "./outlet-regions.ts";

export interface ExternalPublication {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string; // ISO
  outlet: string;
  outletRegion: Region;
  outletReach: number;
  source: "firecrawl" | "gdelt" | "rss";
  raw?: any;
}


const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc";


function getFirecrawlKey(): string | null {
  return Deno.env.get("FIRECRAWL_API_KEY") || null;
}

export async function firecrawlSearch(query: string, opts: {
  limit?: number;
  tbs?: "qdr:d" | "qdr:w" | "qdr:m" | "qdr:y";
  lang?: string;
  country?: string;
} = {}): Promise<ExternalPublication[]> {
  const key = getFirecrawlKey();
  if (!key) {
    console.warn("[external-collector] FIRECRAWL_API_KEY missing — skipping Firecrawl");
    return [];
  }
  try {
    const res = await fetch(`${FIRECRAWL_V2}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: opts.limit ?? 12,
        lang: opts.lang ?? "pt",
        country: opts.country ?? "br",
        tbs: opts.tbs ?? "qdr:m",
      }),
    });
    const json = await res.json().catch(() => null) as any;
    if (!res.ok) {
      console.error("[firecrawl] search failed", res.status, JSON.stringify(json)?.slice(0, 300));
      return [];
    }
    const items = json?.data?.web || json?.data || json?.results?.web || [];
    return (Array.isArray(items) ? items : []).map((r: any) => normalizeFirecrawl(r)).filter(Boolean) as ExternalPublication[];
  } catch (e) {
    console.error("[firecrawl] error", (e as Error).message);
    return [];
  }
}

function normalizeFirecrawl(r: any): ExternalPublication | null {
  const url = r?.url || r?.link;
  if (!url) return null;
  const outlet = identifyOutlet(url);
  return {
    url,
    title: r?.title || "",
    snippet: r?.description || r?.snippet || r?.content?.slice(0, 280) || "",
    publishedAt: r?.publishedDate || r?.published_at || r?.date || undefined,
    outlet: outlet?.name || hostnameOf(url),
    outletRegion: outlet?.region || "Nacional",
    outletReach: outlet?.reachWeight || 3,
    source: "firecrawl",
    raw: r,
  };
}

function hostnameOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

export async function gdeltSearch(query: string, opts: {
  maxRecords?: number;
  timespan?: string; // e.g. "1m", "1w", "30d"
} = {}): Promise<ExternalPublication[]> {
  const params = new URLSearchParams({
    query: `${query} sourcecountry:BR`,
    mode: "ArtList",
    format: "json",
    maxrecords: String(opts.maxRecords ?? 30),
    timespan: opts.timespan ?? "1month",
    sort: "DateDesc",
  });
  try {
    const res = await fetch(`${GDELT_DOC}?${params.toString()}`);
    if (!res.ok) { console.warn("[gdelt] status", res.status); return []; }
    const json = await res.json().catch(() => null) as any;
    const articles = json?.articles || [];
    return (articles as any[]).map((a) => {
      const url = a?.url;
      if (!url) return null;
      const outlet = identifyOutlet(url);
      return {
        url,
        title: a?.title || "",
        snippet: a?.seendate ? `Publicado em ${a.seendate}` : "",
        publishedAt: a?.seendate ? parseGdeltDate(a.seendate) : undefined,
        outlet: outlet?.name || a?.domain || hostnameOf(url),
        outletRegion: outlet?.region || "Nacional",
        outletReach: outlet?.reachWeight || 3,
        source: "gdelt" as const,
        raw: a,
      };
    }).filter(Boolean) as ExternalPublication[];
  } catch (e) {
    console.error("[gdelt] error", (e as Error).message);
    return [];
  }
}

function parseGdeltDate(s: string): string | undefined {
  // 20260527T143000Z
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

// ---------- Free RSS collectors (no API key) ----------
// Google News RSS + Bing News RSS scoped to pt-BR / BR. These are zero-auth,
// extremely resilient public feeds. They form the primary fallback when
// Firecrawl is missing or returns no results.

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate?: string; description?: string; source?: string }> {
  const items: any[] = [];
  const re = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(re) || [];
  for (const block of matches) {
    const title = decodeEntities(stripTags((block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "")));
    const link = decodeEntities(stripTags((block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "")));
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
    const description = decodeEntities(stripTags((block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "")));
    const source = decodeEntities(stripTags((block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || "")));
    if (title && link) items.push({ title, link, pubDate, description, source });
  }
  return items;
}

async function fetchRss(url: string, timeoutMs = 9000): Promise<string | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) {
    console.warn(`[rss] fetch failed ${url}: ${(e as Error).message}`);
    return null;
  }
}

export async function rssNewsSearch(query: string, opts: { limit?: number; daysBack?: number } = {}): Promise<ExternalPublication[]> {
  const limit = opts.limit ?? 40;
  const q = encodeURIComponent(`"${query}"`);
  const feeds = [
    // Google News (pt-BR / BR) — highly reliable
    `https://news.google.com/rss/search?q=${q}+when:${opts.daysBack ?? 60}d&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
    // Bing News
    `https://www.bing.com/news/search?q=${q}&format=RSS&setlang=pt-BR&cc=br`,
  ];
  const results = await Promise.all(feeds.map((u) => fetchRss(u)));
  const collected: ExternalPublication[] = [];
  for (const xml of results) {
    if (!xml) continue;
    for (const it of parseRssItems(xml)) {
      const url = it.link;
      if (!url || !/^https?:\/\//i.test(url)) continue;
      const outlet = identifyOutlet(url);
      const sourceName = it.source || outlet?.name || hostnameOf(url);
      const publishedAt = it.pubDate ? new Date(it.pubDate).toISOString() : undefined;
      collected.push({
        url,
        title: it.title.slice(0, 300),
        snippet: (it.description || "").slice(0, 320),
        publishedAt,
        outlet: outlet?.name || sourceName,
        outletRegion: outlet?.region || "Nacional",
        outletReach: outlet?.reachWeight || 4,
        source: "rss",
        raw: it,
      });
      if (collected.length >= limit * 2) break;
    }
  }
  // dedupe by url + title
  const seen = new Set<string>();
  const out: ExternalPublication[] = [];
  for (const c of collected) {
    const k = (c.url.split("?")[0] || "") + "|" + c.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= limit) break;
  }
  console.log(`[rss] ${query} → ${out.length} publicações`);
  return out;
}

export function dedupePublications(items: ExternalPublication[]): ExternalPublication[] {
  const seen = new Set<string>();

  const out: ExternalPublication[] = [];
  for (const it of items) {
    const key = it.url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export interface RegionalDistribution {
  Sudeste: number; Nordeste: number; Sul: number;
  "Centro-Oeste": number; Norte: number;
}

// Distribute publications across BR regions using outlet origin + textual hints.
// Returns percentages summing to ~100. "Nacional" outlets are spread proportionally
// to population weights so the map isn't blank.
const POP_WEIGHTS: RegionalDistribution = {
  Sudeste: 0.42, Nordeste: 0.27, Sul: 0.14, "Centro-Oeste": 0.08, Norte: 0.09,
};

const REGION_KEYWORDS: Record<keyof RegionalDistribution, string[]> = {
  Sudeste: ["são paulo", "sao paulo", "rio de janeiro", "minas gerais", "espirito santo", "espírito santo", " sp ", " rj ", " mg ", " es "],
  Nordeste: ["bahia", "pernambuco", "ceara", "ceará", "alagoas", "sergipe", "paraiba", "paraíba", "rio grande do norte", "maranhao", "maranhão", "piaui", "piauí", " ba ", " pe ", " ce ", " al ", " se ", " pb ", " rn ", " ma ", " pi ", "nordeste"],
  Sul: ["parana", "paraná", "santa catarina", "rio grande do sul", " pr ", " sc ", " rs ", "porto alegre", "curitiba", "florianopolis", "florianópolis"],
  "Centro-Oeste": ["distrito federal", "brasilia", "brasília", "goias", "goiás", "mato grosso", "mato grosso do sul", " df ", " go ", " mt ", " ms "],
  Norte: ["amazonas", "para ", "pará", "rondonia", "rondônia", "acre", "amapa", "amapá", "roraima", "tocantins", " am ", " pa ", " ro ", " ac ", " ap ", " rr ", " to "],
};

export function computeRegionalDistribution(pubs: ExternalPublication[]): RegionalDistribution {
  const weights: RegionalDistribution = { Sudeste: 0, Nordeste: 0, Sul: 0, "Centro-Oeste": 0, Norte: 0 };
  if (!pubs.length) return { ...POP_WEIGHTS, Sudeste: 42, Nordeste: 27, Sul: 14, "Centro-Oeste": 8, Norte: 9 };

  for (const p of pubs) {
    const w = p.outletReach || 3;
    if (p.outletRegion in weights) {
      (weights as any)[p.outletRegion] += w;
    } else {
      // Nacional / Internacional → spread by population, but also use textual hints
      let matched = false;
      const txt = `${p.title} ${p.snippet}`.toLowerCase();
      for (const region of Object.keys(REGION_KEYWORDS) as (keyof RegionalDistribution)[]) {
        if (REGION_KEYWORDS[region].some((kw) => txt.includes(kw))) {
          weights[region] += w * 0.7;
          matched = true;
        }
      }
      if (!matched) {
        for (const region of Object.keys(POP_WEIGHTS) as (keyof RegionalDistribution)[]) {
          weights[region] += w * POP_WEIGHTS[region];
        }
      }
    }
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return {
    Sudeste: Math.round((weights.Sudeste / total) * 100),
    Nordeste: Math.round((weights.Nordeste / total) * 100),
    Sul: Math.round((weights.Sul / total) * 100),
    "Centro-Oeste": Math.round((weights["Centro-Oeste"] / total) * 100),
    Norte: Math.round((weights.Norte / total) * 100),
  };
}

export function estimatedReachOf(pubs: ExternalPublication[]): number {
  const unique = new Set<string>();
  let total = 0;
  for (const p of pubs) {
    const key = `${p.outlet}`;
    if (unique.has(key)) {
      total += estimateReach(p.outletReach) * 0.2; // diminishing returns for repeated outlets
    } else {
      unique.add(key);
      total += estimateReach(p.outletReach);
    }
  }
  return Math.round(total);
}
