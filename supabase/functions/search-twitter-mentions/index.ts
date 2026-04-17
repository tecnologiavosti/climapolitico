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
}

// ── Sentiment analysis (batch) ──────────────────────────────────────
async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[] | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey || texts.length === 0) return null;

  const clipped = texts.map(t => (t || '').substring(0, 400).trim()).filter(t => t.length > 0);
  if (clipped.length === 0) return null;

  const systemPrompt = `Você é um especialista em análise de sentimento para tweets políticos em português brasileiro.
POSITIVO (0.7-1.0): Apoio, elogio, intenção de voto, defesa.
NEGATIVO (0.0-0.3): Crítica, rejeição, insulto, acusação.
NEUTRO (0.4-0.6): Informativo, pergunta genuína.
Responda APENAS com JSON array: [{"label":"Positivo","score":0.85},...]`;

  const userContent = clipped.map((t, i) => `${i + 1}. "${t}"`).join('\n');

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
            { role: 'user', content: `Analise:\n\n${userContent}` },
          ],
          temperature: 0.1,
          max_tokens: clipped.length * 50 + 100,
        }),
      });
      if (response.ok) break;
      if (response.status === 429 && attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      break;
    }

    if (!response || !response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;

    return texts.map((_, idx) => {
      const p = parsed[idx];
      const label = ['Positivo', 'Negativo', 'Neutro'].includes(p?.label) ? p.label : 'Neutro';
      const score = typeof p?.score === 'number' ? Math.max(0, Math.min(1, p.score)) : 0.5;
      return { label, score } as SentimentResult;
    });
  } catch (error) {
    console.error('[SENTIMENT] Erro:', error);
    return null;
  }
}

