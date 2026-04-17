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
  author: string;          // handle, sem @
  authorUrl: string;
  postedAt: string;        // ISO
  likes: number;
  replies: number;
  retweets: number;
  tweetUrl: string | null;
  tweetId: string | null;
}

// ── Sentiment analysis (batch, robust) ──────────────────────────────
async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[] | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey || texts.length === 0) return null;

  const clipped = texts.map(t => (t || '').substring(0, 400).trim());
  if (clipped.every(t => t.length === 0)) return null;

  const systemPrompt = `Você é especialista em análise de sentimento de tweets políticos em PT-BR.
Para CADA tweet, retorne: {"label":"Positivo|Negativo|Neutro","score":0.0-1.0}.
- POSITIVO (0.65-1.0): apoio, elogio, intenção de voto, defesa, esperança.
- NEGATIVO (0.0-0.35): crítica, rejeição, insulto, acusação, raiva, deboche.
- NEUTRO (0.36-0.64): SOMENTE notícias factuais sem opinião, perguntas neutras.
NÃO classifique como neutro tweets com sarcasmo, ironia, palavrões ou intensidade emocional — esses são Negativo ou Positivo.
Responda APENAS um array JSON válido com EXATAMENTE ${clipped.length} itens, na MESMA ordem dos tweets.`;

  const userContent = clipped.map((t, i) => `${i + 1}. ${t || '[vazio]'}`).join('\n');

  try {
    let response: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analise (responda array JSON com ${clipped.length} itens):\n\n${userContent}` },
          ],
          temperature: 0.1,
          max_tokens: clipped.length * 60 + 200,
        }),
      });
      if (response.ok) break;
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      console.warn(`[SENTIMENT] Falha gateway: ${response?.status}`);
      return null;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[SENTIMENT] Não achou JSON na resposta:', content.substring(0, 200));
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;

    return clipped.map((_, idx) => {
      const p = parsed[idx];
      const label = ['Positivo', 'Negativo', 'Neutro'].includes(p?.label) ? p.label : 'Neutro';
      const rawScore = typeof p?.score === 'number' ? p.score : 0.5;
      const score = Math.max(0, Math.min(1, rawScore));
      return { label, score } as SentimentResult;
    });
  } catch (error) {
    console.error('[SENTIMENT] Erro:', error);
    return null;
  }
}

// ── Nitter / xcancel scraping with deep pagination ──────────────────
const NITTER_INSTANCES = [
  'https://xcancel.com',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
];

// Substring matchers in lowercase used to filter out site chrome lines
const CHROME_SUBSTRINGS = [
  'xcancel', 'open in x', 'rss feed', 'about', 'preferences', 'donate',
  'search', 'tweets', 'users', 'logo', 'login', 'sign up', 'profile_images',
  'default_profile', 'pbs.twimg', 'abs.twimg', '/settings', '/about',
];

function looksLikeChrome(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.length < 20) return true;
  // Lots of markdown links and almost no text
  const linkCount = (text.match(/\]\(http/g) || []).length;
  const plain = text.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  if (linkCount > 0 && plain.length < 30) return true;
  return CHROME_SUBSTRINGS.some(s => lower.includes(s)) && plain.length < 60;
}

function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTweetsFromHtml(html: string, instance: string): ScrapedTweet[] {
  const tweets: ScrapedTweet[] = [];
  // Each tweet sits inside .timeline-item; we grab everything up to next .timeline-item
  const blockRegex = /<div class="timeline-item[\s\S]*?(?=<div class="timeline-item|<div class="show-more|<\/main>)/g;
  const blocks = html.match(blockRegex) || [];

  for (const block of blocks) {
    const usernameMatch = block.match(/<a class="username"[^>]*>@?([A-Za-z0-9_]+)<\/a>/);
    const contentMatch = block.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const dateMatch = block.match(/<span class="tweet-date"[^>]*>\s*<a[^>]*title="([^"]+)"/);
    const linkMatch = block.match(/<a class="tweet-link"[^>]*href="([^"]+)"/);
    const likesMatch = block.match(/icon-heart[\s\S]{0,200}?>\s*([\d,.]+)/);
    const repliesMatch = block.match(/icon-comment[\s\S]{0,200}?>\s*([\d,.]+)/);
    const retweetsMatch = block.match(/icon-retweet[\s\S]{0,200}?>\s*([\d,.]+)/);

    if (!usernameMatch || !contentMatch) continue;

    const author = usernameMatch[1].trim();
    const text = decodeHtml(contentMatch[1]);
    if (text.length < 5 || /^\s*$/.test(text)) continue;

    let postedAt = new Date().toISOString();
    if (dateMatch) {
      const parsed = new Date(dateMatch[1].replace(' · ', ' '));
      if (!isNaN(parsed.getTime())) postedAt = parsed.toISOString();
    }

    let tweetUrl: string | null = null;
    let tweetId: string | null = null;
    if (linkMatch) {
      const path = linkMatch[1].split('#')[0];
      tweetUrl = path.startsWith('http') ? path : `${instance}${path}`;
      const idMatch = path.match(/status\/(\d+)/);
      tweetId = idMatch ? idMatch[1] : null;
    }

    tweets.push({
      text,
      author,
      authorUrl: `https://x.com/${author}`,
      postedAt,
      likes: parseInt((likesMatch?.[1] || '0').replace(/[,.]/g, '')) || 0,
      replies: parseInt((repliesMatch?.[1] || '0').replace(/[,.]/g, '')) || 0,
      retweets: parseInt((retweetsMatch?.[1] || '0').replace(/[,.]/g, '')) || 0,
      tweetUrl,
      tweetId,
    });
  }

  return tweets;
}

