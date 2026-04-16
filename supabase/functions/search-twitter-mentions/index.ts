import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

interface TwitterUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

interface TwitterSearchResponse {
  data?: TwitterTweet[];
  includes?: { users?: TwitterUser[] };
  meta?: { next_token?: string; result_count: number };
}

interface SentimentResult {
  label: 'Positivo' | 'Negativo' | 'Neutro';
  score: number;
}

// ── OAuth 1.0a signing ──────────────────────────────────────────────
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  
  const signature = hmac('sha1', signingKey, baseString, 'utf8', 'base64') as string;
  return signature;
}

function buildOAuthHeader(
  method: string,
  url: string,
  queryParams: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  // Combine oauth + query params for signature base
  const allParams = { ...oauthParams, ...queryParams };
  const signature = generateOAuthSignature(method, url, allParams, consumerSecret, accessTokenSecret);
  oauthParams['oauth_signature'] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

// ── Sentiment analysis (batch) ──────────────────────────────────────
async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[] | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  const requestId = crypto.randomUUID().substring(0, 8);

  if (!apiKey) {
    console.error(`[SENTIMENT:${requestId}] LOVABLE_API_KEY ausente`);
    return null;
  }
  if (texts.length === 0) return null;

  const clipped = texts.map(t => (t || '').substring(0, 400).trim()).filter(t => t.length > 0);
  if (clipped.length === 0) return null;

  console.log(`[SENTIMENT:${requestId}] Analisando ${clipped.length} tweets`);

  try {
    const systemPrompt = `Você é um especialista em análise de sentimento para tweets políticos em português brasileiro.

POSITIVO (score 0.7-1.0): Apoio, elogio, intenção de voto, defesa, emojis positivos.
NEGATIVO (score 0.0-0.3): Crítica, rejeição, insulto, acusação, sarcasmo negativo.
NEUTRO (score 0.4-0.6): Puramente informativo, pergunta genuína, impossível determinar.

REGRA: Tweets curtos de apoio são POSITIVOS, não neutros.
Responda APENAS com um JSON array: [{"label":"Positivo","score":0.85},...]`;

    const userContent = clipped.map((t, i) => `${i + 1}. "${t}"`).join('\n');

    let response: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analise o sentimento:\n\n${userContent}` },
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

    if (!response || !response.ok) {
      console.error(`[SENTIMENT:${requestId}] Falha definitiva`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.error(`[SENTIMENT:${requestId}] Sem JSON na resposta`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length < texts.length) {
      console.error(`[SENTIMENT:${requestId}] Array inválido (${parsed?.length} vs ${texts.length})`);
      return null;
    }

    return texts.map((_, idx) => {
      const p = parsed[idx];
      const label = ['Positivo', 'Negativo', 'Neutro'].includes(p?.label) ? p.label : 'Neutro';
      const score = typeof p?.score === 'number' ? Math.max(0, Math.min(1, p.score)) : 0.5;
      return { label, score } as SentimentResult;
    });
  } catch (error) {
    console.error(`[SENTIMENT:${requestId}] Erro:`, error);
    return null;
  }
}

// ── Twitter API search ──────────────────────────────────────────────
async function searchTweets(
  query: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
  maxResults: number = 10,
  nextToken?: string,
): Promise<TwitterSearchResponse> {
  const baseUrl = 'https://api.x.com/2/tweets/search/recent';
  
  const queryParams: Record<string, string> = {
    'query': query,
    'max_results': Math.min(maxResults, 100).toString(),
    'tweet.fields': 'created_at,public_metrics,author_id',
    'expansions': 'author_id',
    'user.fields': 'name,username,profile_image_url',
  };

  if (nextToken) {
    queryParams['next_token'] = nextToken;
  }

  const authHeader = buildOAuthHeader(
    'GET', baseUrl, queryParams,
    consumerKey, consumerSecret, accessToken, accessTokenSecret,
  );

  const urlWithParams = new URL(baseUrl);
  for (const [k, v] of Object.entries(queryParams)) {
    urlWithParams.searchParams.set(k, v);
  }

  console.log(`[TWITTER] Buscando tweets: "${query}" (max_results=${maxResults})`);

  const response = await fetch(urlWithParams.toString(), {
    headers: { 'Authorization': authHeader },
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[TWITTER] API erro ${response.status}: ${errBody.substring(0, 500)}`);
    throw new Error(`Twitter API error: ${response.status} - ${errBody.substring(0, 200)}`);
  }

  return await response.json();
}

