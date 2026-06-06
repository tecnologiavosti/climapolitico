import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPoliticalCandidateContent } from "../_shared/political-content.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
}

const NEWS_WINDOWS = ["1h", "6h", "12h", "1d", "7d"] as const;
const GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const BING_NEWS = "https://www.bing.com/news/search";

function decodeHtml(value: string): string {
  return (value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function nameQueries(candidateName: string): string[] {
  const stop = new Set(["de", "da", "do", "das", "dos", "e"]);
  const parts = candidateName.split(/\s+/).map((p) => p.trim()).filter(Boolean);
  const meaningful = parts.filter((p) => p.length >= 4 && !stop.has(normalize(p)));
  const queries = new Set<string>([`"${candidateName}"`]);
  for (const token of meaningful) queries.add(token);
  const publicAlias = meaningful.find((token) => ["lula", "bolsonaro", "tarcisio", "caiado", "haddad", "zema", "alckmin", "boulos"].includes(normalize(token))) || meaningful[meaningful.length - 1];
  if (publicAlias) queries.add(`"Presidente ${publicAlias}"`);
  return Array.from(queries).slice(0, 8);
}

function combinedQuery(candidateName: string): string {
  return nameQueries(candidateName).join(" OR ");
}

function primaryNewsQuery(candidateName: string): string {
  const tokens = candidateName.split(/\s+/).map((p) => p.trim()).filter((p) => p.length >= 3);
  const alias = tokens.find((token) => ["lula", "bolsonaro", "tarcisio", "caiado", "haddad", "zema", "alckmin", "boulos"].includes(normalize(token)));
  return alias || candidateName;
}

function matchesCandidateNews(item: NewsItem, candidateName: string): boolean {
  const text = normalize(`${item.title} ${item.description} ${item.source}`);
  const full = normalize(candidateName);
  const stop = new Set(["de", "da", "do", "das", "dos", "e"]);
  const tokens = full.split(/\s+/).filter((p) => p.length >= 4 && !stop.has(p));
  const aliases = tokens.filter((token) => ["lula", "bolsonaro", "tarcisio", "caiado", "haddad", "zema", "alckmin", "boulos"].includes(token));
  if (text.includes(full)) return true;
  if (aliases.some((alias) => new RegExp(`(^|[^a-z0-9])${alias}([^a-z0-9]|$)`, "i").test(text))) return true;
  const hits = tokens.filter((token) => new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(text)).length;
  return tokens.length >= 2 ? hits >= 2 : hits >= 1;
}

function hostNameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Portal de notícia"; }
}

function parseRSSFeed(xmlText: string): NewsItem[] {
  const items: NewsItem[] = [];
  
  // Simple XML parsing for RSS items
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[0];
    
    const title = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || "";
    const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const source = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "Google News";
    const bingSource = itemXml.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/i)?.[1] || "";
    const description = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || "";
    
    if (title && link) {
      items.push({
        title: decodeHtml(title),
        link: decodeHtml(link).trim(),
        pubDate,
        source: decodeHtml((bingSource || source).replace(/<[^>]*>/g, "")) || "Google News",
        description: decodeHtml(description.replace(/<[^>]*>/g, "")).substring(0, 500),
      });
    }
  }
  
  return items;
}

function resolveBingUrl(raw: string): string {
  const decoded = decodeHtml(raw);
  try {
    const url = new URL(decoded);
    const target = url.searchParams.get("url");
    return target ? decodeURIComponent(target) : decoded;
  } catch {
    return decoded;
  }
}

function parseGdeltDate(s: string): string {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date().toUTCString();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toUTCString();
}

