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
        averageSentiment: data.average_sentiment,
        networkBreakdown: parseNetworkBreakdown(data.network_breakdown),
        followersCount: data.followers_count,
        lastCalculatedAt: data.last_calculated_at,
      };
    },
    enabled: !!candidateId && !!user,
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

      return (data || []).map(item => ({
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
        averageSentiment: item.average_sentiment,
        networkBreakdown: parseNetworkBreakdown(item.network_breakdown),
        followersCount: item.followers_count,
        lastCalculatedAt: item.last_calculated_at,
      }));
    },
    enabled: !!user,
  });
}

/**
 * Fallback: calculate metrics directly from social_interactions if no cache exists
 */
async function calculateMetricsOnTheFly(candidateId: string, userId: string): Promise<CandidateMetrics | null> {
  const { data: interactions, error } = await supabase
    .from('social_interactions')
    .select('id, sentiment_label, sentiment_score, likes_count, replies_count, shares_count, social_network, comment_author')
    .eq('candidate_id', candidateId)
    .eq('user_id', userId);

  if (error || !interactions) {
    console.error('Failed to calculate metrics on-the-fly:', error);
    return null;
  }

  const totalMentions = interactions.length;
  
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
  };
}
