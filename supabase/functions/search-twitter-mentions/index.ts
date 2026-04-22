// Coleta tweets via RSS de instâncias Nitter (xcancel/nitter) — leve, rápido e estável.
// Mantém a mesma API: { candidateId, candidateName, candidateAliases?, userId?, maxTweets? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SentimentResult {
  label: 'Positivo' | 'Negativo' | 'Neutro';
  score: number;
}

interface ScrapedTweet {
  text: string;
  author: string;
  authorUrl: string;
  postedAt: string;
  likes: number;
  replies: number;
  retweets: number;
  tweetUrl: string | null;
  tweetId: string | null;
}

// Hosts fallback estáticos (lista expandida e atualizada — usados se o banco/discovery falharem)
const FALLBACK_NITTER_HOSTS = [
  'https://xcancel.com',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.privacyredirect.com',
  'https://nitter.tiekoetter.com',
  'https://nitter.space',
  'https://nitter.kareem.one',
  'https://nitter.lucabased.xyz',
  'https://nitter.lunar.icu',
  'https://nitter.net',
  'https://nitter.cz',
  'https://nitter.unixfox.eu',
  'https://nitter.fdn.fr',
  'https://n.opnxng.com',
  'https://nitter.moomoo.me',
  'https://nitter.adminforge.de',
  'https://nitter.1d4.us',
];

// Descobre instâncias Nitter ativas a partir da lista pública mantida pela comunidade.
// Fontes: status.d420.de e GitHub wiki Zedeus/nitter. Caches simples em memória da invocação.
async function discoverNitterHosts(): Promise<string[]> {
  const sources = [
    'https://status.d420.de/api/v1/instances',
    'https://raw.githubusercontent.com/wiki/zedeus/nitter/Instances.md',
  ];
  const found = new Set<string>();
  for (const src of sources) {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      if (src.endsWith('.md')) {
        const md = await r.text();
        const urls = md.match(/https?:\/\/[a-z0-9.\-]+(?:\.[a-z]{2,})/gi) || [];
        urls.forEach(u => {
          try {
            const url = new URL(u);
            if (/nitter|xcancel|opnxng/.test(url.host)) found.add(`https://${url.host}`);
          } catch {}
        });
      } else {
        const j = await r.json();
        const list = Array.isArray(j) ? j : (j?.hosts || j?.instances || []);
        for (const item of list) {
          const host = typeof item === 'string' ? item : (item?.url || item?.host);
          if (typeof host === 'string') {
            const clean = host.startsWith('http') ? host : `https://${host}`;
            try {
              const url = new URL(clean);
              const isUp = !item?.healthy || item.healthy === true;
              if (isUp) found.add(`https://${url.host}`);
            } catch {}
          }
        }
      }
    } catch (e) {
      console.warn('[NITTER-DISCOVERY] falhou', src, (e as Error).message);
    }
  }
  return Array.from(found);
}

// Fallback oficial via X API v2 quando todas as instâncias Nitter falharem.
async function fetchViaXApi(query: string, maxResults: number): Promise<ScrapedTweet[]> {
  const bearer = Deno.env.get('TWITTER_BEARER_TOKEN');
  // Bearer token é o ideal. Se não existir, tenta consumer key como app-only token (raro).
  if (!bearer) {
    console.warn('[X-API] sem TWITTER_BEARER_TOKEN — fallback indisponível');
    return [];
  }
  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query', `${query} lang:pt -is:retweet`);
  url.searchParams.set('max_results', String(Math.min(Math.max(10, maxResults), 100)));
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username');
  try {
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${bearer}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[X-API] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const json = await res.json();
    const users = new Map<string, string>();
    (json?.includes?.users || []).forEach((u: any) => users.set(u.id, u.username));
    const tweets = (json?.data || []) as any[];
    return tweets.map((t) => {
      const username = users.get(t.author_id) || 'user';
      return {
        text: t.text || '',
        author: username,
        authorUrl: `https://x.com/${username}`,
        postedAt: t.created_at || new Date().toISOString(),
        likes: t.public_metrics?.like_count || 0,
        replies: t.public_metrics?.reply_count || 0,
        retweets: t.public_metrics?.retweet_count || 0,
        tweetUrl: `https://x.com/${username}/status/${t.id}`,
        tweetId: String(t.id),
      } as ScrapedTweet;
    });
  } catch (e) {
    console.warn('[X-API] erro:', (e as Error).message);
    return [];
  }
}


