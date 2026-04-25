// Coletor automático de Google News para todos os candidatos monitorados.
// Usa o RSS oficial do Google News (gratuito, sem API key).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
}

interface CandidateRow {
  id: string;
  full_name: string;
  user_id: string;
  status: string | null;
}

interface ExistingInteractionRow {
  author_profile_url: string | null;
}

function parseRSSFeed(xmlText: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    const title = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || "";
    const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const source = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "Google News";
    const description = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || "";

    if (title && link) {
      items.push({
        title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        link: link.trim(),
        pubDate,
        source: source.replace(/<[^>]*>/g, "").trim(),
        description: description.replace(/<[^>]*>/g, "").substring(0, 500).trim(),
      });
    }
  }

  return items;
}

async function collectForAllCandidates(supabase: any) {
  const startedAt = Date.now();
  const { data: candidates, error: candErr } = await supabase
    .from("candidates")
    .select("id, full_name, user_id, status")
    .eq("status", "active");

  if (candErr) {
    console.error("[google-news-collector] erro ao buscar candidatos:", candErr.message);
    return;
  }
  if (!candidates || candidates.length === 0) {
    console.log("[google-news-collector] nenhum candidato ativo.");
    return;
  }

  console.log(`[google-news-collector] processando ${candidates.length} candidatos`);

  let totalInserted = 0;

  for (const candidate of (candidates as CandidateRow[])) {
    try {
      const firstName = (candidate.full_name as string).split(" ")[0];
      const query = encodeURIComponent(`"${candidate.full_name}" OR ${firstName}`);
      const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0)" },
      });
      if (!resp.ok) {
        console.warn(`[google-news-collector] ${candidate.full_name}: HTTP ${resp.status}`);
        continue;
      }

      const xml = await resp.text();
      const items = parseRSSFeed(xml).slice(0, 30);
      if (items.length === 0) continue;

      // Deduplicação: buscar URLs já coletadas para esse candidato
      const links = items.map((i) => i.link);
      const { data: existing } = await supabase
        .from("social_interactions")
        .select("author_profile_url")
        .eq("candidate_id", candidate.id)
        .eq("social_network", "google_news")
        .in("author_profile_url", links);

      const existingSet = new Set(((existing || []) as ExistingInteractionRow[]).map((e) => e.author_profile_url));
      const newItems = items.filter((i) => !existingSet.has(i.link));
      if (newItems.length === 0) continue;

      const rows = newItems.map((item) => ({
        user_id: candidate.user_id,
        candidate_id: candidate.id,
        social_network: "google_news",
        interaction_type: "news",
        comment_text: `${item.title}\n\n${item.description}`,
        comment_author: item.source,
        author_profile_url: item.link,
        original_posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        collected_at: new Date().toISOString(),
      }));

      const { error: insErr } = await supabase.from("social_interactions").insert(rows);
      if (insErr) {
        console.error(`[google-news-collector] insert erro (${candidate.full_name}):`, insErr.message);
      } else {
        totalInserted += rows.length;
        console.log(`[google-news-collector] ${candidate.full_name}: +${rows.length} notícias`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[google-news-collector] erro em ${candidate.full_name}:`, msg);
    }
  }

  console.log(`[google-news-collector] concluído: ${totalInserted} notícias em ${Date.now() - startedAt}ms`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // @ts-ignore - EdgeRuntime existe no Supabase Edge Functions
    EdgeRuntime.waitUntil(collectForAllCandidates(supabase));

    return new Response(
      JSON.stringify({ message: "Coleta iniciada em background", status: "processing" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[google-news-collector] erro:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
