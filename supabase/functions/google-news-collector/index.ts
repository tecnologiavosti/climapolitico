// Coletor automático de Google News para todos os candidatos monitorados.
// Usa o RSS oficial do Google News (gratuito, sem API key).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPoliticalCandidateContent } from "../_shared/political-content.ts";

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
  image?: string | null;
}

interface CandidateRow {
  id: string;
  full_name: string;
  user_id: string;
  status: string | null;
}

// Keywords políticas gerais — coletadas para todos e vinculadas ao candidato
// cujo nome aparece no título/descrição (dedup por URL evita inflar duplicatas).
const POLITICAL_KEYWORDS = [
  // Eleições
  "eleições 2026", "candidatos 2026", "pesquisa eleitoral",
  "TSE eleições", "campanha política",
  // Partidos
  "PT partido", "PL partido", "PSDB", "MDB",
  "União Brasil", "PDT", "PSOL",
  // Temas políticos
  "reforma tributária", "reforma administrativa",
  "privatização", "orçamento federal",
  "congresso nacional", "senado federal",
  "câmara deputados", "STF julgamento",
  // Economia política
  "Lula governo", "oposição brasil",
  "crise política", "impeachment",
  "corrupção brasil", "operação policial",
  // Sociais
  "greve brasil", "manifestação política",
  "direitos sociais", "educação pública",
  "saúde pública brasil", "segurança pública",
];

function nameMatches(text: string, fullName: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  if (t.includes(norm(fullName))) return true;
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 4);
  if (parts.length >= 2) {
    return t.includes(`${parts[0]} ${parts[parts.length - 1]}`);
  }
  return parts.length === 1 ? t.includes(parts[0]) : false;
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
    const image = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/)?.[1]
      || itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/)?.[1]
      || description.match(/<img[^>]+src=["']([^"']+)["']/)?.[1]
      || null;

    if (title && link) {
      items.push({
        title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        link: link.trim(),
        pubDate,
        source: source.replace(/<[^>]*>/g, "").trim(),
        description: description.replace(/<[^>]*>/g, "").substring(0, 500).trim(),
        image,
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
      const newItems = items.filter((i) => !existingSet.has(i.link) && isPoliticalCandidateContent(`${i.title} ${i.description} ${i.source}`, candidate.full_name));
      if (newItems.length === 0) continue;

      const rows = newItems.map((item) => ({
        user_id: candidate.user_id,
        candidate_id: candidate.id,
        social_network: "google_news",
        interaction_type: "news",
        comment_text: `${item.title}\n\n${item.description}`,
        comment_author: item.source,
        author_profile_url: item.link,
        post_url: item.link,
        post_title: item.title,
        post_description: item.description,
        author_name: item.source,
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

  // ========= Sweep extra: keywords políticas gerais =========
  // Para cada keyword, busca notícias e vincula ao candidato cujo nome aparece.
  // Dedup por URL evita inflar duplicatas.
  let keywordInserted = 0;
  const candList = candidates as CandidateRow[];
  for (const kw of POLITICAL_KEYWORDS) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0)" } });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = parseRSSFeed(xml).slice(0, 50);
      if (items.length === 0) continue;

      // Para cada item, descobre quais candidatos têm o nome citado
      const rowsByCandidate = new Map<string, any[]>();
      for (const item of items) {
        const haystack = `${item.title} ${item.description}`;
        for (const cand of candList) {
          if (!nameMatches(haystack, cand.full_name) || !isPoliticalCandidateContent(`${haystack} ${item.source}`, cand.full_name)) continue;
          const row = {
            user_id: cand.user_id,
            candidate_id: cand.id,
            social_network: "google_news",
            interaction_type: "news",
            comment_text: `${item.title}\n\n${item.description}`,
            comment_author: item.source,
            author_profile_url: item.link,
            post_url: item.link,
            post_title: item.title,
            post_description: item.description,
            author_name: item.source,
            original_posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            collected_at: new Date().toISOString(),
          };
          const arr = rowsByCandidate.get(cand.id) ?? [];
          arr.push(row);
          rowsByCandidate.set(cand.id, arr);
        }
      }

      for (const [candId, rows] of rowsByCandidate.entries()) {
        const links = rows.map((r) => r.author_profile_url);
        const { data: existing } = await supabase
          .from("social_interactions")
          .select("author_profile_url")
          .eq("candidate_id", candId)
          .eq("social_network", "google_news")
          .in("author_profile_url", links);
        const existingSet = new Set(((existing || []) as ExistingInteractionRow[]).map((e) => e.author_profile_url));
        const fresh = rows.filter((r) => !existingSet.has(r.author_profile_url));
        if (fresh.length === 0) continue;
        const { error: insErr } = await supabase.from("social_interactions").insert(fresh);
        if (!insErr) keywordInserted += fresh.length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[google-news-collector] keyword "${kw}" falhou:`, msg);
    }
  }

  console.log(`[google-news-collector] concluído: ${totalInserted} (por candidato) + ${keywordInserted} (keywords) em ${Date.now() - startedAt}ms`);
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