function parseTweetsFromMarkdown(markdown: string): ScrapedTweet[] {
  const tweets: ScrapedTweet[] = [];
  const seen = new Set<string>();
  const lines = markdown.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (looksLikeChrome(line)) continue;
    // Try to extract @handle from any link to xcancel/nitter/x.com user
    const handleMatch = line.match(/(?:xcancel\.com|nitter\.[a-z.]+|x\.com|twitter\.com)\/([A-Za-z0-9_]{2,15})(?:["/)\s])/);
    const author = handleMatch ? handleMatch[1] : '';
    if (!author || ['search','about','settings','i','intent'].includes(author.toLowerCase())) continue;

    // Strip markdown links/images to get plain text
    const plain = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (plain.length < 25) continue;
    const key = `${author}:${plain.substring(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    tweets.push({
      text: plain,
      author,
      authorUrl: `https://x.com/${author}`,
      postedAt: new Date().toISOString(),
      likes: 0,
      replies: 0,
      retweets: 0,
      tweetUrl: null,
      tweetId: null,
    });
  }
  return tweets;
}

async function firecrawlScrape(url: string, firecrawlKey: string) {
  const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html'],
      onlyMainContent: false,
      waitFor: 3000,
      timeout: 30000,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firecrawl ${response.status}: ${body.substring(0, 200)}`);
  }
  const data = await response.json();
  return {
    html: (data.html || data.data?.html || '') as string,
    markdown: (data.markdown || data.data?.markdown || '') as string,
  };
}

async function scrapeTwitterDeep(
  query: string,
  firecrawlKey: string,
  maxPages: number,
  hardLimit: number
): Promise<ScrapedTweet[]> {
  const collected: ScrapedTweet[] = [];
  const seenKeys = new Set<string>();
  let usedInstance: string | null = null;

  for (const instance of NITTER_INSTANCES) {
    if (usedInstance) break;
    try {
      const url = `${instance}/search?f=tweets&q=${encodeURIComponent(query)}`;
      console.log(`[TWITTER] Tentando ${instance} para "${query}"`);
      const { html, markdown } = await firecrawlScrape(url, firecrawlKey);
      if (!html.includes('timeline-item') && !html.includes('tweet-content') && markdown.length < 400) {
        console.warn(`[TWITTER] ${instance} retornou conteúdo vazio/bloqueado`);
        continue;
      }
      const fromHtml = parseTweetsFromHtml(html, instance);
      const fromMd = fromHtml.length === 0 ? parseTweetsFromMarkdown(markdown) : [];
      const initial = fromHtml.length > 0 ? fromHtml : fromMd;
      for (const t of initial) {
        const key = t.tweetId || `${t.author}:${t.text.substring(0, 80)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        collected.push(t);
      }
      usedInstance = instance;

      // Nitter pagination: extract cursor from "Load more" link
      let cursor: string | null = null;
      const cursorMatch = html.match(/href="[^"]*cursor=([^"&]+)"/);
      cursor = cursorMatch ? decodeURIComponent(cursorMatch[1]) : null;

      let page = 1;
      while (cursor && page < maxPages && collected.length < hardLimit) {
        const nextUrl = `${instance}/search?f=tweets&q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`;
        try {
          const { html: nextHtml } = await firecrawlScrape(nextUrl, firecrawlKey);
          const next = parseTweetsFromHtml(nextHtml, instance);
          if (next.length === 0) break;
          for (const t of next) {
            const key = t.tweetId || `${t.author}:${t.text.substring(0, 80)}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            collected.push(t);
            if (collected.length >= hardLimit) break;
          }
          const nextCursor = nextHtml.match(/href="[^"]*cursor=([^"&]+)"/);
          cursor = nextCursor ? decodeURIComponent(nextCursor[1]) : null;
          page++;
          await new Promise(r => setTimeout(r, 600));
        } catch (err) {
          console.warn(`[TWITTER] Página ${page + 1} falhou:`, err instanceof Error ? err.message : err);
          break;
        }
      }
    } catch (err) {
      console.warn(`[TWITTER] ${instance} falhou:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[TWITTER] Coleta bruta: ${collected.length} (instância=${usedInstance ?? 'nenhuma'})`);
  return collected;
}

// ── Main handler ────────────────────────────────────────────────────
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
    const { data: userData, error: authError } = await supabaseService.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ error: 'Firecrawl não configurado.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      candidateId,
      candidateName,
      candidateAliases = [] as string[],
      maxTweets = 200,
      maxPages = 6,
    } = await req.json();

    if (!candidateId || !candidateName) {
      return new Response(JSON.stringify({ error: 'candidateId e candidateName obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TWITTER] === Coleta para "${candidateName}" (max=${maxTweets}, pages=${maxPages}) ===`);

    // Build queries: full name + each alias as separate queries (mais cobertura)
    const queries: string[] = [];
    queries.push(`"${candidateName}" lang:pt`);
    for (const alias of candidateAliases) {
      const a = (alias || '').trim();
      if (a && a !== candidateName) queries.push(`"${a}" lang:pt`);
    }

    // Existing dedup keys (last 2000)
    const { data: existing } = await supabase
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
      // Also dedupe by tweet URL when we have it
      if (i.author_profile_url) {
        const m = i.author_profile_url.match(/status\/(\d+)/);
        if (m) existingKeys.add(`tweet:${m[1]}`);
      }
    });

    // Run all queries, dedupe across them
    const collected: ScrapedTweet[] = [];
    const seenAcross = new Set<string>();
    const perQuery = Math.ceil(maxTweets / queries.length) + 20;

    for (const q of queries) {
      const partial = await scrapeTwitterDeep(q, firecrawlKey, maxPages, perQuery);
      for (const t of partial) {
        const k = t.tweetId ? `tweet:${t.tweetId}` : `${t.author}:${t.text.substring(0, 80)}`;
        if (seenAcross.has(k)) continue;
        seenAcross.add(k);
        collected.push(t);
      }
      if (collected.length >= maxTweets) break;
    }

    // Filter: must mention candidate OR alias (case-insensitive), drop chrome
    const nameTerms = [candidateName, ...candidateAliases]
      .map(t => (t || '').trim().toLowerCase())
      .filter(t => t.length >= 3);

    const meaningful = collected.filter(t => {
      if (looksLikeChrome(t.text)) return false;
      if (t.author === 'unknown' || !t.author) return false;
      const lower = t.text.toLowerCase();
      const mentioned = nameTerms.some(term => lower.includes(term));
      if (!mentioned) return false;
      const dedupKey = t.tweetId ? `tweet:${t.tweetId}` : `${t.author}:${t.text.substring(0, 80)}`;
      return !existingKeys.has(dedupKey);
    });

    const newTweets = meaningful.slice(0, maxTweets);
    console.log(`[TWITTER] Bruto=${collected.length} | Filtrado=${meaningful.length} | Novos=${newTweets.length}`);

    if (newTweets.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Nenhum tweet novo após filtros',
        totalFound: collected.length,
        newTweets: 0,
        inserted: 0,
        analyzed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Sentiment in batches
    const BATCH_SIZE = 20;
    let totalInserted = 0;
    let totalAnalyzed = 0;

    for (let i = 0; i < newTweets.length; i += BATCH_SIZE) {
      const batch = newTweets.slice(i, i + BATCH_SIZE);
      const sentiments = await analyzeSentimentBatch(batch.map(t => t.text));

      const records = batch.map((tweet, idx) => {
        const sent = sentiments?.[idx] ?? null;
        return {
          user_id: userId,
          candidate_id: candidateId,
          comment_text: tweet.text,
          comment_author: tweet.author,
          author_profile_url: tweet.tweetUrl ?? tweet.authorUrl,
          social_network: 'Twitter/X',
          sentiment_label: sent?.label ?? null,
          sentiment_score: sent?.score ?? null,
          likes_count: tweet.likes,
          replies_count: tweet.replies,
          shares_count: tweet.retweets,
          original_posted_at: tweet.postedAt,
          collected_at: new Date().toISOString(),
          interaction_type: 'tweet',
        };
      });

      const { data: inserted, error: insertError } = await supabase
        .from('social_interactions')
        .insert(records)
        .select('id');

      if (insertError) {
        console.error('[TWITTER] Erro insert:', insertError);
        continue;
      }
      totalInserted += inserted?.length || 0;
      if (sentiments) totalAnalyzed += sentiments.length;

      if (i + BATCH_SIZE < newTweets.length) await new Promise(r => setTimeout(r, 400));
    }

    console.log(`[TWITTER] === Inseridos=${totalInserted} | Analisados=${totalAnalyzed} ===`);

    // Recalcula métricas
    try {
      await supabaseService.functions.invoke('recalculate-candidate-metrics', {
        body: { candidateId },
      });
    } catch (err) {
      console.warn('[TWITTER] Falha ao recalcular métricas:', err);
    }

    return new Response(JSON.stringify({
      success: true,
      totalFound: collected.length,
      newTweets: newTweets.length,
      inserted: totalInserted,
      analyzed: totalAnalyzed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('[TWITTER] Erro fatal:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ error: 'Erro interno', details: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
