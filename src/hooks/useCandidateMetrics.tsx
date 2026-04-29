import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useAdminCheck } from "./useAdminCheck";
import type { Json } from "@/integrations/supabase/types";

export interface CandidateMetrics {
  candidateId: string;
  totalMentions: number;
  uniqueAuthors: number;
  totalEngagement: number;
  totalLikes: number;
  totalReplies: number;
  totalShares: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  averageSentiment: number;
  networkBreakdown: Array<{
    network: string;
    mentions: number;
    engagement: number;
    avgSentiment: number;
  }>;
  followersCount: string | null;
  lastCalculatedAt: string | null;
  // Derived properties
  dominantSentiment: 'Positivo' | 'Negativo' | 'Neutro';
  dataConfidence: 'high' | 'medium' | 'low';
  analysisCount: number;
  lastAnalysisDate: string | null;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
}

interface NetworkBreakdownItem {
  network: string;
  mentions: number;
  engagement: number;
  avgSentiment: number;
}

function parseNetworkBreakdown(data: Json): NetworkBreakdownItem[] {
  if (!Array.isArray(data)) return [];
  return data.map((item: Json) => {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const obj = item as Record<string, Json>;
      return {
        network: typeof obj.network === 'string' ? obj.network : 'Outro',
        mentions: typeof obj.mentions === 'number' ? obj.mentions : 0,
        engagement: typeof obj.engagement === 'number' ? obj.engagement : 0,
        avgSentiment: typeof obj.avgSentiment === 'number' ? obj.avgSentiment : 50,
      };
    }
    return { network: 'Outro', mentions: 0, engagement: 0, avgSentiment: 50 };
  });
}

/**
 * Hook to fetch cached metrics for a single candidate (user-scoped)
 */
