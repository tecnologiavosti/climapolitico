// Cron: recalcula candidate_metrics_cache para TODOS os candidatos ativos.
// Executado periodicamente para manter Visão Geral / Total de Menções atualizados
// conforme as coletas vão chegando. Não exige JWT (cron interno).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizeNet = (n: string): string => {
  const map: Record<string, string> = {
    instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok",
    tik_tok: "TikTok", youtube: "YouTube", twitter: "Twitter/X",
    x: "Twitter/X", reddit: "Reddit", telegram: "Telegram",
    google_news: "Google News", googlenews: "Google News",
    wikipedia: "Wikipedia", linkedin: "LinkedIn", threads: "Threads",
  };
  return map[(n || "").toLowerCase()] || n || "Outro";
};

async function recalcOne(supabase: any, userId: string, candidateId: string) {
  let all: any[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error } = await supabase
      .from("social_interactions")
      .select("sentiment_label, sentiment_score, likes_count, replies_count, shares_count, social_network, comment_author")
      .eq("candidate_id", candidateId)
      .eq("user_id", userId)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!page || page.length === 0) break;
    all = all.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  const { data: candidate } = await supabase
    .from("candidates").select("followers").eq("id", candidateId).maybeSingle();

  const totalMentions = all.length;
  const authors = new Set<string>();
  let totalLikes = 0, totalReplies = 0, totalShares = 0;
  let pos = 0, neu = 0, neg = 0, sentSum = 0, analyzed = 0;
  const netMap: Record<string, { mentions: number; engagement: number; sentSum: number; analyzed: number }> = {};

  for (const i of all) {
    if (i.comment_author) authors.add(i.comment_author);
    totalLikes += i.likes_count || 0;
    totalReplies += i.replies_count || 0;
    totalShares += i.shares_count || 0;
    const net = normalizeNet(i.social_network || "Outro");
    if (!netMap[net]) netMap[net] = { mentions: 0, engagement: 0, sentSum: 0, analyzed: 0 };
    netMap[net].mentions++;
    netMap[net].engagement += (i.likes_count || 0) + (i.replies_count || 0) + (i.shares_count || 0);
    if (i.sentiment_label && i.sentiment_score !== null && i.sentiment_score !== undefined) {
      analyzed++;
      sentSum += i.sentiment_score * 100;
      if (i.sentiment_label === "Positivo") pos++;
      else if (i.sentiment_label === "Negativo") neg++;
      else neu++;
      netMap[net].sentSum += i.sentiment_score * 100;
      netMap[net].analyzed++;
    }
  }

  const avgSent = analyzed > 0 ? Math.round(sentSum / analyzed) : 50;
  const networkBreakdown = Object.entries(netMap).map(([network, d]) => ({
    network, mentions: d.mentions, engagement: d.engagement,
    avgSentiment: d.analyzed > 0 ? Math.round(d.sentSum / d.analyzed) : 50,
  })).sort((a, b) => b.mentions - a.mentions);

  const cacheData = {
    user_id: userId, candidate_id: candidateId,
    total_mentions: totalMentions, unique_authors: authors.size,
    total_engagement: totalLikes + totalReplies + totalShares,
    total_likes: totalLikes, total_replies: totalReplies, total_shares: totalShares,
    positive_count: pos, neutral_count: neu, negative_count: neg,
    average_sentiment: avgSent, network_breakdown: networkBreakdown,
    followers_count: candidate?.followers || null,
    last_calculated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("candidate_metrics_cache").select("id")
    .eq("user_id", userId).eq("candidate_id", candidateId).maybeSingle();

  if (existing) {
    await supabase.from("candidate_metrics_cache").update(cacheData).eq("id", existing.id);
  } else {
    await supabase.from("candidate_metrics_cache").insert(cacheData);
  }

  await supabase.from("candidates").update({
    mentions: totalMentions, sentiment: avgSent,
    last_analysis_at: new Date().toISOString(),
  }).eq("id", candidateId).eq("user_id", userId);

  return totalMentions;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: candidates, error } = await supabase
      .from("candidates")
      .select("id, user_id, full_name")
      .eq("status", "active");
    if (error) throw error;

    const list = candidates || [];
    let ok = 0, fail = 0;
    const results: Array<{ name: string; mentions: number }> = [];

    const job = (async () => {
      for (const c of list) {
        try {
          const m = await recalcOne(supabase, c.user_id, c.id);
          results.push({ name: c.full_name, mentions: m });
          ok++;
          console.log(`[METRICS-CRON] ✅ ${c.full_name}: ${m} menções`);
        } catch (e) {
          fail++;
          console.error(`[METRICS-CRON] ❌ ${c.full_name}:`, (e as Error).message);
        }
      }
      console.log(`[METRICS-CRON] Concluído: ok=${ok} fail=${fail}`);
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(job);
    } else {
      await job;
    }

    return new Response(JSON.stringify({
      success: true, accepted: true, candidates: list.length,
      message: "Recálculo em background iniciado",
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[METRICS-CRON] erro fatal:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
