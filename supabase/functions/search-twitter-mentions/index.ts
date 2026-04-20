// Coleta tweets via RSS-Bridge (TwitterBridge) — mesma estratégia do Reddit.
// Resolve 403/502/503 das instâncias Nitter. API mantida:
// { candidateId, candidateName, candidateAliases?, userId?, maxTweets? }

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

// Instâncias públicas RSS-Bridge (mesmas do Reddit, todas suportam TwitterBridge)
const RSS_BRIDGE_INSTANCES = [
  'https://rss-bridge.org/bridge01',
  'https://wtf.roflcopter.fr/rss-bridge',
  'https://rss-bridge.lewd.tech',
  'https://rssbridge.flossboxin.org.in',
  'https://rss.nixnet.services',
  'https://bridge.suumitsu.eu',
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
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
    const author = creator || (link.match(/(?:x\.com|twitter\.com|nitter\.[^/]+)\/([A-Za-z0-9_]{2,15})/)?.[1] || '');
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

function semanticMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  if (tokens.length === 0) return true;
  return tokens.every(tok => t.includes(tok));
}

// Coleta via RSS-Bridge TwitterBridge — tenta cada instância com fallback
async function fetchViaRssBridge(query: string): Promise<ScrapedTweet[]> {
  for (const instance of RSS_BRIDGE_INSTANCES) {
    // TwitterBridge "By keyword/hashtag": context=By+keyword%2Fhashtag&q=...
    const url = `${instance}/?action=display&bridge=TwitterBridge&context=By+keyword%2Fhashtag&q=${encodeURIComponent(query)}&format=Mrss`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': randomUA(),
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`[TWITTER-RSS] ${instance} HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      if (!xml.includes('<item') && !xml.includes('<rss')) {
        console.warn(`[TWITTER-RSS] ${instance} sem conteúdo RSS`);
        continue;
      }
      const tweets = parseRss(xml);
      if (tweets.length > 0) {
        console.log(`[TWITTER-RSS] ${instance} → ${tweets.length} tweets para "${query}"`);
        return tweets;
      }
    } catch (err) {
      console.warn(`[TWITTER-RSS] ${instance} erro:`, err instanceof Error ? err.message : err);
    }
  }
  console.warn(`[TWITTER-RSS] todas as instâncias falharam para "${query}"`);
  return [];
}

// Sentiment batch — Groq com fallback Lovable AI Gateway.
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

    console.log(`[TWITTER] === "${candidateName}" via RSS-Bridge (max=${maxTweets}) ===`);

    // Queries: nome principal + aliases
    const queries = new Set<string>();
    queries.add(candidateName);
    for (const a of candidateAliases) {
      const v = (a || '').trim();
      if (v && v !== candidateName) queries.add(v);
    }

    // Dedup com últimos 2000 tweets já no banco
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

    // Coleta paralela via RSS-Bridge para cada query
    const collected: ScrapedTweet[] = [];
    const seen = new Set<string>();

    const results = await Promise.all(
      Array.from(queries).map(q => fetchViaRssBridge(q).then(tweets => ({ q, tweets })))
    );

    for (const { q, tweets } of results) {
      for (const t of tweets) {
        if (!semanticMatch(t.text, q) && !semanticMatch(t.text, candidateName)) continue;
        const k = t.tweetId ? `tweet:${t.tweetId}` : `${t.author}:${t.text.substring(0, 80)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        collected.push(t);
        if (collected.length >= maxTweets) break;
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