export function useCandidateMetrics(candidateId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['candidate-metrics-cache', candidateId, user?.id],
    queryFn: async (): Promise<CandidateMetrics | null> => {
      if (!candidateId || !user) return null;

      const { data, error } = await supabase
        .from('candidate_metrics_cache')
        .select('*')
        .eq('candidate_id', candidateId)
        .eq('user_id', user.id)
        .single();

      if (error) {
        // No cache yet - try to calculate on-the-fly from social_interactions
        console.log('No metrics cache found, calculating on-the-fly...');
        return await calculateMetricsOnTheFly(candidateId, user.id);
      }

      // Calculate derived properties
      const totalSentiment = data.positive_count + data.neutral_count + data.negative_count;
      const sentimentDistribution = {
        positive: totalSentiment > 0 ? Math.round((data.positive_count / totalSentiment) * 100) : 33,
        neutral: totalSentiment > 0 ? Math.round((data.neutral_count / totalSentiment) * 100) : 34,
        negative: totalSentiment > 0 ? Math.round((data.negative_count / totalSentiment) * 100) : 33,
      };

      let dominantSentiment: 'Positivo' | 'Negativo' | 'Neutro' = 'Neutro';
      if (data.positive_count > data.neutral_count && data.positive_count > data.negative_count) {
        dominantSentiment = 'Positivo';
      } else if (data.negative_count > data.neutral_count && data.negative_count > data.positive_count) {
        dominantSentiment = 'Negativo';
      }

      let dataConfidence: 'high' | 'medium' | 'low' = 'low';
      if (data.total_mentions > 500 && data.unique_authors > 100) {
        dataConfidence = 'high';
      } else if (data.total_mentions > 100 && data.unique_authors > 20) {
        dataConfidence = 'medium';
      }

      return {
        candidateId: data.candidate_id,
        totalMentions: data.total_mentions,
        uniqueAuthors: data.unique_authors,
        totalEngagement: data.total_engagement,
        totalLikes: data.total_likes,
        totalReplies: data.total_replies,
        totalShares: data.total_shares,
        positiveCount: data.positive_count,
        neutralCount: data.neutral_count,
        negativeCount: data.negative_count,
        averageSentiment: data.average_sentiment ?? 50,
        networkBreakdown: parseNetworkBreakdown(data.network_breakdown),
        followersCount: data.followers_count,
        lastCalculatedAt: data.last_calculated_at,
        dominantSentiment,
        dataConfidence,
        analysisCount: data.total_mentions > 0 ? 1 : 0,
        lastAnalysisDate: data.last_calculated_at,
        sentimentDistribution,
      };
    },
    enabled: !!candidateId && !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch cached metrics for ALL candidates of the current user
 */
export function useAllCandidateMetrics() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();

  return useQuery({
    queryKey: ['all-candidate-metrics-cache', user?.id, isAdmin],
    queryFn: async (): Promise<CandidateMetrics[]> => {
      if (!user) return [];

      let query = supabase
        .from('candidate_metrics_cache')
        .select('*');

      if (!isAdmin) {
        query = query.eq('user_id', user.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Failed to fetch metrics cache:', error);
        return [];
      }

      return (data || []).map(item => {
        const totalSentiment = item.positive_count + item.neutral_count + item.negative_count;
        const sentimentDistribution = {
          positive: totalSentiment > 0 ? Math.round((item.positive_count / totalSentiment) * 100) : 33,
          neutral: totalSentiment > 0 ? Math.round((item.neutral_count / totalSentiment) * 100) : 34,
          negative: totalSentiment > 0 ? Math.round((item.negative_count / totalSentiment) * 100) : 33,
        };

        let dominantSentiment: 'Positivo' | 'Negativo' | 'Neutro' = 'Neutro';
        if (item.positive_count > item.neutral_count && item.positive_count > item.negative_count) {
          dominantSentiment = 'Positivo';
        } else if (item.negative_count > item.neutral_count && item.negative_count > item.positive_count) {
          dominantSentiment = 'Negativo';
        }

        let dataConfidence: 'high' | 'medium' | 'low' = 'low';
        if (item.total_mentions > 500 && item.unique_authors > 100) {
          dataConfidence = 'high';
        } else if (item.total_mentions > 100 && item.unique_authors > 20) {
          dataConfidence = 'medium';
        }

        return {
          candidateId: item.candidate_id,
          totalMentions: item.total_mentions,
          uniqueAuthors: item.unique_authors,
          totalEngagement: item.total_engagement,
          totalLikes: item.total_likes,
          totalReplies: item.total_replies,
          totalShares: item.total_shares,
          positiveCount: item.positive_count,
          neutralCount: item.neutral_count,
          negativeCount: item.negative_count,
          averageSentiment: item.average_sentiment ?? 50,
          networkBreakdown: parseNetworkBreakdown(item.network_breakdown),
          followersCount: item.followers_count,
          lastCalculatedAt: item.last_calculated_at,
          dominantSentiment,
          dataConfidence,
          analysisCount: item.total_mentions > 0 ? 1 : 0,
          lastAnalysisDate: item.last_calculated_at,
          sentimentDistribution,
        };
      });
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Fallback: calculate metrics directly from social_interactions if no cache exists
 */
async function calculateMetricsOnTheFly(candidateId: string, userId: string): Promise<CandidateMetrics | null> {
  // Use count() to get total without 1000-row limit, then fetch sample for sentiment breakdown
  const { count: totalCount, error: countError } = await supabase
    .from('social_interactions')
    .select('*', { count: 'exact', head: true })
    .eq('candidate_id', candidateId)
    .eq('user_id', userId);

  if (countError) {
    console.error('Failed to count interactions:', countError);
    return null;
  }

  const totalMentions = totalCount || 0;

  // Fetch all data for accurate metrics (paginated if needed)
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
      break;
    }

    if (!page || page.length === 0) break;
    
    allInteractions = [...allInteractions, ...page];
    
    if (page.length < pageSize) break; // Last page
    offset += pageSize;
  }

  const interactions = allInteractions;

  // Use the fetched count if available, otherwise use array length
  
  const uniqueAuthorsSet = new Set<string>();
  interactions.forEach(i => {
    if (i.comment_author) uniqueAuthorsSet.add(i.comment_author);
  });
  const uniqueAuthors = uniqueAuthorsSet.size;

  const totalLikes = interactions.reduce((sum, i) => sum + (i.likes_count || 0), 0);
  const totalReplies = interactions.reduce((sum, i) => sum + (i.replies_count || 0), 0);
  const totalShares = interactions.reduce((sum, i) => sum + (i.shares_count || 0), 0);
  const totalEngagement = totalLikes + totalReplies + totalShares;

  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;
  let sentimentSum = 0;

  interactions.forEach(i => {
    if (i.sentiment_label === 'Positivo') positiveCount++;
    else if (i.sentiment_label === 'Negativo') negativeCount++;
    else neutralCount++;
    sentimentSum += (i.sentiment_score || 0.5) * 100;
  });

  const averageSentiment = totalMentions > 0 ? Math.round(sentimentSum / totalMentions) : 50;

  // Network breakdown
  const networkMap: Record<string, { mentions: number; engagement: number; sentimentSum: number; count: number }> = {};
  
  interactions.forEach(i => {
    const network = i.social_network || 'Outro';
    if (!networkMap[network]) {
      networkMap[network] = { mentions: 0, engagement: 0, sentimentSum: 0, count: 0 };
    }
    networkMap[network].mentions++;
    networkMap[network].engagement += (i.likes_count || 0) + (i.replies_count || 0) + (i.shares_count || 0);
    networkMap[network].sentimentSum += (i.sentiment_score || 0.5) * 100;
    networkMap[network].count++;
  });

  const networkBreakdown = Object.entries(networkMap).map(([network, data]) => ({
    network,
    mentions: data.mentions,
    engagement: data.engagement,
    avgSentiment: data.count > 0 ? Math.round(data.sentimentSum / data.count) : 50
  })).sort((a, b) => b.mentions - a.mentions);

  // Calculate derived properties
  const totalSentiment = positiveCount + neutralCount + negativeCount;
  const sentimentDistribution = {
    positive: totalSentiment > 0 ? Math.round((positiveCount / totalSentiment) * 100) : 33,
    neutral: totalSentiment > 0 ? Math.round((neutralCount / totalSentiment) * 100) : 34,
    negative: totalSentiment > 0 ? Math.round((negativeCount / totalSentiment) * 100) : 33,
  };

  let dominantSentiment: 'Positivo' | 'Negativo' | 'Neutro' = 'Neutro';
  if (positiveCount > neutralCount && positiveCount > negativeCount) {
    dominantSentiment = 'Positivo';
  } else if (negativeCount > neutralCount && negativeCount > positiveCount) {
    dominantSentiment = 'Negativo';
  }

  let dataConfidence: 'high' | 'medium' | 'low' = 'low';
  if (totalMentions > 500 && uniqueAuthors > 100) {
    dataConfidence = 'high';
  } else if (totalMentions > 100 && uniqueAuthors > 20) {
    dataConfidence = 'medium';
  }

  return {
    candidateId,
    totalMentions,
    uniqueAuthors,
    totalEngagement,
    totalLikes,
    totalReplies,
    totalShares,
    positiveCount,
    neutralCount,
    negativeCount,
    averageSentiment,
    networkBreakdown,
    followersCount: null,
    lastCalculatedAt: null,
    dominantSentiment,
    dataConfidence,
    analysisCount: totalMentions > 0 ? 1 : 0,
    lastAnalysisDate: null,
    sentimentDistribution,
  };
}
