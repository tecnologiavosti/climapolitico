import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalize region name to standard format
function normalizeRegion(region: string | null): string {
  if (!region) return 'NACIONAL';
  const normalized = region.trim().toUpperCase();
  
  const regionMap: Record<string, string> = {
    'BRASIL': 'NACIONAL', 'BR': 'NACIONAL', 'NACIONAL': 'NACIONAL',
    'DF': 'DISTRITO FEDERAL', 'SP': 'SÃO PAULO', 'SAO PAULO': 'SÃO PAULO',
    'RJ': 'RIO DE JANEIRO', 'MG': 'MINAS GERAIS', 'BA': 'BAHIA',
    'PR': 'PARANÁ', 'RS': 'RIO GRANDE DO SUL', 'PE': 'PERNAMBUCO',
    'CE': 'CEARÁ', 'PA': 'PARÁ', 'SC': 'SANTA CATARINA'
  };
  
  return regionMap[normalized] || normalized;
}

// Helper: Parse follower count string to number
function parseFollowerCount(followers: string | null): number {
  if (!followers) return 0;
  
  const str = followers.toLowerCase().trim();
  const match = str.match(/^([\d.]+)([km]?)$/);
  if (!match) return 0;
  
  const num = parseFloat(match[1]);
  const multiplier = match[2] === 'k' ? 1000 : match[2] === 'm' ? 1000000 : 1;
  
  return num * multiplier;
}

// 1. Reach Score (0-100)
function calculateReachScore(followers: string | null): number {
  if (!followers) return 0;
  
  const num = parseFollowerCount(followers);
  const maxFollowers = 10_000_000;
  const score = Math.min(100, (Math.log10(num + 1) / Math.log10(maxFollowers)) * 100);
  
  return Math.round(score * 100) / 100;
}

// 2. Engagement Score (0-100)
function calculateEngagementScore(mentions: number, analysesCount: number): number {
  if (analysesCount === 0) return 0;
  
  const avgMentionsPerAnalysis = mentions / analysesCount;
  const maxMentions = 2000;
  const score = Math.min(100, (avgMentionsPerAnalysis / maxMentions) * 100);
  
  return Math.round(score * 100) / 100;
}

// 3. Sentiment Score (0-100)
function calculateSentimentScore(
  positiveCount: number,
  negativeCount: number,
  neutralCount: number
): { positive: number; negative: number; sentimentScore: number } {
  const total = positiveCount + negativeCount + neutralCount;
  if (total === 0) return { positive: 0, negative: 0, sentimentScore: 50 };
  
  const positivePercent = (positiveCount / total) * 100;
  const negativePercent = (negativeCount / total) * 100;
  
  const sentimentScore = positivePercent - (negativePercent * 0.5);
  
  return {
    positive: Math.round(positivePercent * 100) / 100,
    negative: Math.round(negativePercent * 100) / 100,
    sentimentScore: Math.max(0, Math.min(100, sentimentScore))
  };
}

