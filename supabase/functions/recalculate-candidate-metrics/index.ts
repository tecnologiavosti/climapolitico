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

interface InitialMetrics {
  popularity: number;
  recall: number;
  approval: number;
  resistance: number;
  authority: number;
  penetration: number;
  engagement: number;
  growth: number;
}

function clamp(v: number, lo = 0, hi = 100) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function normText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function deterministicRange(seed: string, min: number, max: number) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return Math.round(min + (hash % 1000) / 999 * (max - min));
}

function candidateScope(candidate: { full_name?: string | null; region?: string | null }) {
  const name = normText(candidate.full_name);
  const region = normText(candidate.region);
  if (name.includes('lula')) return 'presidente' as const;
  if (region.includes('brasil') || region.includes('nacional')) return 'nacional' as const;
  if (['bolsonaro', 'ciro', 'marina silva', 'tarcisio'].some((n) => name.includes(n))) return 'nacional' as const;
  return 'estadual' as const;
}

function generateInitialMetrics(candidate: { full_name?: string | null; party?: string | null; region?: string | null }): InitialMetrics {
  const name = normText(candidate.full_name);
  const scope = candidateScope(candidate);
  const pick = (key: string, min: number, max: number) => deterministicRange(`${name}|${key}`, min, max);

  if (name.includes('lula')) {
    return { popularity: 95, recall: 100, approval: 55, resistance: 45, authority: 100, penetration: 95, engagement: 75, growth: 60 };
  }

  if (scope === 'presidente') {
    return {
      popularity: pick('popularidade', 80, 95), recall: pick('lembranca', 95, 100), approval: pick('aprovacao', 50, 68),
      resistance: pick('resistencia', 42, 65), authority: pick('autoridade', 85, 100), penetration: pick('penetracao', 85, 100),
      engagement: pick('engajamento', 55, 80), growth: pick('crescimento', 45, 70),
    };
  }

  if (scope === 'nacional') {
    return {
      popularity: pick('popularidade', 55, 80), recall: pick('lembranca', 60, 85), approval: pick('aprovacao', 45, 65),
      resistance: pick('resistencia', 45, 70), authority: pick('autoridade', 50, 80), penetration: pick('penetracao', 55, 85),
      engagement: pick('engajamento', 40, 70), growth: pick('crescimento', 40, 65),
    };
  }

  return {
    popularity: pick('popularidade', 15, 50), recall: pick('lembranca', 10, 40), approval: pick('aprovacao', 35, 62),
    resistance: pick('resistencia', 45, 75), authority: pick('autoridade', 15, 50), penetration: pick('penetracao', 10, 45),
    engagement: pick('engajamento', 10, 50), growth: pick('crescimento', 15, 60),
  };
}

function seedCacheMetrics(seed: InitialMetrics, candidate: { full_name?: string | null }) {
  const scope = candidateScope(candidate);
  const scale = scope === 'presidente' ? 22 : scope === 'nacional' ? 10 : 4;
  const totalMentions = Math.max(8, Math.round(seed.recall * scale));
  const totalEngagement = Math.max(6, Math.round(totalMentions * seed.engagement / 8));
  const positiveCount = Math.round(totalMentions * clamp(seed.approval) / 100);
  const negativeCount = Math.round(totalMentions * clamp(100 - seed.resistance) / 100);
  const neutralCount = Math.max(0, totalMentions - positiveCount - negativeCount);
  return {
    totalMentions,
    uniqueAuthors: Math.max(4, Math.round(totalMentions * seed.penetration / 140)),
    totalEngagement,
    totalLikes: Math.round(totalEngagement * 0.68),
    totalReplies: Math.round(totalEngagement * 0.22),
    totalShares: Math.max(0, totalEngagement - Math.round(totalEngagement * 0.68) - Math.round(totalEngagement * 0.22)),
    positiveCount,
    negativeCount,
    neutralCount,
    averageSentiment: seed.approval,
  };
}

