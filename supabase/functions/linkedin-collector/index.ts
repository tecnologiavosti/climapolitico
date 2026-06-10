// LinkedIn collector — usa Google News RSS com dork `site:linkedin.com`
// para coletar posts/menções públicas indexadas, sem chamar linkedin.com diretamente.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { newPipelineRecorder } from "../_shared/pipeline-metrics.ts";

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

const COLLECTOR_NAME = "linkedin-collector";

// Termos políticos extras para reforçar precisão quando o nome do candidato é comum.
const POLITICAL_BOOST = [
  "política", "eleições", "governador", "senador",
  "deputado", "prefeito", "ministro", "presidente",
  "congresso", "campanha",
];

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parseRSSFeed(xmlText: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    const title = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || "";
    const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const source = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "LinkedIn";
    const description = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || "";

    if (title && link) {
      items.push({
        title: decodeEntities(title),
        link: link.trim(),
        pubDate,
        source: decodeEntities(source.replace(/<[^>]*>/g, "").trim()),
        description: decodeEntities(description.replace(/<[^>]*>/g, "").substring(0, 500).trim()),
      });
    }
  }
  return items;
}

async function fetchLinkedInForCandidate(candidate: CandidateRow): Promise<NewsItem[]> {
  const all: NewsItem[] = [];
  const seen = new Set<string>();

  // Query 1: nome exato em linkedin.com
  // Query 2: nome + boost político (filtra homônimos)
  const queries = [
    `site:linkedin.com "${candidate.full_name}"`,
    `site:linkedin.com "${candidate.full_name}" (${POLITICAL_BOOST.slice(0, 5).join(" OR ")})`,
  ];

  for (const q of queries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0)" },
      });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = parseRSSFeed(xml).slice(0, 50);
      for (const it of items) {
        if (!seen.has(it.link)) {
          seen.add(it.link);
          all.push(it);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${COLLECTOR_NAME}] query falhou (${candidate.full_name}):`, msg);
    }
  }

  return all;
}

async function collectForAllCandidates(supabase: any) {
  const startedAt = Date.now();

  // Quota check (gracioso — se função não existir, ignora)
  try {
    const { data: skip } = await supabase.rpc("should_skip_collector", { _name: COLLECTOR_NAME });
    if (skip === true) {
      console.log(`[${COLLECTOR_NAME}] pausado por quota.`);
      return;
    }
  } catch (_) { /* ignore */ }

  const { data: candidates, error: candErr } = await supabase
    .from("candidates")
    .select("id, full_name, user_id, status")
    .eq("status", "active");

  if (candErr) {
    console.error(`[${COLLECTOR_NAME}] erro ao buscar candidatos:`, candErr.message);
    return;
  }
  if (!candidates || candidates.length === 0) {
    console.log(`[${COLLECTOR_NAME}] nenhum candidato ativo.`);
    return;
  }

  console.log(`[${COLLECTOR_NAME}] processando ${candidates.length} candidatos`);

  let totalInserted = 0;
  let hadError = false;

  for (const candidate of (candidates as CandidateRow[])) {
    const rec = newPipelineRecorder("linkedin", candidate.id);
    try {
      const items = await fetchLinkedInForCandidate(candidate);
      rec.addCollected(items.length, "google_news_dork");
      rec.addParsed(items.length);
      if (items.length === 0) { await rec.flush(); continue; }

      const links = items.map((i) => i.link);
      const { data: existing } = await supabase
        .from("social_interactions")
        .select("author_profile_url")
        .eq("candidate_id", candidate.id)
        .eq("social_network", "linkedin")
        .in("author_profile_url", links);

      const existingSet = new Set(
        ((existing || []) as ExistingInteractionRow[]).map((e) => e.author_profile_url),
      );
      const fresh = items.filter((i) => !existingSet.has(i.link));
      rec.addDeduped(items.length - fresh.length, "db");
      if (fresh.length === 0) { await rec.flush(); continue; }

      const rows = fresh.map((item) => ({
        user_id: candidate.user_id,
        candidate_id: candidate.id,
        social_network: "linkedin",
        interaction_type: "post",
        comment_text: `${item.title}${item.description ? `\n\n${item.description}` : ""}`,
        comment_author: item.source || "LinkedIn",
        author_profile_url: item.link,
        original_posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        collected_at: new Date().toISOString(),
      }));

      const { error: insErr } = await supabase.from("social_interactions").insert(rows);
      if (insErr) {
        hadError = true;
        rec.setError(insErr.message);
        console.error(`[${COLLECTOR_NAME}] insert erro (${candidate.full_name}):`, insErr.message);
      } else {
        totalInserted += rows.length;
        rec.addInserted(rows.length);
        console.log(`[${COLLECTOR_NAME}] ${candidate.full_name}: +${rows.length} posts`);
      }
    } catch (err) {
      hadError = true;
      const msg = err instanceof Error ? err.message : String(err);
      rec.setError(msg);
      console.warn(`[${COLLECTOR_NAME}] erro em ${candidate.full_name}:`, msg);
    }
    await rec.flush();
  }

  // Registrar chamada/itens (se função existir)
  try {
    await supabase.rpc("record_collector_call", {
      _name: COLLECTOR_NAME,
      _items: totalInserted,
      _had_error: hadError,
    });
  } catch (_) { /* ignore */ }

  console.log(`[${COLLECTOR_NAME}] concluído: +${totalInserted} itens em ${Date.now() - startedAt}ms`);
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

    // @ts-ignore - EdgeRuntime existe em Supabase Edge Functions
    EdgeRuntime.waitUntil(collectForAllCandidates(supabase));

    return new Response(
      JSON.stringify({ message: "Coleta LinkedIn iniciada em background", status: "processing" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${COLLECTOR_NAME}] erro:`, msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
