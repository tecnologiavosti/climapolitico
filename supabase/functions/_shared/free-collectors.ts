// Coletores gratuitos para a Visão por Rede Social.
// Cada função retorna { hits, status, error? }. Falha de uma rede NÃO derruba o pipeline.
// Não inventar dados: se nada retornar, devolver hits=[] com status apropriado.

export type FreeHit = {
  url?: string;
  title?: string;
  description?: string;
  source?: string;
  date?: string;
  author?: string;
  interactions?: number;
};

export type FreeResult = { hits: FreeHit[]; status: string; error?: string };

const DEFAULT_TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0; +https://climapolitico.com.br)";

async function timedFetch(url: string, init: RequestInit = {}, ms = DEFAULT_TIMEOUT_MS): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(ms), headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
}

function withinRange(dateIso: string | undefined, startDate: string, endDate: string): boolean {
  if (!dateIso) return true; // sem data: aceita; chunk_end será usado como fallback
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return true;
  const s = Date.parse(`${startDate}T00:00:00Z`);
  const e = Date.parse(`${endDate}T23:59:59Z`);
  return t >= s && t <= e;
}

// ---------- Google News RSS ----------
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function pickTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : undefined;
}

export async function collectGoogleNews(query: string, startDate: string, endDate: string): Promise<FreeResult> {
  try {
    const q = encodeURIComponent(`${query} after:${startDate} before:${endDate}`);
    const url = `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
    const r = await timedFetch(url);
    if (!r.ok) return { hits: [], status: "error", error: `gnews_${r.status}` };
    const xml = await r.text();
    const items = xml.split(/<item[\s>]/i).slice(1).map((chunk) => "<item " + chunk.split("</item>")[0] + "</item>");
    const hits: FreeHit[] = [];
    for (const block of items.slice(0, 25)) {
      const title = pickTag(block, "title");
      const link = pickTag(block, "link");
      const desc = pickTag(block, "description")?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const pub = pickTag(block, "pubDate");
      const src = pickTag(block, "source");
      const dateIso = pub ? new Date(pub).toISOString() : undefined;
      if (!withinRange(dateIso, startDate, endDate)) continue;
      hits.push({ url: link, title, description: desc, date: dateIso, source: src ?? "Google News" });
    }
    return { hits, status: hits.length ? "ok" : "empty" };
  } catch (e: any) {
    return { hits: [], status: "error", error: e?.message ?? String(e) };
  }
}

// ---------- Reddit ----------
export async function collectReddit(query: string, startDate: string, endDate: string): Promise<FreeResult> {
  try {
    const q = encodeURIComponent(query);
    const url = `https://www.reddit.com/search.json?q=${q}&sort=new&limit=50&restrict_sr=&t=all`;
    const r = await timedFetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return { hits: [], status: r.status === 429 ? "rate_limited" : "error", error: `reddit_${r.status}` };
    const j = await r.json();
    const children = j?.data?.children ?? [];
    const hits: FreeHit[] = [];
    for (const c of children) {
      const d = c?.data ?? {};
      const dateIso = d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined;
      if (!withinRange(dateIso, startDate, endDate)) continue;
      const text = `${d.title ?? ""} ${d.selftext ?? ""}`.trim();
      if (!text) continue;
      hits.push({
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url,
        title: d.title,
        description: (d.selftext ?? "").slice(0, 1000),
        date: dateIso,
        source: d.subreddit_name_prefixed ?? "Reddit",
        author: d.author,
        interactions: Number(d.score ?? 0) + Number(d.num_comments ?? 0),
      });
    }
    return { hits, status: hits.length ? "ok" : "empty" };
  } catch (e: any) {
    return { hits: [], status: "error", error: e?.message ?? String(e) };
  }
}

