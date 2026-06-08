/**
 * Resolve the canonical "open original publication" URL for a social record.
 *
 * Rules:
 * - Prefer post_url when it is a valid public URL pointing to the actual post.
 * - Otherwise build a deterministic URL per platform from (post_id, author_handle).
 * - Never return a generic profile / channel / search / aggregator URL.
 * - Return null when nothing valid is available — callers must fallback.
 */

export interface ResolvableRecord {
  post_url?: string | null;
  post_id?: string | null;
  external_id?: string | null;
  author_handle?: string | null;
  author_profile_url?: string | null;
  platform?: string | null;
  social_network?: string | null;
}

const stripDiacritics = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export function normalizePlatform(value?: string | null): string {
  const v = stripDiacritics(value || "");
  if (["youtube", "yt", "invidious", "youtu.be"].includes(v)) return "youtube";
  if (["twitter", "x", "twitter/x", "x/twitter", "nitter"].includes(v)) return "twitter";
  if (["tiktok", "tik tok"].includes(v)) return "tiktok";
  if (["instagram", "ig"].includes(v)) return "instagram";
  if (["facebook", "fb"].includes(v)) return "facebook";
  if (["linkedin"].includes(v)) return "linkedin";
  if (["telegram", "tg"].includes(v)) return "telegram";
  if (["bluesky", "bsky"].includes(v)) return "bluesky";
  if (["reddit"].includes(v)) return "reddit";
  if (["mastodon"].includes(v)) return "mastodon";
  if (["threads"].includes(v)) return "threads";
  if (["google news", "google_news", "googlenews", "news.google"].includes(v)) return "google_news";
  if (["gdelt", "portal", "portais", "noticias", "news"].includes(v)) return "news";
  return v || "unknown";
}

const PROFILE_BLOCKED_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "news.google.com",
]);

const PROFILE_PATTERNS: RegExp[] = [
  // YouTube channel/user/search (não é o vídeo)
  /^https?:\/\/(www\.)?youtube\.com\/(channel|user|c|@[^/]+)\/?$/i,
  /^https?:\/\/(www\.)?youtube\.com\/?$/i,
  /^https?:\/\/(www\.)?youtube\.com\/results/i,
  // TikTok pure profile
  /^https?:\/\/(www\.)?tiktok\.com\/@[^/]+\/?$/i,
  /^https?:\/\/(www\.)?tiktok\.com\/?$/i,
  // Instagram profile only
  /^https?:\/\/(www\.)?instagram\.com\/[^/]+\/?$/i,
  // X/Twitter profile only
  /^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/?$/i,
  // Facebook profile only
  /^https?:\/\/(www\.)?facebook\.com\/[^/]+\/?$/i,
  // LinkedIn profile only
  /^https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[^/]+\/?$/i,
];

function isHttps(u: string | null | undefined): u is string {
  if (!u) return false;
  const t = u.trim();
  return /^https:\/\/[^\s]+\.[^\s]+/i.test(t);
}

function isOnlyProfileUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (PROFILE_BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
      // Google News aggregator — must decode
      return true;
    }
  } catch {
    return true;
  }
  return PROFILE_PATTERNS.some((re) => re.test(u));
}

/**
 * Google News URLs vêm como https://news.google.com/articles/<id>?...&url=<encoded>
 * Quando possível, devolve a URL final do veículo.
 */
function decodeGoogleNewsUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (!url.hostname.toLowerCase().includes("news.google.com")) return null;
    const direct = url.searchParams.get("url");
    if (direct && isHttps(direct)) return direct;
    return null;
  } catch {
    return null;
  }
}

function buildFromPlatform(rec: ResolvableRecord): string | null {
  const platform = normalizePlatform(rec.platform || rec.social_network);
  const id = (rec.post_id || rec.external_id || "").trim();
  const handle = (rec.author_handle || "").replace(/^@/, "").trim();
  if (!id) return null;
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${id}`;
    case "twitter":
      return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`;
    case "tiktok":
      return handle ? `https://www.tiktok.com/@${handle}/video/${id}` : null;
    case "instagram":
      return `https://www.instagram.com/p/${id}/`;
    case "facebook":
      return handle ? `https://www.facebook.com/${handle}/posts/${id}` : null;
    case "telegram":
      return handle ? `https://t.me/${handle}/${id}` : null;
    case "bluesky":
      return handle ? `https://bsky.app/profile/${handle}/post/${id}` : null;
    case "reddit":
      return `https://www.reddit.com/comments/${id}`;
    case "threads":
      return handle ? `https://www.threads.net/@${handle}/post/${id}` : null;
    case "linkedin":
      return `https://www.linkedin.com/feed/update/${id}`;
    default:
      return null;
  }
}

/**
 * Return the best canonical original-post URL for a record, or null if no
 * trustworthy URL can be produced. Never returns a profile / channel / search /
 * aggregator URL.
 */
export function resolveOriginalPostUrl(rec: ResolvableRecord): string | null {
  const candidate = (rec.post_url || "").trim();
  if (isHttps(candidate)) {
    // Decode Google News aggregator into real article URL.
    const decoded = decodeGoogleNewsUrl(candidate);
    if (decoded && isHttps(decoded) && !isOnlyProfileUrl(decoded)) return decoded;
    if (!isOnlyProfileUrl(candidate)) return candidate;
  }
  const built = buildFromPlatform(rec);
  if (built && isHttps(built) && !isOnlyProfileUrl(built)) return built;
  return null;
}

/**
 * True when the record has the minimum fields to even attempt rendering an
 * "open original" button. Used as a render guard.
 */
export function hasOriginalPostHints(rec: ResolvableRecord): boolean {
  if (rec.post_url && isHttps(rec.post_url)) return true;
  if ((rec.post_id || rec.external_id) && (rec.platform || rec.social_network)) return true;
  return false;
}
