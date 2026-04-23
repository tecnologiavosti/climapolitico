import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Ranking score (0-100) baseado em comentários reais coletados (social_interactions).
 * Fórmula:
 *   30% volume de menções
 * + 20% diversidade de autores únicos
 * + 30% sentimento médio
 * + 20% engajamento (curtidas)
 *
 * Cada métrica é normalizada de 0 a 100 RELATIVAMENTE ao maior valor entre os
 * candidatos do usuário no período (max-normalization). Isso garante a escala
 * 0-100 mesmo com volumes muito diferentes entre coletas.
 */

const WEIGHTS = {
  mentions: 0.30,
  authors: 0.20,
  sentiment: 0.30,
  engagement: 0.20,
};

interface RawMetrics {
  candidate_id: string;
  mentions: number;       // total de comentários
  uniqueAuthors: number;  // autores distintos
  avgSentiment: number;   // 0-100 (já em escala)
  likes: number;          // total de likes
  positivePct: number;    // % positivos (0-100)
  negativePct: number;    // % negativos (0-100)
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

async function fetchPage(supabase: any, candidateId: string, periodStart?: string, periodEnd?: string) {
  const PAGE = 1000;
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from('social_interactions')
      .select('id, comment_author, sentiment_score, sentiment_label, likes_count, social_network, created_at, original_posted_at', { count: 'exact' })
      .eq('candidate_id', candidateId)
      .range(from, from + PAGE - 1);
    if (periodStart) q = q.gte('created_at', periodStart);
    if (periodEnd) q = q.lte('created_at', periodEnd);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
    if (all.length > 50000) break; // safety
  }
  return all;
}

function aggregateMetrics(candidateId: string, interactions: any[]): RawMetrics {
  const mentions = interactions.length;
  const authors = new Set<string>();
  let likes = 0;
  let sentSum = 0;
  let sentCount = 0;
  let pos = 0, neg = 0, total = 0;

  for (const i of interactions) {
    if (i.comment_author) authors.add(String(i.comment_author).toLowerCase().trim());
    likes += Number(i.likes_count || 0);
    if (typeof i.sentiment_score === 'number') {
      // sentiment_score no banco está em 0-1 (algumas vezes 0-100). Normalizamos.
      const s = i.sentiment_score > 1 ? i.sentiment_score : i.sentiment_score * 100;
      sentSum += s;
      sentCount++;
    }
    if (i.sentiment_label) {
      total++;
      if (i.sentiment_label === 'Positivo') pos++;
      else if (i.sentiment_label === 'Negativo') neg++;
    }
  }

  const avgSentiment = sentCount > 0 ? sentSum / sentCount : 50;

  return {
    candidate_id: candidateId,
    mentions,
    uniqueAuthors: authors.size,
    avgSentiment: Math.max(0, Math.min(100, avgSentiment)),
    likes,
    positivePct: total > 0 ? (pos / total) * 100 : 0,
    negativePct: total > 0 ? (neg / total) * 100 : 0,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Não autenticado');

    const body = await req.json().catch(() => ({}));
    const period_end = body.period_end || new Date().toISOString();
    const period_start = body.period_start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    console.log(`[calculate-ranking] user=${user.id} period=${period_start}..${period_end}`);

    // 1. Candidatos do usuário
    const { data: candidates, error: candidatesError } = await supabase
      .from('candidates')
      .select('id, full_name, followers')
      .eq('user_id', user.id);
    if (candidatesError) throw candidatesError;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, rankings: [], message: 'Nenhum candidato encontrado.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Métricas brutas por candidato a partir de social_interactions
    const rawMetrics: RawMetrics[] = [];
    for (const c of candidates) {
      const interactions = await fetchPage(supabase, c.id, period_start, period_end);
      const m = aggregateMetrics(c.id, interactions);
      console.log(`[calculate-ranking] ${c.full_name}: mentions=${m.mentions} authors=${m.uniqueAuthors} likes=${m.likes} sent=${m.avgSentiment.toFixed(1)}`);
      rawMetrics.push(m);
    }

    // 3. Max para normalização relativa
    const maxMentions = Math.max(...rawMetrics.map(m => m.mentions), 0);
    const maxAuthors = Math.max(...rawMetrics.map(m => m.uniqueAuthors), 0);
    const maxLikes = Math.max(...rawMetrics.map(m => m.likes), 0);

    // 4. Normaliza e calcula score final
    const rankings = rawMetrics.map(m => {
      const mentionsScore = normalize(m.mentions, maxMentions);
      const authorsScore = normalize(m.uniqueAuthors, maxAuthors);
      const sentimentScore = m.avgSentiment; // já 0-100
      const engagementScore = normalize(m.likes, maxLikes);

      const overall =
        mentionsScore * WEIGHTS.mentions +
        authorsScore * WEIGHTS.authors +
        sentimentScore * WEIGHTS.sentiment +
        engagementScore * WEIGHTS.engagement;

      return {
        candidate_id: m.candidate_id,
        overall_score: Math.round(overall * 100) / 100,
        reach_score: Math.round(mentionsScore * 100) / 100,        // volume de menções
        engagement_score: Math.round(engagementScore * 100) / 100, // curtidas
        trend_score: Math.round(authorsScore * 100) / 100,         // diversidade de autores
        speech_impact_score: Math.round(sentimentScore * 100) / 100, // sentimento
        positive_perception: Math.round(m.positivePct * 100) / 100,
        negative_perception: Math.round(m.negativePct * 100) / 100,
      };
    });

    // 5. Ordena e atribui posição
    rankings.sort((a, b) => b.overall_score - a.overall_score);

    // 6. rank_change vs período anterior (mesmo tamanho, anterior ao atual)
    const periodLength = new Date(period_end).getTime() - new Date(period_start).getTime();
    const previousPeriodEnd = new Date(period_start);
    const previousPeriodStart = new Date(previousPeriodEnd.getTime() - periodLength);

    const { data: previousRankings } = await supabase
      .from('candidate_rankings')
      .select('candidate_id, rank_position')
      .eq('user_id', user.id)
      .gte('period_start', previousPeriodStart.toISOString())
      .lte('period_end', previousPeriodEnd.toISOString())
      .order('created_at', { ascending: false })
      .limit(candidates.length);

    const previousRankMap = new Map<string, number>(
      (previousRankings || []).map((r: any) => [r.candidate_id, r.rank_position])
    );

    const rankedData = rankings.map((r, idx) => {
      const currentPosition = idx + 1;
      const previousPosition = previousRankMap.get(r.candidate_id);
      const rank_change = previousPosition ? previousPosition - currentPosition : 0;
      return {
        ...r,
        rank_position: currentPosition,
        rank_change,
        user_id: user.id,
        period_start,
        period_end,
      };
    });

    // 7. Substitui rankings do período
    const { error: deleteError } = await supabase
      .from('candidate_rankings')
      .delete()
      .eq('user_id', user.id)
      .eq('period_start', period_start)
      .eq('period_end', period_end);
    if (deleteError) console.warn('[calculate-ranking] delete warning:', deleteError);

    const { error: insertError } = await supabase
      .from('candidate_rankings')
      .insert(rankedData);
    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        success: true,
        rankings: rankedData,
        message: `Ranking calculado para ${rankedData.length} candidatos a partir de comentários reais.`,
        formula: '30% menções + 20% autores únicos + 30% sentimento + 20% curtidas',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[calculate-ranking] error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