async function processMetricsInBackground(
  supabase: any,
  userId: string,
  candidateId: string,
) {
  try {
    console.log(`[BG] Recalculating metrics for candidate ${candidateId}, user ${userId}`);

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
        console.error('[BG] Failed to fetch interactions page:', pageError);
        throw pageError;
      }
      if (!page || page.length === 0) break;
      allInteractions = allInteractions.concat(page);
      console.log(`[BG] Page ${Math.floor(offset / pageSize) + 1}: ${page.length} rows (total: ${allInteractions.length})`);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    const interactions = allInteractions;

    const { data: candidate } = await supabase
      .from('candidates')
      .select('full_name, party, region, followers')
      .eq('id', candidateId)
      .maybeSingle();

    const seed = generateInitialMetrics(candidate ?? {});
    const seeded = seedCacheMetrics(seed, candidate ?? {});
    const useBootstrap = interactions.length === 0;

    const totalMentions = useBootstrap ? seeded.totalMentions : interactions.length;
    const uniqueAuthorsSet = new Set<string>();
    interactions.forEach((i) => { if (i.comment_author) uniqueAuthorsSet.add(i.comment_author); });
    const uniqueAuthors = useBootstrap ? seeded.uniqueAuthors : uniqueAuthorsSet.size;

    const totalLikes = useBootstrap ? seeded.totalLikes : interactions.reduce((s, i) => s + (i.likes_count ?? 0), 0);
    const totalReplies = useBootstrap ? seeded.totalReplies : interactions.reduce((s, i) => s + (i.replies_count ?? 0), 0);
    const totalShares = useBootstrap ? seeded.totalShares : interactions.reduce((s, i) => s + (i.shares_count ?? 0), 0);
    const totalEngagement = totalLikes + totalReplies + totalShares;

    let positiveCount = 0, neutralCount = 0, negativeCount = 0;
    let sentimentSum = 0, analyzedSentimentCount = 0, unanalyzedSentimentCount = 0;

    interactions.forEach((i) => {
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

    if (useBootstrap) {
      positiveCount = seeded.positiveCount;
      negativeCount = seeded.negativeCount;
      neutralCount = seeded.neutralCount;
    }

    const averageSentiment = useBootstrap
      ? seeded.averageSentiment
      : analyzedSentimentCount > 0
      ? Math.round(sentimentSum / analyzedSentimentCount)
      : 50;

    const normalizeNet = (n: string): string => {
      const map: Record<string, string> = {
        'instagram': 'Instagram', 'facebook': 'Facebook', 'tiktok': 'TikTok',
        'tik_tok': 'TikTok', 'youtube': 'YouTube', 'twitter': 'Twitter/X',
        'x': 'Twitter/X', 'reddit': 'Reddit', 'telegram': 'Telegram',
        'google_news': 'Google News', 'googlenews': 'Google News',
        'wikipedia': 'Wikipedia', 'linkedin': 'LinkedIn', 'threads': 'Threads',
      };
      return map[(n || '').toLowerCase()] || n || 'Outro';
    };

    const networkMap: Record<string, { mentions: number; engagement: number; sentimentSum: number; analyzedCount: number }> = {};
    interactions.forEach((i) => {
      const network = normalizeNet(i.social_network || 'Outro');
      if (!networkMap[network]) networkMap[network] = { mentions: 0, engagement: 0, sentimentSum: 0, analyzedCount: 0 };
      networkMap[network].mentions++;
      networkMap[network].engagement += (i.likes_count ?? 0) + (i.replies_count ?? 0) + (i.shares_count ?? 0);
      if (i.sentiment_label && i.sentiment_score !== null && i.sentiment_score !== undefined) {
        networkMap[network].sentimentSum += i.sentiment_score * 100;
        networkMap[network].analyzedCount++;
      }
    });

    const networkBreakdown = useBootstrap ? [{
      network: 'Bootstrap IA',
      mentions: totalMentions,
      engagement: totalEngagement,
      avgSentiment: averageSentiment,
    }] : Object.entries(networkMap).map(([network, data]) => ({
      network,
      mentions: data.mentions,
      engagement: data.engagement,
      avgSentiment: data.analyzedCount > 0 ? Math.round(data.sentimentSum / data.analyzedCount) : 50,
    })).sort((a, b) => b.mentions - a.mentions);

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

    const { data: existingCache } = await supabase
      .from('candidate_metrics_cache')
      .select('id')
      .eq('user_id', userId)
      .eq('candidate_id', candidateId)
      .maybeSingle();

    if (existingCache) {
      const { error: updateError } = await supabase
        .from('candidate_metrics_cache')
        .update(cacheData)
        .eq('id', existingCache.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from('candidate_metrics_cache')
        .insert(cacheData);
      if (insertError) throw insertError;
    }

    await supabase
      .from('candidates')
      .update({
        mentions: totalMentions,
        sentiment: averageSentiment,
        last_analysis_at: new Date().toISOString(),
      })
      .eq('id', candidateId)
      .eq('user_id', userId);

    console.log(`[BG] ✅ Done candidate=${candidateId} mentions=${totalMentions} bootstrap=${useBootstrap} analyzed=${analyzedSentimentCount} unanalyzed=${unanalyzedSentimentCount}`);
  } catch (err) {
    console.error('[BG] Recalculate metrics error:', err);
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseService = createClient(supabaseUrl, supabaseServiceRoleKey);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabaseService.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const body = await req.json();
    const { candidateId } = body;
    const wait = body?.wait === true;
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (wait) {
      await processMetricsInBackground(supabase, userId, candidateId);
      return new Response(
        JSON.stringify({
          success: true,
          status: 'completed',
          message: 'Métricas iniciais calculadas.',
          candidateId,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Dispara processamento em background — retorna imediatamente
    // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime
    EdgeRuntime.waitUntil(processMetricsInBackground(supabase, userId, candidateId));

    return new Response(
      JSON.stringify({
        success: true,
        status: 'processing',
        message: 'Recálculo iniciado em background. Consulte candidate_metrics_cache em alguns segundos.',
        candidateId,
      }),
      { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    console.error('Recalculate metrics error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
