import { useState, useEffect, useCallback } from "react";
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
  refreshInterval: number = 60000
): UseRealTimeAnalyticsReturn => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<RealTimeMetrics | null>(null);
  const [comments, setComments] = useState<SocialInteraction[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAggregatedMetrics = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      
      // Build query based on whether candidate IDs are provided
      let query = supabase
        .from('social_interactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      // If specific candidates are selected, filter by them
      if (candidateIds.length > 0) {
        query = query.in('candidate_id', candidateIds);
      }

      const { data: interactions, error: fetchError } = await query;

      if (fetchError) {
        console.error('Error fetching interactions:', fetchError);
        throw fetchError;
      }

      const data = interactions || [];
      
      console.log(`[Monitor] Fetched ${data.length} interactions for user ${user.id}`);
      
      // Calculate metrics from ALL data
      const totalMentions = data.length;
      const positiveMentions = data.filter(i => i.sentiment_label === 'Positivo').length;
      const negativeMentions = data.filter(i => i.sentiment_label === 'Negativo').length;
      const neutralMentions = data.filter(i => i.sentiment_label === 'Neutro').length;
      
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
      const mentionsByNetwork = Object.entries(networkCounts)
        .map(([network, count]) => ({ network, count }))
        .sort((a, b) => b.count - a.count);

      // Sentiment history (last 60 minutes, 5-minute buckets)
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

      // Set comments (most recent 50)
      setComments(data.slice(0, 50) as SocialInteraction[]);
      setError(null);
    } catch (err) {
      console.error('Error fetching metrics:', err);
      setError('Erro ao carregar métricas. Verifique a conexão.');
    } finally {
      setIsLoading(false);
    }
  }, [user, candidateIds]);

  // Realtime subscription disabled - using polling every 10 minutes instead
  // to prevent layout bugs and reduce server load
  useEffect(() => {
    setIsConnected(true); // Always show as "connected" since we use polling
  }, []);

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