async function fetchGdeltNews(candidateName: string): Promise<NewsItem[]> {
  const query = `${combinedQuery(candidateName)} sourcelang:Portuguese sourcecountry:BR`;
  const url = `${GDELT_API}?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=80&format=JSON&timespan=7d&sort=DateDesc`;
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const json = await response.json();
    return (Array.isArray(json?.articles) ? json.articles : []).map((article: any) => ({
      title: String(article?.title || "").slice(0, 300),
      link: String(article?.url || ""),
      pubDate: article?.seendate ? parseGdeltDate(String(article.seendate)) : new Date().toUTCString(),
      source: String(article?.domain || "Portal de notícia"),
      description: String(article?.title || "").slice(0, 500),
    })).filter((item) => item.title && item.link);
  } catch (error) {
    console.warn("[search-google-news] GDELT fallback falhou:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function fetchGoogleNews(query: string, window: typeof NEWS_WINDOWS[number]): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${window}`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0; +https://climapolitico.com.br)",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(14000),
    });
    if (!response.ok) return [];
    return parseRSSFeed(await response.text());
  } catch (error) {
    console.warn(`[search-google-news] falha em ${query}/${window}:`, error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function fetchBingNews(query: string): Promise<NewsItem[]> {
  const url = `${BING_NEWS}?q=${encodeURIComponent(query)}&format=RSS&setlang=pt-BR&cc=br`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0; +https://climapolitico.com.br)",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return [];
    return parseRSSFeed(await response.text()).map((item) => ({ ...item, link: resolveBingUrl(item.link) }));
  } catch (error) {
    console.warn("[search-google-news] Bing fallback falhou:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { candidateName, candidateId, userId } = await req.json();

    if (!candidateName) {
      return new Response(JSON.stringify({ error: "candidateName is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let ownerId = userId as string | undefined;
    if (candidateId && !ownerId) {
      const { data: candidate } = await supabase.from("candidates").select("user_id").eq("id", candidateId).maybeSingle();
      ownerId = candidate?.user_id;
    }

    console.log(`Searching Google News for: ${candidateName}`);

    const queries = [primaryNewsQuery(candidateName)];
    const batches = await Promise.allSettled(
      queries.flatMap((q) => NEWS_WINDOWS.map((w) => fetchGoogleNews(q, w))),
    );
    const bingItems = await fetchBingNews(primaryNewsQuery(candidateName));
    const gdeltItems = await fetchGdeltNews(candidateName);
    console.log(`[search-google-news] fontes: google=${batches.flatMap((result) => result.status === "fulfilled" ? result.value : []).length}, bing=${bingItems.length}, gdelt=${gdeltItems.length}`);
    const seen = new Set<string>();
    const newsItems = [...batches.flatMap((result) => result.status === "fulfilled" ? result.value : []), ...bingItems, ...gdeltItems]
      .filter((item) => item.title && item.link)
      .filter((item) => matchesCandidateNews(item, candidateName) || isPoliticalCandidateContent(`${item.title} ${item.description} ${item.source}`, candidateName))
      .filter((item) => {
        const key = `${item.link.split("?")[0]}|${normalize(item.title).slice(0, 90)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime())
      .slice(0, 80);

    console.log(`Found ${newsItems.length} news items for ${candidateName}`);

    // If candidateId and userId provided, save to social_interactions
    let inserted = 0;
    if (candidateId && ownerId) {
      const urls = newsItems.map((item) => item.link);
      const { data: existing } = urls.length ? await supabase
        .from("social_interactions")
        .select("author_profile_url, post_url")
        .eq("candidate_id", candidateId)
        .in("author_profile_url", urls) : { data: [] };
      const existingUrls = new Set((existing || []).flatMap((row: any) => [row.author_profile_url, row.post_url]).filter(Boolean));

      const interactions = newsItems.filter((item) => !existingUrls.has(item.link)).slice(0, 80).map((item) => ({
        user_id: ownerId,
        candidate_id: candidateId,
        social_network: "google_news",
        platform: "google_news",
        interaction_type: "news",
        comment_text: `${item.title}\n\n${item.description}`,
        comment_author: item.source,
        author_profile_url: item.link,
        post_url: item.link,
        post_title: item.title,
        post_description: item.description,
        author_name: item.source || hostNameOf(item.link),
        engagement_score: 1,
        original_posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        collected_at: new Date().toISOString(),
        likes_count: 0,
        replies_count: 0,
        shares_count: 0,
      }));

      if (interactions.length > 0) {
        const { error: insertError } = await supabase
          .from("social_interactions")
          .insert(interactions);

        if (insertError) {
          console.error("Error saving news to database:", insertError);
        } else {
          inserted = interactions.length;
          console.log(`Saved ${interactions.length} news items to database`);
        }
      }
    }

    return new Response(JSON.stringify({
      news: newsItems,
      total: newsItems.length,
      inserted,
      source: "google_news",
      candidateName,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in search-google-news:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});