const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function decodeHtml(s: string): string {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function parseRss(xml: string): ScrapedTweet[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  const out: ScrapedTweet[] = [];
  for (const it of items) {
    const titleRaw = decodeHtml(pick(it, 'title'));
    const link = decodeHtml(pick(it, 'link'));
    const pubDate = decodeHtml(pick(it, 'pubDate'));
    const creator = decodeHtml(pick(it, 'dc:creator')).replace(/^@/, '');
    const description = decodeHtml(pick(it, 'description'));
    const text = description || titleRaw;
    if (!text || text.length < 10) continue;
    const author = creator || (link.match(/(?:x\.com|twitter\.com|xcancel\.com|nitter\.[^/]+)\/([A-Za-z0-9_]{2,15})/)?.[1] || '');
    if (!author) continue;
    let postedAt = new Date().toISOString();
    const d = new Date(pubDate);
    if (!isNaN(d.getTime())) postedAt = d.toISOString();
    const idMatch = link.match(/status\/(\d+)/);
    out.push({
      text,
      author,
      authorUrl: `https://x.com/${author}`,
      postedAt,
      likes: 0,
      replies: 0,
      retweets: 0,
      tweetUrl: link || null,
      tweetId: idMatch ? idMatch[1] : null,
    });
  }
  return out;
}

async function fetchRss(host: string, query: string): Promise<{ ok: boolean; xml: string | null; error?: string }> {
  const url = `${host}/search/rss?f=tweets&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': randomUA(), 'Accept': 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { ok: false, xml: null, error: `HTTP ${res.status}` };
    }
    const txt = await res.text();
    if (!txt.includes('<item') && !txt.includes('<rss')) {
      return { ok: false, xml: null, error: 'no rss content' };
    }
    return { ok: true, xml: txt };
  } catch (err) {
    return { ok: false, xml: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ====== Coleta de REPLIES de um tweet via página HTML do Nitter ======
interface NitterReply {
  text: string;
  author: string;
  postedAt: string;
  url: string | null;
  likes: number;
}

function parseNitterReplies(html: string, host: string): NitterReply[] {
  const out: NitterReply[] = [];
  // Nitter renderiza replies em <div class="timeline-item"> dentro de .replies / .conversation
  // Cada bloco contém .username, .tweet-content e .tweet-stats
  const blocks = html.match(/<div class="timeline-item[^"]*"[\s\S]*?(?=<div class="timeline-item|<\/div>\s*<\/div>\s*<\/main>)/gi) || [];
  for (const block of blocks) {
    const userMatch = block.match(/class="username"[^>]*>@?([A-Za-z0-9_]{2,20})/);
    const textMatch = block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const dateMatch = block.match(/class="tweet-date"[^>]*>\s*<a[^>]*title="([^"]+)"[^>]*href="([^"]+)"/);
    const likesMatch = block.match(/class="icon-heart"[^>]*>\s*<\/span>\s*([\d,\.]+)/);
    if (!userMatch || !textMatch) continue;
    const text = decodeHtml(textMatch[1]);
    if (!text || text.length < 5) continue;
    const author = userMatch[1];
    let postedAt = new Date().toISOString();
    if (dateMatch) {
      const d = new Date(dateMatch[1]);
      if (!isNaN(d.getTime())) postedAt = d.toISOString();
    }
    const path = dateMatch?.[2] || "";
    const url = path ? (path.startsWith("http") ? path : `${host}${path}`) : null;
    const likes = likesMatch ? parseInt(likesMatch[1].replace(/[,.]/g, ""), 10) || 0 : 0;
    out.push({ text, author, postedAt, url, likes });
  }
  return out;
}

async function fetchTweetReplies(tweetUrl: string, hosts: string[]): Promise<NitterReply[]> {
  // Converte x.com/twitter.com URL para path /<user>/status/<id>
  const m = tweetUrl.match(/(?:x\.com|twitter\.com|xcancel\.com|nitter\.[^/]+)\/([A-Za-z0-9_]+\/status\/\d+)/);
  if (!m) return [];
  const path = `/${m[1]}`;
  for (const host of hosts) {
    try {
      const url = `${host}${path}`;
      const res = await fetch(url, {
        headers: { "User-Agent": randomUA(), "Accept": "text/html" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const replies = parseNitterReplies(html, host);
      if (replies.length > 0) {
        // Primeiro item geralmente é o tweet original — descarta duplicata do autor original se aplicável
        return replies;
      }
    } catch (_e) { /* tenta próximo */ }
  }
  return [];
}

// Coleta paralela: dispara várias instâncias ao mesmo tempo, agrega e dedup.
async function scrapeTwitter(
  query: string,
  hardLimit: number,
  hosts: string[],
  onHostResult?: (host: string, ok: boolean, error?: string) => Promise<void>,
): Promise<ScrapedTweet[]> {
  const results = await Promise.all(
    hosts.map(async (host) => {
      const r = await fetchRss(host, query);
      if (onHostResult) await onHostResult(host, r.ok, r.error);
      if (!r.ok || !r.xml) {
        console.warn(`[TWITTER] ${host} falhou: ${r.error}`);
        return [] as ScrapedTweet[];
      }
      const tweets = parseRss(r.xml);
      console.log(`[TWITTER] ${host} → ${tweets.length} tweets para "${query}"`);
      return tweets;
    })
  );

  const seen = new Set<string>();
  const merged: ScrapedTweet[] = [];
  for (const arr of results) {
    for (const t of arr) {
      const key = t.tweetId || t.tweetUrl || `${t.author}::${t.text.substring(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
      if (merged.length >= hardLimit) break;
    }
    if (merged.length >= hardLimit) break;
  }

  // Fallback: se nenhuma instância retornou, tenta X API oficial
  if (merged.length === 0) {
    console.log('[TWITTER] Todas as instâncias Nitter falharam — usando X API v2');
    const apiTweets = await fetchViaXApi(query, hardLimit);
    for (const t of apiTweets) {
      const key = t.tweetId || `${t.author}::${t.text.substring(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
      if (merged.length >= hardLimit) break;
    }
  }
  return merged;
}

async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[] | null> {
  if (texts.length === 0) return null;
  const clipped = texts.map(t => (t || '').substring(0, 400).trim());
  if (clipped.every(t => t.length === 0)) return null;

  const systemPrompt = `Você é especialista em análise de sentimento de tweets políticos brasileiros.
Para CADA tweet, retorne {"label":"Positivo|Negativo|Neutro","score":0.0-1.0}.
- POSITIVO: apoio, elogio, defesa, intenção de voto, hashtag de campanha, gírias positivas (mitou, mito).
- NEGATIVO: crítica, denúncia, xingamento, sarcasmo, oposição, gírias negativas (gado, mortadela, ladrão).
- NEUTRO: SOMENTE notícias factuais sem opinião.
REGRA: Sarcasmo é SEMPRE Negativo. Em caso de dúvida entre Neutro e outro, escolha o outro.
Responda APENAS um array JSON com EXATAMENTE ${clipped.length} itens, na MESMA ordem.`;

  const userPrompt = clipped.map((t, i) => `${i + 1}. ${t || '[vazio]'}`).join('\n');

  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (groqKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: clipped.length * 60 + 200,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            return clipped.map((_, idx) => {
              const p = parsed[idx];
              const label = ['Positivo', 'Negativo', 'Neutro'].includes(p?.label) ? p.label : 'Neutro';
              const score = Math.max(0, Math.min(1, typeof p?.score === 'number' ? p.score : 0.5));
              return { label, score } as SentimentResult;
            });
          }
        }
      } else {
        console.warn(`[SENTIMENT-GROQ] HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn('[SENTIMENT-GROQ] erro:', err instanceof Error ? err.message : err);
    }
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return null;
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: clipped.length * 60 + 200,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;
    return clipped.map((_, idx) => {
      const p = parsed[idx];
      const label = ['Positivo', 'Negativo', 'Neutro'].includes(p?.label) ? p.label : 'Neutro';
      const score = Math.max(0, Math.min(1, typeof p?.score === 'number' ? p.score : 0.5));
      return { label, score } as SentimentResult;
    });
  } catch (err) {
    console.error('[SENTIMENT] erro:', err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace('Bearer ', '');
    const requestBody = await req.json();
    const isInternalCronRequest = token === supabaseServiceKey;

    let userId = '';
    if (isInternalCronRequest) {
      if (!requestBody?.userId) {
        return new Response(JSON.stringify({ error: 'userId obrigatório para cron' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = requestBody.userId;
    } else {
      const { data: userData, error: authError } = await supabaseService.auth.getUser(token);
      if (authError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Token inválido' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = userData.user.id;
    }

    let db = isInternalCronRequest ? supabaseService : supabase;

    const {
      candidateId,
      candidateName,
      candidateAliases = [] as string[],
      maxTweets = 80,
    } = requestBody;

    if (!candidateId || !candidateName) {
      return new Response(JSON.stringify({ error: 'candidateId e candidateName obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: candidateRecord, error: candidateError } = await supabaseService
      .from('candidates')
      .select('id, user_id')
      .eq('id', candidateId)
      .maybeSingle();
    if (candidateError) {
      return new Response(JSON.stringify({ error: 'Erro ao validar candidato', details: candidateError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!candidateRecord) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado', candidateId }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    let isAdmin = false;
    if (!isInternalCronRequest && candidateRecord.user_id !== userId) {
      const { data: roleRow } = await supabaseService
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .maybeSingle();
      isAdmin = !!roleRow;
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Candidato pertence a outro usuário' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    const ownerUserId = candidateRecord.user_id;
    if (ownerUserId !== userId) db = supabaseService;

    console.log(`[TWITTER] === "${candidateName}" via Nitter (max=${maxTweets}) ===`);

    // === Background job: coleta + análise + replies ===
    const backgroundJob = (async () => {
     try {
    const queries = new Set<string>();
    queries.add(candidateName);
    for (const a of candidateAliases) {
      const v = (a || '').trim();
      if (v && v !== candidateName) queries.add(v);
    }

    const { data: existing } = await db
      .from('social_interactions')
      .select('comment_text, comment_author, author_profile_url')
      .eq('candidate_id', candidateId)
      .eq('social_network', 'Twitter/X')
      .order('created_at', { ascending: false })
      .limit(2000);

    const existingKeys = new Set<string>();
    (existing || []).forEach(i => {
      const author = i.comment_author || '';
      const text = (i.comment_text || '').substring(0, 80);
      existingKeys.add(`${author}:${text}`);
      if (i.author_profile_url) {
        const m = i.author_profile_url.match(/status\/(\d+)/);
        if (m) existingKeys.add(`tweet:${m[1]}`);
      }
    });

    // Carrega instâncias Nitter ativas do banco (saudáveis primeiro)
    const { data: instanceRows } = await supabaseService
      .from('nitter_instances')
      .select('id, url, last_error_at')
      .eq('is_active', true)
      .order('last_error_at', { ascending: true, nullsFirst: true })
      .limit(15);
    const dbHosts = (instanceRows || []).map((r: any) => r.url as string);
    // Descobre dinamicamente novas instâncias Nitter (status.d420.de + wiki)
    const discovered = await discoverNitterHosts();
    if (discovered.length > 0) console.log(`[TWITTER] Descobertas ${discovered.length} instâncias dinâmicas`);
    // Mescla DB + descobertas + fallback estático para maximizar chance de sucesso
    const hostSet = new Set<string>([...dbHosts, ...discovered, ...FALLBACK_NITTER_HOSTS]);
    const allHosts = Array.from(hostSet).slice(0, 30);

    // Health-check ativo paralelo: ping em /about (3s timeout) — descarta hosts mortos antes de gastar query
    const pingResults = await Promise.allSettled(
      allHosts.map(async (h) => {
        try {
          const r = await fetch(`${h}/about`, { method: 'GET', signal: AbortSignal.timeout(3500), headers: { 'User-Agent': randomUA() } });
          return { host: h, ok: r.ok };
        } catch { return { host: h, ok: false }; }
      })
    );
    const aliveHosts = pingResults
      .filter((p): p is PromiseFulfilledResult<{host: string; ok: boolean}> => p.status === 'fulfilled' && p.value.ok)
      .map((p) => p.value.host);
    console.log(`[TWITTER] Health-check: ${aliveHosts.length}/${allHosts.length} instâncias vivas`);
    const hosts = aliveHosts.length > 0 ? aliveHosts.slice(0, 12) : allHosts.slice(0, 8);
    const hostIdByUrl = new Map<string, string>();
    (instanceRows || []).forEach((r: any) => hostIdByUrl.set(r.url, r.id));

    const onHostResult = async (host: string, ok: boolean, error?: string) => {
      const id = hostIdByUrl.get(host);
      if (!id) return;
      if (ok) {
        await supabaseService.from('nitter_instances').update({
          last_checked: new Date().toISOString(),
          last_error_at: null,
          last_error_message: null,
        }).eq('id', id);
      } else {
        await supabaseService.from('nitter_instances').update({
          last_error_at: new Date().toISOString(),
          last_error_message: (error || 'unknown').substring(0, 200),
          last_checked: new Date().toISOString(),
        }).eq('id', id);
      }
    };

    const collected: ScrapedTweet[] = [];
    const seen = new Set<string>();
    const perQuery = Math.max(40, Math.ceil(maxTweets / queries.size));

    for (const q of queries) {
      const partial = await scrapeTwitter(q, perQuery, hosts, onHostResult);
      for (const t of partial) {
        const k = t.tweetId ? `tweet:${t.tweetId}` : `${t.author}:${t.text.substring(0, 80)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        collected.push(t);
      }
      if (collected.length >= maxTweets) break;
    }

    const fresh = collected.filter(t => {
      const k = t.tweetId ? `tweet:${t.tweetId}` : `${t.author}:${t.text.substring(0, 80)}`;
      return !existingKeys.has(k);
    }).slice(0, maxTweets);

    console.log(`[TWITTER] Bruto=${collected.length} | Novos=${fresh.length}`);

    if (fresh.length === 0) {
      return new Response(JSON.stringify({
        success: true, totalFound: collected.length, newTweets: 0, inserted: 0, analyzed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const BATCH = 20;
    let totalInserted = 0;
    let totalAnalyzed = 0;
    for (let i = 0; i < fresh.length; i += BATCH) {
      const batch = fresh.slice(i, i + BATCH);
      const sentiments = await analyzeSentimentBatch(batch.map(t => t.text));
      const records = batch.map((t, idx) => {
        const s = sentiments?.[idx];
        return {
          user_id: ownerUserId,
          candidate_id: candidateId,
          comment_text: t.text,
          comment_author: t.author,
          author_profile_url: t.tweetUrl ?? t.authorUrl,
          social_network: 'Twitter/X',
          sentiment_label: s?.label ?? 'Neutro',
          sentiment_score: s?.score ?? 0.5,
          likes_count: t.likes,
          replies_count: t.replies,
          shares_count: t.retweets,
          original_posted_at: t.postedAt,
          collected_at: new Date().toISOString(),
          interaction_type: 'tweet',
        };
      });
      const { data: inserted, error: insertError } = await db
        .from('social_interactions')
        .insert(records)
        .select('id');
      if (insertError) {
        console.error('[TWITTER] erro insert:', insertError);
        continue;
      }
      totalInserted += inserted?.length || 0;
      if (sentiments) totalAnalyzed += sentiments.length;
    }

    console.log(`[TWITTER] === Inseridos=${totalInserted} | Analisados=${totalAnalyzed} ===`);

    // ========= COLETA DE REPLIES via Nitter para tweets coletados =========
    let repliesInserted = 0;
    const tweetsForReplies = fresh.filter(t => t.tweetUrl).slice(0, 25); // até 25 threads
    if (tweetsForReplies.length > 0) {
      console.log(`[TWITTER-Replies] Buscando replies de ${tweetsForReplies.length} threads`);
      const replyArrays = await Promise.all(
        tweetsForReplies.map(t => fetchTweetReplies(t.tweetUrl!, hosts))
      );
      const allReplies: any[] = [];
      for (let i = 0; i < tweetsForReplies.length; i++) {
        const parent = tweetsForReplies[i];
        for (const r of replyArrays[i]) {
          // Pula reply do próprio autor (geralmente é o tweet original repetido)
          if (r.author.toLowerCase() === parent.author.toLowerCase() && r.text === parent.text) continue;
          allReplies.push({
            user_id: ownerUserId,
            candidate_id: candidateId,
            social_network: 'Twitter/X',
            interaction_type: 'reply',
            comment_text: r.text.slice(0, 4000),
            comment_author: r.author,
            author_profile_url: r.url || `https://x.com/${r.author}`,
            original_posted_at: r.postedAt,
            collected_at: new Date().toISOString(),
            likes_count: r.likes,
            replies_count: 0,
            shares_count: 0,
          });
        }
      }
      if (allReplies.length > 0) {
        // Dedup
        const replyUrls = allReplies.map(r => r.author_profile_url);
        const { data: existingReplies } = await db
          .from('social_interactions')
          .select('author_profile_url')
          .eq('candidate_id', candidateId)
          .eq('social_network', 'Twitter/X')
          .eq('interaction_type', 'reply')
          .in('author_profile_url', replyUrls);
        const exSet = new Set((existingReplies ?? []).map((e: any) => e.author_profile_url));
        const freshReplies = allReplies.filter(r => !exSet.has(r.author_profile_url));
        // Analisa sentimento em batches
        for (let i = 0; i < freshReplies.length; i += 20) {
          const batch = freshReplies.slice(i, i + 20);
          const sentiments = await analyzeSentimentBatch(batch.map(r => r.comment_text));
          batch.forEach((r, idx) => {
            const s = sentiments?.[idx];
            r.sentiment_label = s?.label ?? 'Neutro';
            r.sentiment_score = s?.score ?? 0.5;
          });
          const { data: ins, error: repErr } = await db
            .from('social_interactions')
            .insert(batch)
            .select('id');
          if (repErr) {
            console.error('[TWITTER-Replies] insert falhou:', repErr.message);
          } else {
            repliesInserted += ins?.length || 0;
          }
        }
        console.log(`[TWITTER-Replies] Inseridos=${repliesInserted}`);
      }
    }

    try {
      await supabaseService.functions.invoke('recalculate-candidate-metrics', {
        body: { candidateId },
      });
    } catch (err) {
      console.warn('[TWITTER] recalc falhou:', err);
    }

    console.log(`[TWITTER-BG] complete: inserted=${totalInserted} replies=${repliesInserted}`);
     } catch (bgErr) {
       console.error('[TWITTER-BG] erro:', bgErr);
     }
    })();

    // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundJob);
    }

    return new Response(JSON.stringify({
      success: true, accepted: true,
      message: 'Coleta Twitter/X iniciada em background',
    }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('[TWITTER] erro fatal:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ error: 'Erro interno', details: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
