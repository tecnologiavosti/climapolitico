import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface NetworkMetrics {
  network: string;
  mentions: number;
  engagement: number;
  avgSentiment: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseService = createClient(supabaseUrl, supabaseServiceRoleKey);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabaseService.auth.getUser(token);

    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    const { candidateId } = await req.json();

    if (!candidateId) {
      return new Response(
        JSON.stringify({ error: 'candidateId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Recalculating metrics for candidate ${candidateId}, user ${userId}`);

    // Fetch ALL interactions with pagination to bypass 1000-row limit
    let allInteractions: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await supabase
        .from('social_interactions')
        .select('id, sentiment_label, sentiment_score, likes_count, replies_count, shares_count, social_network, comment_author')
        .eq('candidate_id', candidateId)
        .eq('user_id', userId)
        .range(offset, offset + pageSize - 1);

      if (pageError) {
        console.error('Failed to fetch interactions page:', pageError);
        throw pageError;
      }

      if (!page || page.length === 0) break;

      allInteractions = [...allInteractions, ...page];
      console.log(`Fetched page ${Math.floor(offset / pageSize) + 1}: ${page.length} rows (total: ${allInteractions.length})`);

      if (page.length < pageSize) break; // Last page
      offset += pageSize;
    }

    const interactions = allInteractions;

    // Fetch candidate followers for reach score
    const { data: candidate } = await supabase
      .from('candidates')
      .select('followers')
      .eq('id', candidateId)
      .maybeSingle();

    // Calculate metrics
    const totalMentions = interactions?.length || 0;
    
    const uniqueAuthorsSet = new Set<string>();
    interactions?.forEach(i => {
      if (i.comment_author) uniqueAuthorsSet.add(i.comment_author);
    });
    const uniqueAuthors = uniqueAuthorsSet.size;

    const totalLikes = interactions?.reduce((sum, i) => sum + (i.likes_count || 0), 0) || 0;
    const totalReplies = interactions?.reduce((sum, i) => sum + (i.replies_count || 0), 0) || 0;
    const totalShares = interactions?.reduce((sum, i) => sum + (i.shares_count || 0), 0) || 0;
    const totalEngagement = totalLikes + totalReplies + totalShares;

    // Sentiment counts
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;
    let sentimentSum = 0;
    let analyzedSentimentCount = 0;
    let unanalyzedSentimentCount = 0;

    interactions?.forEach(i => {
      // Se não há sentimento (NULL), NÃO contar como Neutro e NÃO usar 0.5 como fallback.
      if (!i.sentiment_label || i.sentiment_score === null || i.sentiment_score === undefined) {
        unanalyzedSentimentCount++;
        return;
      }

      analyzedSentimentCount++;
      if (i.sentiment_label === 'Positivo') positiveCount++;
      else if (i.sentiment_label === 'Negativo') negativeCount++;
      else neutralCount++;

      sentimentSum += i.sentiment_score * 100;
    });

    const averageSentiment = analyzedSentimentCount > 0 
      ? Math.round(sentimentSum / analyzedSentimentCount) 
      : 50;

    // Network breakdown
    const networkMap: Record<string, { mentions: number; engagement: number; sentimentSum: number; analyzedCount: number }> = {};
    
    interactions?.forEach(i => {
      const network = i.social_network || 'Outro';
      if (!networkMap[network]) {
        networkMap[network] = { mentions: 0, engagement: 0, sentimentSum: 0, analyzedCount: 0 };
      }
      networkMap[network].mentions++;
      networkMap[network].engagement += (i.likes_count || 0) + (i.replies_count || 0) + (i.shares_count || 0);

      if (i.sentiment_label && i.sentiment_score !== null && i.sentiment_score !== undefined) {
        networkMap[network].sentimentSum += i.sentiment_score * 100;
        networkMap[network].analyzedCount++;
      }
    });

    const networkBreakdown: NetworkMetrics[] = Object.entries(networkMap).map(([network, data]) => ({
      network,
      mentions: data.mentions,
      engagement: data.engagement,
      avgSentiment: data.analyzedCount > 0 ? Math.round(data.sentimentSum / data.analyzedCount) : 50
    })).sort((a, b) => b.mentions - a.mentions);

    // Upsert into cache table
    const cacheData = {
      user_id: userId,
      candidate_id: candidateId,
      total_mentions: totalMentions,
      unique_authors: uniqueAuthors,
      total_engagement: totalEngagement,
      total_likes: totalLikes,
      total_replies: totalReplies,
      total_shares: totalShares,
      positive_count: positiveCount,
      neutral_count: neutralCount,
      negative_count: negativeCount,
      average_sentiment: averageSentiment,
      network_breakdown: networkBreakdown,
      followers_count: candidate?.followers || null,
      last_calculated_at: new Date().toISOString(),
    };

    // Check if cache exists
    const { data: existingCache } = await supabase
      .from('candidate_metrics_cache')
      .select('id')
      .eq('user_id', userId)
      .eq('candidate_id', candidateId)
      .single();

    if (existingCache) {
      // Update existing
      const { error: updateError } = await supabase
        .from('candidate_metrics_cache')
        .update(cacheData)
        .eq('id', existingCache.id);
      
      if (updateError) {
        console.error('Failed to update cache:', updateError);
        throw updateError;
      }
    } else {
      // Insert new
      const { error: insertError } = await supabase
        .from('candidate_metrics_cache')
        .insert(cacheData);
      
      if (insertError) {
        console.error('Failed to insert cache:', insertError);
        throw insertError;
      }
    }

    // Also update the candidates table for backward compatibility
    const { error: candidateUpdateError } = await supabase
      .from('candidates')
      .update({
        mentions: totalMentions,
        sentiment: averageSentiment,
        last_analysis_at: new Date().toISOString(),
      })
      .eq('id', candidateId)
      .eq('user_id', userId);

    if (candidateUpdateError) {
      console.warn('Failed to update candidate (non-critical):', candidateUpdateError);
    }

    console.log('Metrics recalculated:', cacheData);
    console.log(`Sentimento: analisados=${analyzedSentimentCount}, sem_análise=${unanalyzedSentimentCount} (NULL)`);

    return new Response(
      JSON.stringify({
        success: true,
        metrics: cacheData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Recalculate metrics error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
