import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface SocialInteraction {
  id: string;
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
  refreshInterval: number = 60000
): UseRealTimeAnalyticsReturn => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<RealTimeMetrics | null>(null);
  const [comments, setComments] = useState<SocialInteraction[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAggregatedMetrics = useCallback(async () => {
    if (!user || candidateIds.length === 0) return;

    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const { data: interactions, error: fetchError } = await supabase
        .from('social_interactions')
        .select('*')
        .in('candidate_id', candidateIds)
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      const data = interactions || [];
      
      // Calculate metrics
      const totalMentions = data.length;
      const positiveMentions = data.filter(i => i.sentiment_label === 'Positivo').length;
      const negativeMentions = data.filter(i => i.sentiment_label === 'Negativo').length;
      const neutralMentions = data.filter(i => i.sentiment_label === 'Neutro').length;
      
      // Sentiment score (0-100)
      const sentimentScore = totalMentions > 0 
        ? Math.round(((positiveMentions - negativeMentions) / totalMentions + 1) * 50) 
        : 50;

      // Engagement per minute (last 10 minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const recentInteractions = data.filter(i => i.created_at >= tenMinutesAgo);
      const engagementPerMinute = Math.round(recentInteractions.length / 10 * 10) / 10;

      // Trend calculation (comparing last 30min to previous 30min)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const last30 = data.filter(i => i.created_at >= thirtyMinutesAgo).length;
      const previous30 = data.filter(i => 
        i.created_at < thirtyMinutesAgo && i.created_at >= oneHourAgo
      ).length;
      const trend: 'up' | 'down' | 'stable' = 
        last30 > previous30 * 1.1 ? 'up' : 
        last30 < previous30 * 0.9 ? 'down' : 'stable';

      // Mentions by network
      const networkCounts: Record<string, number> = {};
      data.forEach(i => {
        networkCounts[i.social_network] = (networkCounts[i.social_network] || 0) + 1;
      });
      const mentionsByNetwork = Object.entries(networkCounts)
        .map(([network, count]) => ({ network, count }))
        .sort((a, b) => b.count - a.count);

      // Sentiment history (last 60 minutes, 5-minute buckets)
      const sentimentHistory: { time: string; positive: number; neutral: number; negative: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const bucketStart = new Date(Date.now() - (i + 1) * 5 * 60 * 1000);
        const bucketEnd = new Date(Date.now() - i * 5 * 60 * 1000);
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

      setMetrics({
        totalMentions,
        positiveMentions,
        negativeMentions,
        neutralMentions,
        sentimentScore,
        engagementPerMinute,
        trend,
        mentionsByNetwork,
        sentimentHistory,
      });

      setComments(data.slice(0, 50) as SocialInteraction[]);
      setError(null);
    } catch (err) {
      console.error('Error fetching metrics:', err);
      setError('Erro ao carregar métricas');
    } finally {
      setIsLoading(false);
    }
  }, [user, candidateIds]);

  // Realtime subscription
  useEffect(() => {
    if (!user || candidateIds.length === 0) {
      setIsConnected(false);
      return;
    }

    const channel = supabase
      .channel('realtime-monitor')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'social_interactions',
        },
        (payload) => {
          const newInteraction = payload.new as SocialInteraction;
          if (candidateIds.includes(newInteraction.candidate_id)) {
            setComments(prev => [newInteraction, ...prev.slice(0, 49)]);
            // Trigger metrics refresh on new data
            fetchAggregatedMetrics();
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        console.log('Realtime subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, candidateIds, fetchAggregatedMetrics]);

  // Initial fetch and interval refresh
  useEffect(() => {
    fetchAggregatedMetrics();

    const interval = setInterval(fetchAggregatedMetrics, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchAggregatedMetrics, refreshInterval]);

  return {
    metrics,
    comments,
    isConnected,
    isLoading,
    error,
    refreshMetrics: fetchAggregatedMetrics,
  };
};