// ---------- YouTube Data API v3 ----------
export async function collectYouTube(query: string, startDate: string, endDate: string): Promise<FreeResult> {
  const key = Deno.env.get("YOUTUBE_API_KEY");
  if (!key) return { hits: [], status: "unavailable", error: "YOUTUBE_API_KEY ausente" };
  try {
    const u = new URL("https://www.googleapis.com/youtube/v3/search");
    u.searchParams.set("part", "snippet");
    u.searchParams.set("q", query);
    u.searchParams.set("type", "video");
    u.searchParams.set("maxResults", "25");
    u.searchParams.set("order", "date");
    u.searchParams.set("regionCode", "BR");
    u.searchParams.set("relevanceLanguage", "pt");
    u.searchParams.set("publishedAfter", `${startDate}T00:00:00Z`);
    u.searchParams.set("publishedBefore", `${endDate}T23:59:59Z`);
    u.searchParams.set("key", key);
    const r = await timedFetch(u.toString());
    if (!r.ok) return { hits: [], status: r.status === 403 ? "quota_exceeded" : "error", error: `yt_${r.status}` };
    const j = await r.json();
    const ids: string[] = (j.items ?? []).map((it: any) => it?.id?.videoId).filter(Boolean);
    let stats = new Map<string, { views: number; likes: number; comments: number }>();
    if (ids.length) {
      const uv = new URL("https://www.googleapis.com/youtube/v3/videos");
      uv.searchParams.set("part", "statistics");
      uv.searchParams.set("id", ids.join(","));
      uv.searchParams.set("key", key);
      const rv = await timedFetch(uv.toString());
      if (rv.ok) {
        const jv = await rv.json();
        for (const it of jv.items ?? []) {
          stats.set(it.id, {
            views: Number(it.statistics?.viewCount ?? 0),
            likes: Number(it.statistics?.likeCount ?? 0),
            comments: Number(it.statistics?.commentCount ?? 0),
          });
        }
      }
    }
    const hits: FreeHit[] = (j.items ?? []).map((it: any) => {
      const id = it?.id?.videoId;
      const s = stats.get(id) ?? { views: 0, likes: 0, comments: 0 };
      return {
        url: id ? `https://www.youtube.com/watch?v=${id}` : undefined,
        title: it?.snippet?.title,
        description: it?.snippet?.description,
        date: it?.snippet?.publishedAt,
        source: it?.snippet?.channelTitle ?? "YouTube",
        author: it?.snippet?.channelTitle,
        interactions: s.views + s.likes + s.comments,
      };
    });
    return { hits, status: hits.length ? "ok" : "empty" };
  } catch (e: any) {
    return { hits: [], status: "error", error: e?.message ?? String(e) };
  }
}

// ---------- Nitter (Twitter/X) ----------
const NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.cz",
];

export async function collectNitter(query: string, startDate: string, endDate: string, admin?: any): Promise<FreeResult> {
  let instances: string[] = NITTER_INSTANCES;
  try {
    if (admin) {
      const { data } = await admin
        .from("nitter_instances")
        .select("base_url")
        .eq("is_active", true)
        .order("last_success_at", { ascending: false, nullsLast: true })
        .limit(8);
      const fromDb = (data ?? []).map((r: any) => String(r.base_url).replace(/\/+$/, "")).filter(Boolean);
      if (fromDb.length) instances = [...fromDb, ...NITTER_INSTANCES];
    }
  } catch { /* ignore */ }

  const q = encodeURIComponent(`${query} since:${startDate} until:${endDate}`);
  let lastErr = "";
  for (const base of instances) {
    try {
      const r = await timedFetch(`${base}/search?f=tweets&q=${q}`, { headers: { Accept: "text/html" } }, 10_000);
      if (!r.ok) { lastErr = `${base}_${r.status}`; continue; }
      const html = await r.text();
      const tweetBlocks = html.split(/<div class="timeline-item/).slice(1);
      const hits: FreeHit[] = [];
      for (const blk of tweetBlocks.slice(0, 25)) {
        const linkMatch = blk.match(/href="(\/[^"]+\/status\/(\d+))"/);
        const userMatch = blk.match(/<a class="username"[^>]*>@([^<]+)</);
        const textMatch = blk.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        const dateMatch = blk.match(/title="([^"]+UTC)"/);
        if (!linkMatch || !textMatch) continue;
        const text = textMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const dateIso = dateMatch ? new Date(dateMatch[1].replace(" · ", " ")).toISOString() : undefined;
        if (!withinRange(dateIso, startDate, endDate)) continue;
        hits.push({
          url: `https://x.com${linkMatch[1]}`,
          title: text.slice(0, 200),
          description: text,
          date: dateIso,
          source: "X / Twitter",
          author: userMatch?.[1],
        });
      }
      if (hits.length) return { hits, status: "ok" };
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
  }
  return { hits: [], status: "unavailable", error: lastErr || "no_nitter_instance" };
}

// ---------- Plataformas sem API gratuita confiável: marcam unavailable ----------
export async function collectUnavailable(network: string): Promise<FreeResult> {
  return { hits: [], status: "unavailable", error: `${network}_no_free_collector` };
}

// ---------- Dispatcher ----------
export async function collectByNetwork(
  network: string,
  query: string,
  startDate: string,
  endDate: string,
  admin?: any,
): Promise<FreeResult> {
  switch (network) {
    case "news": return await collectGoogleNews(query, startDate, endDate);
    case "reddit": return await collectReddit(query, startDate, endDate);
    case "youtube": return await collectYouTube(query, startDate, endDate);
    case "twitter": return await collectNitter(query, startDate, endDate, admin);
    case "telegram":
    case "tiktok":
    case "instagram":
    case "facebook":
    default:
      return await collectUnavailable(network);
  }
}
