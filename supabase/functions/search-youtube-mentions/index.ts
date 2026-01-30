import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface YouTubeSearchResult {
  items: Array<{
    id: { videoId: string };
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      channelTitle: string;
    };
  }>;
}

interface YouTubeCommentThread {
  items: Array<{
    id: string;
    snippet: {
      topLevelComment: {
        id: string;
        snippet: {
          textOriginal: string;
          textDisplay: string;
          authorDisplayName: string;
          authorChannelId?: { value: string };
          likeCount: number;
          publishedAt: string;
          videoId: string;
        };
      };
    };
  }>;
  nextPageToken?: string;
}

interface SentimentResult {
  label: 'Positivo' | 'Negativo' | 'Neutro';
  score: number;
}

async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  
  if (!apiKey) {
    console.warn('LOVABLE_API_KEY not found, defaulting to neutral sentiment');
    return { label: 'Neutro', score: 0.5 };
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'system',
            content: `Você é um analisador de sentimento político. Analise o texto e responda APENAS com um JSON no formato: {"label": "Positivo|Negativo|Neutro", "score": 0.0-1.0}
            
            Regras:
            - Positivo: Apoio, elogio, concordância, entusiasmo
            - Negativo: Crítica, desaprovação, raiva, decepção  
            - Neutro: Informativo, sem opinião clara, pergunta

            Score: 0 = muito negativo, 0.5 = neutro, 1 = muito positivo`
          },
          {
            role: 'user',
            content: text.substring(0, 500) // Limit text length
          }
        ],
        temperature: 0.1,
        max_tokens: 50
      })
    });

    if (!response.ok) {
      console.error('Sentiment API error:', response.status);
      return { label: 'Neutro', score: 0.5 };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        label: parsed.label || 'Neutro',
        score: typeof parsed.score === 'number' ? parsed.score : 0.5
      };
    }

    return { label: 'Neutro', score: 0.5 };
  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return { label: 'Neutro', score: 0.5 };
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[]> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');

  // If no API key, default everything to neutral so collection still works.
  if (!apiKey) {
    console.warn('LOVABLE_API_KEY not found, defaulting to neutral sentiment (batch)');
    return texts.map(() => ({ label: 'Neutro', score: 0.5 }));
  }

  // Safety: keep payload bounded
  const clipped = texts.map((t) => (t || '').substring(0, 500));

  try {
    const systemPrompt = `Você é um especialista em análise de sentimento para comentários políticos em português brasileiro.

REGRAS CRÍTICAS DE CLASSIFICAÇÃO:

POSITIVO (score 0.7-1.0) - QUALQUER comentário que demonstre:
- Apoio explícito: "voto nele", "meu candidato", "o melhor", "vai ganhar"
- Intenção de voto: "22", "13", números de urna mencionados com aprovação
- Elogios: "mito", "presidente", "parabéns", "orgulho", "honesto"
- Torcida: "com certeza", "vai dar certo", "confiamos", "força"
- Defesa: "não fez nada errado", "injustiça", "perseguição"
- Combinações de candidatos com tom favorável: "Vice X com Y", "chapa perfeita"
- Emojis positivos: 👏 ❤️ 🇧🇷 💚💛 🙏

NEGATIVO (score 0.0-0.3) - Comentários que demonstrem:
- Críticas diretas: "ladrão", "corrupto", "mentiroso", "incompetente"
- Rejeição: "fora", "nunca", "jamais votaria"
- Insultos ou xingamentos
- Acusações: "roubou", "destruiu", "acabou com"
- Desprezo ou sarcasmo negativo
- Emojis negativos: 🤮 👎 😡 💩

NEUTRO (score 0.4-0.6) - APENAS quando:
- O comentário é puramente informativo sem opinião
- Pergunta genuína sem viés aparente
- Comentário completamente off-topic
- Impossível determinar polaridade

IMPORTANTE:
- Comentários curtos de apoio político são POSITIVOS, não neutros
- Frases como "Fulano presidente" são POSITIVAS (intenção de voto)
- Na dúvida entre Neutro e Positivo/Negativo, escolha a polaridade detectada

Responda APENAS com um JSON array: [{"label":"Positivo|Negativo|Neutro","score":0.0-1.0}, ...] na MESMA ORDEM.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ texts: clipped }) },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error('Sentiment API error (batch):', response.status);
      return texts.map(() => ({ label: 'Neutro', score: 0.5 }));
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return texts.map(() => ({ label: 'Neutro', score: 0.5 }));
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return texts.map(() => ({ label: 'Neutro', score: 0.5 }));
    }

    // Normalize to correct length
    const normalized: SentimentResult[] = parsed.slice(0, texts.length).map((p: any) => ({
      label: p?.label === 'Positivo' || p?.label === 'Negativo' || p?.label === 'Neutro' ? p.label : 'Neutro',
      score: typeof p?.score === 'number' ? p.score : 0.5,
    }));

    while (normalized.length < texts.length) normalized.push({ label: 'Neutro', score: 0.5 });
    return normalized;
  } catch (error) {
    console.error('Sentiment analysis error (batch):', error);
    return texts.map(() => ({ label: 'Neutro', score: 0.5 }));
  }
}

async function searchYouTubeVideos(
  query: string, 
  apiKey: string, 
  maxResults: number = 10,
  orderBy: 'date' | 'relevance' | 'viewCount' = 'date'
): Promise<YouTubeSearchResult> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', maxResults.toString());
  url.searchParams.set('order', orderBy); // Use date to get newest videos
  url.searchParams.set('relevanceLanguage', 'pt');
  url.searchParams.set('regionCode', 'BR');
  url.searchParams.set('key', apiKey);

  console.log(`Searching YouTube for: "${query}" (order: ${orderBy})`);
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    const error = await response.text();
    console.error('YouTube Search API error:', error);
    throw new Error(`YouTube API error: ${response.status} - ${error}`);
  }

  return await response.json();
}

async function getVideoComments(
  videoId: string, 
  apiKey: string, 
  maxResults: number = 50,
  pageToken?: string
): Promise<YouTubeCommentThread> {
  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('maxResults', maxResults.toString());
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('textFormat', 'plainText');
  url.searchParams.set('key', apiKey);
  
  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }

  console.log(`Fetching comments for video: ${videoId}`);
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    const error = await response.text();
    // Comments might be disabled - return empty
    if (response.status === 403) {
      console.warn(`Comments disabled for video ${videoId}`);
      return { items: [] };
    }
    console.error('YouTube Comments API error:', error);
    throw new Error(`YouTube Comments API error: ${response.status}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth header for user validation
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - no auth token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Service client for auth validation (more reliable than anon for token introspection)
    const supabaseService = createClient(supabaseUrl, supabaseServiceRoleKey);
    
    // User-scoped client for DB ops (keeps RLS enforced)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Validate user
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabaseService.auth.getUser(token);

    if (authError || !userData?.user) {
      console.error('Auth validation failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    console.log(`Authenticated user: ${userId}`);

    // Get YouTube API key
    const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY');
    if (!youtubeApiKey) {
      return new Response(
        JSON.stringify({ error: 'YouTube API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const {
      candidateId,
      candidateName,
      // how many videos to search per order type (date + relevance)
      maxVideos = 25,
      // YouTube API is paged; this is per page. We'll paginate until we hit maxNewComments.
      maxCommentsPerVideo = 100,
      // Hard cap per invocation - INCREASED significantly for better statistical relevance
      maxNewComments = 500,
    } = await req.json();

    if (!candidateId || !candidateName) {
      return new Response(
        JSON.stringify({ error: 'candidateId and candidateName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting YouTube collection for candidate: ${candidateName} (${candidateId})`);

    // Get already collected comment authors to avoid duplicates
    const { data: existingComments } = await supabase
      .from('social_interactions')
      .select('comment_text, comment_author, original_posted_at')
      .eq('candidate_id', candidateId)
      .eq('social_network', 'YouTube');

    // Create a Set of unique identifiers for existing comments
    const existingCommentsSet = new Set(
      (existingComments || []).map(c => 
        `${c.comment_author}:${c.original_posted_at}:${(c.comment_text || '').substring(0, 50)}`
      )
    );
    
    console.log(`Found ${existingCommentsSet.size} existing comments to skip duplicates`);

    // Search for videos - use 'date' to get newest videos first
    const searchResults = await searchYouTubeVideos(candidateName, youtubeApiKey, maxVideos, 'date');
    
    // Also search by relevance to get popular videos
    const relevanceResults = await searchYouTubeVideos(candidateName, youtubeApiKey, maxVideos, 'relevance');
    
    // Also search by viewCount to get most viewed videos
    const viewCountResults = await searchYouTubeVideos(candidateName, youtubeApiKey, maxVideos, 'viewCount');
    
    // Merge and deduplicate video results
    const allVideoIds = new Set<string>();
    const allVideos: YouTubeSearchResult['items'] = [];
    
    for (const video of [...(searchResults.items || []), ...(relevanceResults.items || []), ...(viewCountResults.items || [])]) {
      if (!allVideoIds.has(video.id.videoId)) {
        allVideoIds.add(video.id.videoId);
        allVideos.push(video);
      }
    }
    
    const videosFound = allVideos.length;
    console.log(`Found ${videosFound} unique videos (date + relevance + viewCount search)`);

    if (videosFound === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No videos found for this candidate',
          stats: { videosFound: 0, commentsCollected: 0, sentimentAnalyzed: 0, skippedDuplicates: 0 }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Collect comments from each video
    let totalComments = 0; // new comments inserted
    let skippedDuplicates = 0;
    let sentimentAnalyzed = 0;
    const uniqueAuthors = new Set<string>();

    // Increased batch size for faster processing
    const BATCH_SIZE = 15;
    const nowIso = new Date().toISOString();
    const insertedRowsForStats: any[] = [];

    const insertBatch = async (batchItems: any[]) => {
      if (batchItems.length === 0) return;
      console.log(`Inserting batch: ${batchItems.length} comments`);
      const { error: insertError } = await supabase
        .from('social_interactions')
        .insert(batchItems);
      if (insertError) {
        console.error('Database insert error (batch):', insertError);
        // Partial success strategy: don't throw; let the run finish and return stats.
      }
      insertedRowsForStats.push(...batchItems);
    };

    for (const video of allVideos) {
      if (totalComments >= maxNewComments) break;

      const videoId = video.id.videoId;
      let pageToken: string | undefined = undefined;

      try {
        while (totalComments < maxNewComments) {
          const commentsData = await getVideoComments(videoId, youtubeApiKey, maxCommentsPerVideo, pageToken);
          const items = commentsData.items || [];
          if (items.length === 0) break;

          // Collect new comments for this page
          const pageCandidates: {
            commentText: string;
            author: string;
            authorChannelId?: string;
            likeCount: number;
            publishedAt: string;
          }[] = [];

          for (const thread of items) {
            if (totalComments + pageCandidates.length >= maxNewComments) break;
            const comment = thread.snippet.topLevelComment.snippet;
            const text = (comment.textOriginal || '').trim();
            if (!text) continue;

            // Create unique identifier for this comment (compatible with existing stored signature)
            const commentKey = `${comment.authorDisplayName}:${comment.publishedAt}:${text.substring(0, 50)}`;

            if (existingCommentsSet.has(commentKey)) {
              skippedDuplicates++;
              continue;
            }

            // Mark as seen immediately so we don't duplicate inside the same run
            existingCommentsSet.add(commentKey);

            uniqueAuthors.add(comment.authorDisplayName);

            pageCandidates.push({
              commentText: text,
              author: comment.authorDisplayName,
              authorChannelId: comment.authorChannelId?.value,
              likeCount: comment.likeCount || 0,
              publishedAt: comment.publishedAt,
            });
          }

          // Batch sentiment analysis to avoid 429 + speed up
          for (const chunk of chunkArray(pageCandidates, BATCH_SIZE)) {
            if (chunk.length === 0) continue;
            const sentiments = await analyzeSentimentBatch(chunk.map((c) => c.commentText));
            sentimentAnalyzed += chunk.length;

            const batchToInsert = chunk.map((c, idx) => {
              const s = sentiments[idx] || { label: 'Neutro', score: 0.5 };
              return {
                user_id: userId,
                candidate_id: candidateId,
                comment_text: c.commentText.substring(0, 5000),
                comment_author: c.author,
                author_profile_url: c.authorChannelId ? `https://www.youtube.com/channel/${c.authorChannelId}` : null,
                social_network: 'YouTube',
                interaction_type: 'comment',
                sentiment_label: s.label,
                sentiment_score: s.score,
                likes_count: c.likeCount,
                replies_count: 0,
                shares_count: 0,
                original_posted_at: c.publishedAt,
                collected_at: nowIso,
              };
            });

            await insertBatch(batchToInsert);
            totalComments += chunk.length;

            if (totalComments >= maxNewComments) break;
          }

          pageToken = commentsData.nextPageToken;
          if (!pageToken) break;
        }
      } catch (videoError) {
        console.error(`Error processing video ${videoId}:`, videoError);
      }
    }
    
    console.log(`Skipped ${skippedDuplicates} duplicate comments`);
    console.log(`Found ${totalComments} new comments to insert`);

    // Calculate sentiment distribution
    const sentimentCounts = insertedRowsForStats.reduce(
      (acc, item) => {
        acc[item.sentiment_label] = (acc[item.sentiment_label] || 0) + 1;
        return acc;
      },
      { Positivo: 0, Negativo: 0, Neutro: 0 } as Record<string, number>
    );

    const totalLikes = insertedRowsForStats.reduce((sum, item) => sum + (item.likes_count || 0), 0);

    // Recalculate metrics cache for this candidate (single source of truth)
    console.log('Triggering metrics recalculation...');
    try {
      const metricsResponse = await fetch(
        `${supabaseUrl}/functions/v1/recalculate-candidate-metrics`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
          },
          body: JSON.stringify({ candidateId }),
        }
      );
      
      if (!metricsResponse.ok) {
        console.warn('Metrics recalculation returned non-OK:', await metricsResponse.text());
      } else {
        console.log('Metrics recalculated successfully');
      }
    } catch (metricsError) {
      console.warn('Failed to recalculate metrics (non-blocking):', metricsError);
    }

    // Get total count after insertion (from cache or direct count)
    const { count: totalCount } = await supabase
      .from('social_interactions')
      .select('*', { count: 'exact', head: true })
      .eq('candidate_id', candidateId)
      .eq('user_id', userId);

    const stats = {
      videosFound,
      newCommentsCollected: totalComments,
      skippedDuplicates,
      sentimentAnalyzed,
      uniqueAuthors: uniqueAuthors.size,
      totalEngagement: totalLikes,
      sentimentDistribution: sentimentCounts,
      totalCommentsInDatabase: (totalCount || 0)
    };

    console.log('Collection complete:', stats);

    return new Response(
      JSON.stringify({
        success: true,
        message: totalComments > 0 
          ? `Collected ${totalComments} NEW comments (skipped ${skippedDuplicates} duplicates). Total in database: ${totalCount}`
          : `No new comments found (${skippedDuplicates} duplicates skipped). Total in database: ${totalCount}`,
        stats
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('YouTube collection error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
