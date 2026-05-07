import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface SocialInteraction {
  id: string;
  user_id: string;
  candidate_id: string;
  comment_text: string | null;
  comment_author: string | null;
  author_profile_url: string | null;
  social_network: string;
  interaction_type: string;
  sentiment_label: string | null;
  sentiment_score: number | null;
  likes_count: number;
  replies_count: number;
  shares_count: number;
  original_posted_at: string | null;
  collected_at: string;
  created_at: string;
}

export interface RealTimeMetrics {
  totalMentions: number;
  positiveMentions: number;
  negativeMentions: number;
  neutralMentions: number;
  sentimentScore: number;
  totalEngagement: number;
  engagementPerMinute: number;
  trend: 'up' | 'down' | 'stable';
  mentionsByNetwork: { network: string; count: number }[];
  sentimentHistory: { time: string; positive: number; neutral: number; negative: number }[];
}

interface UseRealTimeAnalyticsReturn {
  metrics: RealTimeMetrics | null;
  comments: SocialInteraction[];
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  refreshMetrics: () => Promise<void>;
}

export const useRealTimeAnalytics = (
  candidateIds: string[],
  refreshInterval: number = 600000 // 10 minutes default
): UseRealTimeAnalyticsReturn => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<RealTimeMetrics | null>(null);
  const [comments, setComments] = useState<SocialInteraction[]>([]);
  const [isConnected, setIsConnected] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Use refs to avoid dependency issues
  const candidateIdsRef = useRef<string[]>(candidateIds);
  const isFetchingRef = useRef(false);
  const hasFetchedRef = useRef(false);
  
  // Compute stable key for candidateIds to use in dependencies
  const candidateIdsKey = candidateIds.join(',');
  
  // Update ref when candidateIds change
  useEffect(() => {
    candidateIdsRef.current = candidateIds;
  }, [candidateIds]);

  const fetchAggregatedMetrics = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      console.log('[Monitor] Fetch already in progress, skipping');
      return;
    }

    try {
      isFetchingRef.current = true;
      setIsLoading(true);
      
      const currentCandidateIds = candidateIdsRef.current;
      
      // First get total count (bypasses 1000 row limit)
      let countQuery = supabase
        .from('social_interactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .not('social_network', 'in', '(mastodon,lemmy)');
      
      if (currentCandidateIds.length > 0) {
        countQuery = countQuery.in('candidate_id', currentCandidateIds);
      }
      
      const { count: totalCount } = await countQuery;
      
      // Then fetch all data with pagination to get accurate metrics
      let allInteractions: any[] = [];
      let offset = 0;
      const pageSize = 1000;
      
      while (true) {
        let query = supabase
          .from('social_interactions')
          .select('*')
          .eq('user_id', user.id)
          .not('social_network', 'in', '(mastodon,lemmy)')
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (currentCandidateIds.length > 0) {
          query = query.in('candidate_id', currentCandidateIds);
        }

        const { data: page, error: pageError } = await query;
        
        if (pageError) {
          console.error('Error fetching interactions page:', pageError);
          break;
        }
        
        if (!page || page.length === 0) break;
        
        allInteractions = [...allInteractions, ...page];
        
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      const data = allInteractions;
      
      console.log(`[Monitor] Fetched ${data.length} interactions (total count: ${totalCount}) for user ${user.id}`);
      
      // Calculate metrics from ALL data
      const positiveMentions = data.filter(i => i.sentiment_label === 'Positivo').length;
      const negativeMentions = data.filter(i => i.sentiment_label === 'Negativo').length;
      const neutralMentions = data.filter(i => i.sentiment_label === 'Neutro').length;
      // Total exibido = soma das três classes (pos+neu+neg). Garante consistência visual.
      const totalMentions = positiveMentions + negativeMentions + neutralMentions;
      const totalCollected = totalCount || data.length;
      
      // Total engagement (sum of likes)
      const totalEngagement = data.reduce((sum, i) => sum + (i.likes_count || 0), 0);
      
      // Sentiment score (0-100)
      const sentimentScore = totalMentions > 0 
        ? Math.round(((positiveMentions - negativeMentions) / totalMentions + 1) * 50) 
        : 50;

      // Engagement per minute (based on data from last 60 minutes)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recentInteractions = data.filter(i => i.created_at >= oneHourAgo);
      const engagementPerMinute = recentInteractions.length > 0 
        ? Math.round(recentInteractions.length / 60 * 10) / 10 
        : 0;

      // Trend calculation (comparing recent data to older data)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const last30 = data.filter(i => i.created_at >= thirtyMinutesAgo).length;
      const previous30 = data.filter(i => 
        i.created_at < thirtyMinutesAgo && i.created_at >= oneHourAgo
      ).length;
      
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (last30 > 0 || previous30 > 0) {
        trend = last30 > previous30 * 1.1 ? 'up' : 
                last30 < previous30 * 0.9 ? 'down' : 'stable';
      }

      // Mentions by network
      const networkCounts: Record<string, number> = {};
      data.forEach(i => {
        networkCounts[i.social_network] = (networkCounts[i.social_network] || 0) + 1;
      });
      const { isHiddenNetwork } = await import('@/lib/networkVisibility');
      const mentionsByNetwork = Object.entries(networkCounts)
        .filter(([network]) => !isHiddenNetwork(network))
        .map(([network, count]) => ({ network, count }))
        .sort((a, b) => b.count - a.count);

      // Sentiment history
      const sentimentHistory: { time: string; positive: number; neutral: number; negative: number }[] = [];
      
      if (data.length > 0) {
        const oldestData = new Date(data[data.length - 1].created_at);
        const now = new Date();
        const daysDiff = Math.ceil((now.getTime() - oldestData.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff > 1) {
          // Use daily buckets for the last 7 days
          for (let i = 6; i >= 0; i--) {
            const dayStart = new Date(now);
            dayStart.setDate(dayStart.getDate() - i);
            dayStart.setHours(0, 0, 0, 0);
            
            const dayEnd = new Date(dayStart);
            dayEnd.setDate(dayEnd.getDate() + 1);
            
            const bucketData = data.filter(d => {
              const time = new Date(d.created_at);
              return time >= dayStart && time < dayEnd;
            });
            
            sentimentHistory.push({
              time: dayStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
              positive: bucketData.filter(d => d.sentiment_label === 'Positivo').length,
              neutral: bucketData.filter(d => d.sentiment_label === 'Neutro').length,
              negative: bucketData.filter(d => d.sentiment_label === 'Negativo').length,
            });
          }
        } else {
          // Use hourly buckets for the last 12 hours
          for (let i = 11; i >= 0; i--) {
            const bucketStart = new Date(Date.now() - (i + 1) * 60 * 60 * 1000);
            const bucketEnd = new Date(Date.now() - i * 60 * 60 * 1000);
            const bucketData = data.filter(d => {
              const time = new Date(d.created_at);
              return time >= bucketStart && time < bucketEnd;
            });
            sentimentHistory.push({
              time: bucketEnd.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              positive: bucketData.filter(d => d.sentiment_label === 'Positivo').length,
              neutral: bucketData.filter(d => d.sentiment_label === 'Neutro').length,
              negative: bucketData.filter(d => d.sentiment_label === 'Negativo').length,
            });
          }
        }
      }

      setMetrics({
        totalMentions,
        positiveMentions,
        negativeMentions,
        neutralMentions,
        sentimentScore,
        totalEngagement,
        engagementPerMinute,
        trend,
        mentionsByNetwork,
        sentimentHistory,
      });

      // Set comments (most recent 50, deduplicated by normalized text — defesa extra)
      const seenTexts = new Set<string>();
      const uniqueComments: SocialInteraction[] = [];
      for (const item of data as SocialInteraction[]) {
        const key = (item.comment_text || "").trim().toLowerCase();
        if (!key) continue;
        if (seenTexts.has(key)) continue;
        seenTexts.add(key);
        uniqueComments.push(item);
        if (uniqueComments.length >= 50) break;
      }
      setComments(uniqueComments);
      setError(null);
    } catch (err) {
      console.error('Error fetching metrics:', err);
      setError('Erro ao carregar métricas. Verifique a conexão.');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [user]); // Only depend on user, not candidateIds

  // Initial fetch - run once when user is available
  useEffect(() => {
    if (user && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchAggregatedMetrics();
    }
  }, [user, fetchAggregatedMetrics]);

  // Refetch when candidateIds change
  useEffect(() => {
    if (user && hasFetchedRef.current) {
      fetchAggregatedMetrics();
    }
  }, [candidateIdsKey, user, fetchAggregatedMetrics]);

  // Interval refresh
  useEffect(() => {
    if (!user) return;
    
    const interval = setInterval(() => {
      fetchAggregatedMetrics();
    }, refreshInterval);
    
    return () => clearInterval(interval);
  }, [user, refreshInterval, fetchAggregatedMetrics]);

  return {
    metrics,
    comments,
    isConnected,
    isLoading,
    error,
    refreshMetrics: fetchAggregatedMetrics,
  };
};
