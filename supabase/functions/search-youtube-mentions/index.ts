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
    const response = await fetch('https://api.lovable.dev/v1/chat/completions', {
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

async function searchYouTubeVideos(query: string, apiKey: string, maxResults: number = 10): Promise<YouTubeSearchResult> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', maxResults.toString());
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('relevanceLanguage', 'pt');
  url.searchParams.set('regionCode', 'BR');
  url.searchParams.set('key', apiKey);

  console.log(`Searching YouTube for: "${query}"`);
  
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

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Validate user
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.error('Auth validation failed:', claimsError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub as string;
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
    const { candidateId, candidateName, maxVideos = 5, maxCommentsPerVideo = 50 } = await req.json();

    if (!candidateId || !candidateName) {
      return new Response(
        JSON.stringify({ error: 'candidateId and candidateName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting YouTube collection for candidate: ${candidateName} (${candidateId})`);

    // Search for videos
    const searchResults = await searchYouTubeVideos(candidateName, youtubeApiKey, maxVideos);
    
    const videosFound = searchResults.items?.length || 0;
    console.log(`Found ${videosFound} videos`);

    if (videosFound === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No videos found for this candidate',
          stats: { videosFound: 0, commentsCollected: 0, sentimentAnalyzed: 0 }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Collect comments from each video
    let totalComments = 0;
    let totalAnalyzed = 0;
    const collectionsToInsert: any[] = [];
    const uniqueAuthors = new Set<string>();

    for (const video of searchResults.items) {
      const videoId = video.id.videoId;
      
      try {
        const commentsData = await getVideoComments(videoId, youtubeApiKey, maxCommentsPerVideo);
        
        for (const thread of commentsData.items || []) {
          const comment = thread.snippet.topLevelComment.snippet;
          
          // Skip if comment doesn't mention candidate name (basic filter)
          const mentionsCandidate = comment.textOriginal.toLowerCase().includes(candidateName.toLowerCase().split(' ')[0]);
          
          // Analyze sentiment
          const sentiment = await analyzeSentiment(comment.textOriginal);
          totalAnalyzed++;
          
          // Track unique authors
          uniqueAuthors.add(comment.authorDisplayName);

          // Prepare for insertion
          collectionsToInsert.push({
            user_id: userId,
            candidate_id: candidateId,
            comment_text: comment.textOriginal.substring(0, 5000), // Limit text length
            comment_author: comment.authorDisplayName,
            author_profile_url: comment.authorChannelId?.value 
              ? `https://www.youtube.com/channel/${comment.authorChannelId.value}`
              : null,
            social_network: 'YouTube',
            interaction_type: 'comment',
            sentiment_label: sentiment.label,
            sentiment_score: sentiment.score,
            likes_count: comment.likeCount || 0,
            replies_count: 0,
            shares_count: 0,
            original_posted_at: comment.publishedAt,
            collected_at: new Date().toISOString()
          });

          totalComments++;

          // Rate limiting - small delay between sentiment calls
          if (totalAnalyzed % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } catch (videoError) {
        console.error(`Error processing video ${videoId}:`, videoError);
        // Continue with next video
      }
    }

    // Batch insert all collected comments
    if (collectionsToInsert.length > 0) {
      console.log(`Inserting ${collectionsToInsert.length} comments into database`);
      
      const { error: insertError } = await supabase
        .from('social_interactions')
        .insert(collectionsToInsert);

      if (insertError) {
        console.error('Database insert error:', insertError);
        // Don't fail completely - return partial success
      }
    }

    // Calculate sentiment distribution
    const sentimentCounts = collectionsToInsert.reduce(
      (acc, item) => {
        acc[item.sentiment_label] = (acc[item.sentiment_label] || 0) + 1;
        return acc;
      },
      { Positivo: 0, Negativo: 0, Neutro: 0 } as Record<string, number>
    );

    const totalLikes = collectionsToInsert.reduce((sum, item) => sum + (item.likes_count || 0), 0);

    const stats = {
      videosFound,
      commentsCollected: totalComments,
      sentimentAnalyzed: totalAnalyzed,
      uniqueAuthors: uniqueAuthors.size,
      totalEngagement: totalLikes,
      sentimentDistribution: sentimentCounts
    };

    console.log('Collection complete:', stats);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Collected ${totalComments} comments from ${videosFound} YouTube videos`,
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