// 4. Speech Impact Score (0-100)
function calculateSpeechImpactScore(speeches: any[]): number {
  if (speeches.length === 0) return 50;
  
  const avgRisk = speeches.reduce((sum, s) => sum + (s.risk_level || 5), 0) / speeches.length;
  const score = 100 - (avgRisk * 9);
  
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

// 5. Trend Score (0-100)
function calculateTrendScore(analyses: any[]): number {
  if (analyses.length < 2) return 50;
  
  const sortedAnalyses = analyses.sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  
  const halfPoint = Math.floor(sortedAnalyses.length / 2);
  const firstHalf = sortedAnalyses.slice(0, halfPoint);
  const secondHalf = sortedAnalyses.slice(halfPoint);
  
  if (firstHalf.length === 0 || secondHalf.length === 0) return 50;
  
  const avgFirst = firstHalf.reduce((sum, a) => sum + (a.sentiment_score || 50), 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((sum, a) => sum + (a.sentiment_score || 50), 0) / secondHalf.length;
  
  const change = avgSecond - avgFirst;
  const score = 50 + change;
  
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

// 6. Overall Score (Weighted Average)
const WEIGHTS = {
  reach: 0.15,
  engagement: 0.25,
  sentiment: 0.30,
  speechImpact: 0.15,
  trend: 0.15
};

function calculateOverallScore(scores: {
  reach: number;
  engagement: number;
  sentiment: number;
  speechImpact: number;
  trend: number;
}): number {
  const overall = 
    scores.reach * WEIGHTS.reach +
    scores.engagement * WEIGHTS.engagement +
    scores.sentiment * WEIGHTS.sentiment +
    scores.speechImpact * WEIGHTS.speechImpact +
    scores.trend * WEIGHTS.trend;
  
  return Math.round(overall * 100) / 100;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Não autenticado');
    }

    const { period_start, period_end } = await req.json();
    
    console.log('Calculating rankings for period:', period_start, 'to', period_end);

    // 1. Fetch user's candidates
    const { data: candidates, error: candidatesError } = await supabase
      .from('candidates')
      .select('*')
      .eq('user_id', user.id);

    if (candidatesError) throw candidatesError;

    console.log(`Found ${candidates?.length || 0} candidates`);

    // Calculate scores for each candidate with geographic validation
    const rankings = [];
    
    for (const candidate of candidates || []) {
      const candidateRegion = normalizeRegion(candidate.region);
      const isNationalCandidate = candidateRegion === 'NACIONAL';
      const geoScope = isNationalCandidate 
        ? 'nacional' 
        : `regional_${candidateRegion.toLowerCase().replace(/ /g, '_')}`;
      
      console.log(`📊 Ranking ${candidate.full_name} - Region: ${candidateRegion}, Scope: ${geoScope}`);
      
      // Fetch analyses in period - filter by geographic scope
      let analysisQuery = supabase
        .from('candidate_analyses')
        .select('*')
        .eq('candidate_id', candidate.id)
        .eq('geographic_scope', geoScope); // CRITICAL: Only use analyses from correct region

      if (period_start) {
        analysisQuery = analysisQuery.gte('created_at', period_start);
      }
      if (period_end) {
        analysisQuery = analysisQuery.lte('created_at', period_end);
      }

      const { data: analyses } = await analysisQuery;
      
      if (!analyses || analyses.length === 0) {
        console.warn(`⚠️ No analyses found for ${candidate.full_name} in region ${candidateRegion} (${geoScope})`);
      } else {
        console.log(`✓ Found ${analyses.length} analyses for ${candidate.full_name} in ${candidateRegion}`);
      }

      // Fetch speeches in period
      const { data: speeches } = await supabase
        .from('speech_analyses')
        .select('*')
        .eq('candidate_id', candidate.id)
        .gte('created_at', period_start)
        .lte('created_at', period_end);

      console.log(`Candidate ${candidate.full_name}: ${analyses?.length || 0} analyses, ${speeches?.length || 0} speeches`);

      // Calculate scores
      const reachScore = calculateReachScore(candidate.followers);
      const totalMentions = analyses?.reduce((sum, a) => sum + (a.mentions_count || 0), 0) || 0;
      const engagementScore = calculateEngagementScore(totalMentions, analyses?.length || 0);

      const positiveCount = analyses?.filter(a => a.sentiment_score > 60).length || 0;
      const negativeCount = analyses?.filter(a => a.sentiment_score < 40).length || 0;
      const neutralCount = (analyses?.length || 0) - positiveCount - negativeCount;

      const { positive, negative, sentimentScore } = calculateSentimentScore(
        positiveCount,
        negativeCount,
        neutralCount
      );

      const speechImpactScore = calculateSpeechImpactScore(speeches || []);
      const trendScore = calculateTrendScore(analyses || []);

      const overallScore = calculateOverallScore({
        reach: reachScore,
        engagement: engagementScore,
        sentiment: sentimentScore,
        speechImpact: speechImpactScore,
        trend: trendScore
      });

      rankings.push({
        candidate_id: candidate.id,
        overall_score: overallScore,
        reach_score: reachScore,
        engagement_score: engagementScore,
        positive_perception: positive,
        negative_perception: negative,
        speech_impact_score: speechImpactScore,
        trend_score: trendScore
      });
    }

    // 3. Sort and assign positions
    rankings.sort((a, b) => b.overall_score - a.overall_score);
    
    // 4. Get previous rankings to calculate rank_change
    const previousPeriodEnd = new Date(period_start);
    const periodLength = new Date(period_end).getTime() - new Date(period_start).getTime();
    const previousPeriodStart = new Date(previousPeriodEnd.getTime() - periodLength);

    const { data: previousRankings } = await supabase
      .from('candidate_rankings')
      .select('*')
      .eq('user_id', user.id)
      .eq('period_start', previousPeriodStart.toISOString())
      .eq('period_end', previousPeriodEnd.toISOString());

    const previousRankMap = new Map(
      previousRankings?.map(r => [r.candidate_id, r.rank_position]) || []
    );

    const rankedData = rankings.map((rank, index) => {
      const currentPosition = index + 1;
      const previousPosition = previousRankMap.get(rank.candidate_id);
      const rankChange = previousPosition ? previousPosition - currentPosition : 0;

      return {
        ...rank,
        rank_position: currentPosition,
        rank_change: rankChange,
        user_id: user.id,
        period_start,
        period_end
      };
    });

    console.log('Inserting rankings:', rankedData.length);

    // 5. Delete existing rankings for this period before inserting new ones
    const { error: deleteError } = await supabase
      .from('candidate_rankings')
      .delete()
      .eq('user_id', user.id)
      .eq('period_start', period_start)
      .eq('period_end', period_end);

    if (deleteError) {
      console.error('Delete error:', deleteError);
    }

    // 6. Insert new rankings
    const { error: insertError } = await supabase
      .from('candidate_rankings')
      .insert(rankedData);

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        rankings: rankedData,
        message: `Ranking calculado com sucesso para ${rankedData.length} candidatos`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});