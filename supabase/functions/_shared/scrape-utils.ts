// Utilitários compartilhados de coleta resiliente.
// - Rotação de User-Agents
// - Pool de proxies HTTP públicos (auto-refresh a cada 30 min)
// - Mirrors federados (Nitter, Invidious, Mastodon, Lemmy)
// - fetch com retry/backoff exponencial e timeout
//
// IMPORTANTE: tudo em memória (cold-start friendly). Nada persistido.

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "ClimaPolitico/1.0 (+https://climapolitico.lovable.app)",
];

export function randomUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

// ---------- Mirrors públicos ----------
export const NITTER_MIRRORS = [
  "https://nitter.net",
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.cz",
  "https://nitter.fdn.fr",
  "https://nitter.lucabased.xyz",
  "https://nitter.kavin.rocks",
  "https://nitter.unixfox.eu",
];

export const INVIDIOUS_MIRRORS = [
  "https://invidious.fdn.fr",
  "https://invidious.privacydev.net",
  "https://yewtu.be",
  "https://inv.nadeko.net",
  "https://invidious.protokolla.fi",
  "https://iv.melmac.space",
  "https://invidious.perennialte.ch",
];

export const MASTODON_INSTANCES = [
  "bolha.us",
  "ursal.zone",
  "mastodon.social",
  "masto.donte.com.br",
  "mastodon.world",
  "mas.to",
  "mstdn.social",
  "techhub.social",
  "infosec.exchange",
  "social.vivaldi.net",
];

export const LEMMY_INSTANCES = [
  "lemmy.world",
  "lemmy.ml",
  "sh.itjust.works",
  "lemmy.dbzer0.com",
  "lemm.ee",
  "feddit.org",
];

// ---------- Pool de proxies públicos ----------
let proxyCache: string[] = [];
let proxyCacheAt = 0;
const PROXY_TTL_MS = 30 * 60 * 1000;

export async function refreshProxyPool(): Promise<string[]> {
  if (proxyCache.length && Date.now() - proxyCacheAt < PROXY_TTL_MS) return proxyCache;
  const sources = [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/http.txt",
  ];
  const collected: string[] = [];
  for (const u of sources) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const txt = await r.text();
      for (const line of txt.split("\n")) {
        const t = line.trim();
        if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(t)) collected.push(`http://${t}`);
      }
    } catch (_) { /* segue */ }
  }
  // dedup + amostra de 200 (evita lista gigante)
  proxyCache = Array.from(new Set(collected)).sort(() => Math.random() - 0.5).slice(0, 200);
  proxyCacheAt = Date.now();
  console.log(`[scrape-utils] proxy pool: ${proxyCache.length} endpoints`);
  return proxyCache;
}

export function pickProxy(): string | null {
  if (!proxyCache.length) return null;
  return proxyCache[Math.floor(Math.random() * proxyCache.length)];
}

// ---------- Fetch resiliente ----------
export interface ResilientFetchOpts {
  retries?: number;          // default 3
  timeoutMs?: number;        // default 10000
  useProxy?: boolean;        // default false (proxy custa latência; ative em sites bloqueantes)
  acceptStatus?: number[];   // default [200..299]
  headers?: Record<string, string>;
}

export async function resilientFetch(url: string, opts: ResilientFetchOpts = {}): Promise<Response | null> {
  const retries = opts.retries ?? 3;
  const timeout = opts.timeoutMs ?? 10000;
  const ok = opts.acceptStatus ?? [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const init: RequestInit = {
        signal: AbortSignal.timeout(timeout),
        headers: {
          "User-Agent": randomUA(),
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
          ...(opts.headers || {}),
        },
      };
      // Deno fetch não suporta proxy nativo; deixamos hook pro futuro.
      const r = await fetch(url, init);
      if (r.ok || ok.includes(r.status)) return r;
      // 429/5xx: backoff
      if (r.status === 429 || r.status >= 500) {
        const wait = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 500;
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      // 4xx definitivo: aborta
      return null;
    } catch (e) {
      const wait = Math.min(8000, 500 * 2 ** attempt);
      await new Promise((res) => setTimeout(res, wait));
      if (attempt === retries) {
        console.warn(`[resilientFetch] desistiu de ${url}: ${(e as Error).message}`);
      }
    }
  }
  return null;
}

// ---------- Mirror failover ----------
export async function fetchFromMirrors(
  mirrors: string[],
  pathBuilder: (base: string) => string,
  opts: ResilientFetchOpts = {},
): Promise<{ response: Response; mirror: string } | null> {
  const shuffled = [...mirrors].sort(() => Math.random() - 0.5);
  for (const m of shuffled) {
    const r = await resilientFetch(pathBuilder(m), { ...opts, retries: 1 });
    if (r) return { response: r, mirror: m };
  }
  return null;
}

// ---------- Slug helpers ----------
export function safeSlug(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-");
}