// ── Main handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate user
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabaseService.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Token inválido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const userId = userData.user.id;

    // Twitter credentials
    const consumerKey = Deno.env.get('TWITTER_CONSUMER_KEY');
    const consumerSecret = Deno.env.get('TWITTER_CONSUMER_SECRET');
    const accessToken = Deno.env.get('TWITTER_ACCESS_TOKEN');
    const accessTokenSecret = Deno.env.get('TWITTER_ACCESS_TOKEN_SECRET');

    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
      return new Response(
        JSON.stringify({ error: 'Credenciais do Twitter não configuradas' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Parse request
    const {
      candidateId,
      candidateName,
      candidateAliases = [] as string[],
      maxTweets = 100,
    } = await req.json();

    if (!candidateId || !candidateName) {
      return new Response(
        JSON.stringify({ error: 'candidateId e candidateName são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[TWITTER] Iniciando coleta para: ${candidateName} (${candidateId})`);

    // Build search query — Twitter search supports OR operators
    const nameParts = candidateName.split(/\s+/).filter((p: string) => p.length >= 3);
    const searchTerms = [candidateName, ...candidateAliases.filter((a: string) => a?.trim())];
    // Use quoted full name + OR aliases, lang:pt for Portuguese
    const query = `(${searchTerms.map((t: string) => `"${t}"`).join(' OR ')}) lang:pt -is:retweet`;

    console.log(`[TWITTER] Query: ${query}`);

    // Get existing tweets to avoid duplicates
    const { data: existingInteractions } = await supabase
      .from('social_interactions')
      .select('comment_text, comment_author, original_posted_at')
      .eq('candidate_id', candidateId)
      .eq('social_network', 'twitter');

    const existingSet = new Set(
      (existingInteractions || []).map(i =>
        `${i.comment_author}:${i.original_posted_at}:${(i.comment_text || '').substring(0, 50)}`
      )
    );

    // Search tweets with pagination
    let allTweets: TwitterTweet[] = [];
    let usersMap = new Map<string, TwitterUser>();
    let nextToken: string | undefined;
    let pagesSearched = 0;
    const maxPages = Math.ceil(maxTweets / 100);

    while (pagesSearched < maxPages && allTweets.length < maxTweets) {
      try {
        const result = await searchTweets(
          query, consumerKey, consumerSecret, accessToken, accessTokenSecret,
          Math.min(100, maxTweets - allTweets.length),
          nextToken,
        );

        if (result.data) {
          allTweets.push(...result.data);
        }

        if (result.includes?.users) {
          for (const user of result.includes.users) {
            usersMap.set(user.id, user);
          }
        }

        nextToken = result.meta?.next_token;
        pagesSearched++;

        if (!nextToken || (result.meta?.result_count ?? 0) === 0) break;

        // Rate limit courtesy
        if (pagesSearched < maxPages) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (error) {
        console.error(`[TWITTER] Erro na página ${pagesSearched + 1}:`, error);
        break;
      }
    }

    console.log(`[TWITTER] Total tweets encontrados: ${allTweets.length}`);

    // Filter duplicates
    const newTweets = allTweets.filter(tweet => {
      const user = usersMap.get(tweet.author_id);
      const key = `${user?.username || tweet.author_id}:${tweet.created_at}:${tweet.text.substring(0, 50)}`;
      return !existingSet.has(key);
    });

    console.log(`[TWITTER] Tweets novos (sem duplicatas): ${newTweets.length}`);

    if (newTweets.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Nenhum tweet novo encontrado',
          totalFound: allTweets.length,
          newTweets: 0,
          inserted: 0,
          analyzed: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Analyze sentiment in batches
    const BATCH_SIZE = 25;
    const batches: TwitterTweet[][] = [];
    for (let i = 0; i < newTweets.length; i += BATCH_SIZE) {
      batches.push(newTweets.slice(i, i + BATCH_SIZE));
    }

    let totalAnalyzed = 0;
    let totalInserted = 0;
    let sentimentNotAnalyzed = 0;

    for (const batch of batches) {
      const texts = batch.map(t => t.text);
      const sentimentResults = await analyzeSentimentBatch(texts);

      const records = batch.map((tweet, idx) => {
        const user = usersMap.get(tweet.author_id);
        const sentiment = sentimentResults?.[idx];

        return {
          user_id: userId,
          candidate_id: candidateId,
          comment_text: tweet.text,
          comment_author: user?.username || `user_${tweet.author_id}`,
          author_profile_url: user ? `https://x.com/${user.username}` : null,
          social_network: 'twitter',
          sentiment_label: sentiment?.label || null,
          sentiment_score: sentiment?.score || null,
          likes_count: tweet.public_metrics?.like_count || 0,
          replies_count: tweet.public_metrics?.reply_count || 0,
          shares_count: (tweet.public_metrics?.retweet_count || 0) + (tweet.public_metrics?.quote_count || 0),
          original_posted_at: tweet.created_at,
          collected_at: new Date().toISOString(),
          interaction_type: 'tweet',
        };
      });

      const { data: inserted, error: insertError } = await supabase
        .from('social_interactions')
        .insert(records)
        .select('id');

      if (insertError) {
        console.error('[TWITTER] Erro ao inserir:', insertError);
        continue;
      }

      totalInserted += inserted?.length || 0;
      if (sentimentResults) {
        totalAnalyzed += sentimentResults.length;
      } else {
        sentimentNotAnalyzed += batch.length;
      }

      // Small delay between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`[TWITTER] Resultado: ${totalInserted} inseridos, ${totalAnalyzed} analisados, ${sentimentNotAnalyzed} sem sentimento`);

    return new Response(
      JSON.stringify({
        success: true,
        totalFound: allTweets.length,
        newTweets: newTweets.length,
        inserted: totalInserted,
        analyzed: totalAnalyzed,
        sentimentNotAnalyzed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error: unknown) {
    console.error('[TWITTER] Erro inesperado:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ error: 'Erro interno', details: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
