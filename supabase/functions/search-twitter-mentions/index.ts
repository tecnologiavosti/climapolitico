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

// Hosts fallback estáticos (usados se o banco estiver vazio)
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
];

const UA = 'Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0)';

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
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(12000),
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

  // Dedup por tweetId / link / texto
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
  return merged;
}

// Sentiment batch via Lovable AI Gateway
async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[] | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey || texts.length === 0) return null;
  const clipped = texts.map(t => (t || '').substring(0, 400).trim());
  if (clipped.every(t => t.length === 0)) return null;

  const systemPrompt = `Você é especialista em análise de sentimento de tweets políticos em PT-BR.
Para CADA tweet, retorne {"label":"Positivo|Negativo|Neutro","score":0.0-1.0}.
- POSITIVO (0.65-1.0): apoio, elogio, intenção de voto, defesa.
- NEGATIVO (0.0-0.35): crítica, rejeição, insulto, acusação, raiva, deboche.
- NEUTRO (0.36-0.64): SOMENTE notícias factuais sem opinião.
Responda APENAS um array JSON com EXATAMENTE ${clipped.length} itens, na MESMA ordem.`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: clipped.map((t, i) => `${i + 1}. ${t || '[vazio]'}`).join('\n') },
        ],
        temperature: 0.1,
        max_tokens: clipped.length * 60 + 200,
      }),
    });
    if (!response.ok) {
      console.warn(`[SENTIMENT] gateway ${response.status}`);
      return null;
    }
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
      console.log(`[TWITTER] Cron interno user=${userId}`);
    } else {
      const { data: userData, error: authError } = await supabaseService.auth.getUser(token);
      if (authError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Token inválido' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = userData.user.id;
    }

    const db = isInternalCronRequest ? supabaseService : supabase;

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

    const { data: candidateRecord, error: candidateError } = await db
      .from('candidates')
      .select('id, user_id')
      .eq('id', candidateId)
      .single();
    if (candidateError || !candidateRecord || candidateRecord.user_id !== userId) {
      return new Response(JSON.stringify({ error: 'Candidato inválido' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TWITTER] === "${candidateName}" (max=${maxTweets}) ===`);

    // Build queries: nome completo + aliases (cada um vira uma busca RSS separada)
    const queries = new Set<string>();
    queries.add(candidateName);
    for (const a of candidateAliases) {
      const v = (a || '').trim();
      if (v && v !== candidateName) queries.add(v);
    }

    // dedup com últimos 2000 tweets já no banco
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

    const collected: ScrapedTweet[] = [];
    const seen = new Set<string>();
    const perQuery = Math.max(20, Math.ceil(maxTweets / queries.size));

    for (const q of queries) {
      const partial = await scrapeTwitter(q, perQuery);
      for (const t of partial) {
        const k = t.tweetId ? `tweet:${t.tweetId}` : `${t.author}:${t.text.substring(0, 80)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        collected.push(t);
      }
      if (collected.length >= maxTweets) break;
    }

    // Filter: dedupe contra banco; menção é garantida (RSS é por busca exata)
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
          user_id: userId,
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

    try {
      await supabaseService.functions.invoke('recalculate-candidate-metrics', {
        body: { candidateId },
      });
    } catch (err) {
      console.warn('[TWITTER] recalc falhou:', err);
    }

    return new Response(JSON.stringify({
      success: true,
      totalFound: collected.length,
      newTweets: fresh.length,
      inserted: totalInserted,
      analyzed: totalAnalyzed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('[TWITTER] erro fatal:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ error: 'Erro interno', details: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