// ── Firecrawl scraping ──────────────────────────────────────────────
async function scrapeTwitterSearch(query: string, firecrawlKey: string): Promise<ScrapedTweet[]> {
  // Use Nitter (Twitter mirror) which is much more scraper-friendly
  const searchUrl = `https://nitter.net/search?f=tweets&q=${encodeURIComponent(query)}&since=&until=&near=`;
  
  console.log(`[TWITTER] Scraping via Firecrawl: ${searchUrl}`);

  const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: searchUrl,
      formats: ['markdown', 'html'],
      onlyMainContent: true,
      waitFor: 2000,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Firecrawl error ${response.status}: ${errBody.substring(0, 300)}`);
  }

  const data = await response.json();
  const html: string = data.html || data.data?.html || '';
  const markdown: string = data.markdown || data.data?.markdown || '';

  const tweets: ScrapedTweet[] = [];

  // Parse tweets from Nitter HTML structure
  const tweetBlockRegex = /<div class="timeline-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  const matches = [...html.matchAll(tweetBlockRegex)];

  for (const match of matches) {
    const block = match[1];
    
    const usernameMatch = block.match(/<a class="username"[^>]*>@([^<]+)<\/a>/);
    const contentMatch = block.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const dateMatch = block.match(/<span class="tweet-date"[^>]*><a[^>]*title="([^"]+)"/);
    const likesMatch = block.match(/<span class="icon-heart"[^>]*><\/span>\s*([\d,.]+)?/);
    const repliesMatch = block.match(/<span class="icon-comment"[^>]*><\/span>\s*([\d,.]+)?/);
    const retweetsMatch = block.match(/<span class="icon-retweet"[^>]*><\/span>\s*([\d,.]+)?/);

    if (!usernameMatch || !contentMatch) continue;

    const author = usernameMatch[1].trim();
    const text = contentMatch[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    if (text.length < 5) continue;

    tweets.push({
      text,
      author,
      authorUrl: `https://x.com/${author}`,
      postedAt: dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString(),
      likes: parseInt((likesMatch?.[1] || '0').replace(/[,.]/g, '')) || 0,
      replies: parseInt((repliesMatch?.[1] || '0').replace(/[,.]/g, '')) || 0,
      retweets: parseInt((retweetsMatch?.[1] || '0').replace(/[,.]/g, '')) || 0,
    });
  }

  // Fallback: parse markdown if HTML parsing failed
  if (tweets.length === 0 && markdown) {
    const lines = markdown.split('\n').filter(l => l.trim().length > 20);
    const seen = new Set<string>();
    for (const line of lines.slice(0, 30)) {
      const clean = line.replace(/^[#*\->\s]+/, '').trim();
      if (clean.length < 20 || seen.has(clean.substring(0, 50))) continue;
      seen.add(clean.substring(0, 50));
      const userMatch = clean.match(/@(\w+)/);
      tweets.push({
        text: clean,
        author: userMatch?.[1] || 'unknown',
        authorUrl: userMatch ? `https://x.com/${userMatch[1]}` : '',
        postedAt: new Date().toISOString(),
        likes: 0,
        replies: 0,
        retweets: 0,
      });
    }
  }

  console.log(`[TWITTER] ${tweets.length} tweets parseados`);
  return tweets;
}

// ── Main handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
      return new Response(JSON.stringify({ error: 'Firecrawl não configurado. Conecte em Connectors.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      candidateId,
      candidateName,
      candidateAliases = [] as string[],
      maxTweets = 30,
    } = await req.json();

    if (!candidateId || !candidateName) {
      return new Response(JSON.stringify({ error: 'candidateId e candidateName obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TWITTER] Coleta para: ${candidateName}`);

    const searchTerms = [candidateName, ...candidateAliases.filter((a: string) => a?.trim())];
    const query = `${searchTerms.map((t: string) => `"${t}"`).join(' OR ')} lang:pt`;

    // Get existing to avoid duplicates
    const { data: existing } = await supabase
      .from('social_interactions')
      .select('comment_text, comment_author')
      .eq('candidate_id', candidateId)
      .eq('social_network', 'Twitter/X')
      .limit(500);

    const existingSet = new Set(
      (existing || []).map(i => `${i.comment_author}:${(i.comment_text || '').substring(0, 50)}`)
    );

    let scraped: ScrapedTweet[] = [];
    try {
      scraped = await scrapeTwitterSearch(query, firecrawlKey);
    } catch (err) {
      console.error('[TWITTER] Erro no scraping:', err);
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Erro no scraping',
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const newTweets = scraped
      .filter(t => !existingSet.has(`${t.author}:${t.text.substring(0, 50)}`))
      .slice(0, maxTweets);

    console.log(`[TWITTER] ${scraped.length} encontrados, ${newTweets.length} novos`);

    if (newTweets.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Nenhum tweet novo',
        totalFound: scraped.length,
        newTweets: 0,
        inserted: 0,
        analyzed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Sentiment in batches
    const BATCH_SIZE = 25;
    let totalInserted = 0;
    let totalAnalyzed = 0;

    for (let i = 0; i < newTweets.length; i += BATCH_SIZE) {
      const batch = newTweets.slice(i, i + BATCH_SIZE);
      const sentiments = await analyzeSentimentBatch(batch.map(t => t.text));

      const records = batch.map((tweet, idx) => ({
        user_id: userId,
        candidate_id: candidateId,
        comment_text: tweet.text,
        comment_author: tweet.author,
        author_profile_url: tweet.authorUrl,
        social_network: 'Twitter/X',
        sentiment_label: sentiments?.[idx]?.label || null,
        sentiment_score: sentiments?.[idx]?.score || null,
        likes_count: tweet.likes,
        replies_count: tweet.replies,
        shares_count: tweet.retweets,
        original_posted_at: tweet.postedAt,
        collected_at: new Date().toISOString(),
        interaction_type: 'tweet',
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('social_interactions')
        .insert(records)
        .select('id');

      if (insertError) {
        console.error('[TWITTER] Insert error:', insertError);
        continue;
      }

      totalInserted += inserted?.length || 0;
      if (sentiments) totalAnalyzed += sentiments.length;

      if (i + BATCH_SIZE < newTweets.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`[TWITTER] ${totalInserted} inseridos, ${totalAnalyzed} analisados`);

    return new Response(JSON.stringify({
      success: true,
      totalFound: scraped.length,
      newTweets: newTweets.length,
      inserted: totalInserted,
      analyzed: totalAnalyzed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('[TWITTER] Erro:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ error: 'Erro interno', details: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
