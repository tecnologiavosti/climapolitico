// Edge function: Coleta automática do Twitter/X via rede de instâncias Nitter (RSS)
// Executa a cada minuto via cron job, rotaciona entre instâncias saudáveis e
// salva os tweets na tabela `social_interactions` (SSOT) para cada candidato monitorado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parse } from "https://deno.land/x/xml@2.1.3/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface NitterInstance {
  id: string;
  url: string;
  health_score: number;
}

interface CollectedTweet {
  tweet_id: string;
  username: string;
  full_text: string;
  created_at: string;
  link: string;
  nitter_instance_used: string;
}

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_TWEETS_PER_CANDIDATE = 60;

// Heurística rápida para detectar sentimento sem chamar IA (a cada minuto seria caro).
// Os jobs de re-análise existentes refinam depois.
function quickSentiment(text: string): { label: string; score: number } {
  const lower = text.toLowerCase();
  const positive = [
    "ótimo", "otimo", "excelente", "parabéns", "parabens", "apoio", "vitória", "vitoria",
    "bom", "melhor", "obrigado", "incrível", "incrivel", "👏", "❤", "🎉", "💪",
  ];
  const negative = [
    "péssimo", "pessimo", "ruim", "horrível", "horrivel", "corrupto", "ladrão", "ladrao",
    "mentiroso", "fracasso", "vergonha", "absurdo", "lamentável", "lamentavel", "🤮", "💩", "👎",
  ];
  let score = 0;
  for (const w of positive) if (lower.includes(w)) score += 1;
  for (const w of negative) if (lower.includes(w)) score -= 1;
  if (score > 0) return { label: "Positivo", score: Math.min(0.85, 0.55 + score * 0.1) };
  if (score < 0) return { label: "Negativo", score: Math.max(0.15, 0.45 + score * 0.1) };
  return { label: "Neutro", score: 0.5 };
}

function extractTweetIdFromLink(link: string): string | null {
  const m = link?.match(/status\/(\d+)/);
  return m ? m[1] : null;
}

function stripHtml(html: string): string {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getCData(field: any): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object") {
    if (field["#text"]) return String(field["#text"]);
    if (field.__cdata) return String(field.__cdata);
  }
  return String(field);
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0; +https://climapolitico.lovable.app)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
  } finally {
    clearTimeout(t);
  }
}

async function fetchTweetsForQuery(
  instances: NitterInstance[],
  query: string,
  supabase: ReturnType<typeof createClient>,
): Promise<{ tweets: CollectedTweet[]; instanceUsed: string | null }> {
  const encoded = encodeURIComponent(query);
  for (const instance of instances) {
    const url = `${instance.url}/search/rss?f=tweets&q=${encoded}`;
    try {
      const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      if (!xml.includes("<item>") && !xml.includes("<rss")) {
        throw new Error("Resposta sem feed RSS válido");
      }

      const parsed: any = parse(xml);
      const items = parsed?.rss?.channel?.item ?? [];
      const itemArray = Array.isArray(items) ? items : [items];

      const tweets: CollectedTweet[] = [];
      for (const item of itemArray) {
        if (!item) continue;
        const link = getCData(item.link);
        const tweetId = extractTweetIdFromLink(link) ?? `nitter-${crypto.randomUUID()}`;
        const description = stripHtml(getCData(item.description));
        if (!description || description.length < 10) continue;
        const author = getCData(item["dc:creator"] ?? item.author ?? "");
        const username = (author.match(/@?(\w+)/)?.[1] ?? "unknown").toLowerCase();
        const pubDate = getCData(item.pubDate);
        const createdAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

        tweets.push({
          tweet_id: tweetId,
          username,
          full_text: description.slice(0, 2000),
          created_at: createdAt,
          link,
          nitter_instance_used: instance.url,
        });
      }

      // Marca instância como saudável
      await supabase
        .from("nitter_instances")
        .update({
          last_checked: new Date().toISOString(),
          health_score: Math.min(100, instance.health_score + 1),
        })
        .eq("id", instance.id);

      if (tweets.length > 0) {
        return { tweets: tweets.slice(0, MAX_TWEETS_PER_CANDIDATE), instanceUsed: instance.url };
      }
    } catch (err) {
      console.warn(`[NITTER] Instância ${instance.url} falhou: ${(err as Error).message}`);
      const newScore = Math.max(0, instance.health_score - 5);
      await supabase
        .from("nitter_instances")
        .update({
          last_checked: new Date().toISOString(),
          health_score: newScore,
          is_active: newScore > 10,
        })
        .eq("id", instance.id);
    }
  }
  return { tweets: [], instanceUsed: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // 1. Buscar instâncias Nitter ativas, priorizando as mais saudáveis
    const { data: instances, error: instancesError } = await supabase
      .from("nitter_instances")
      .select("id, url, health_score")
      .eq("is_active", true)
      .order("health_score", { ascending: false });

    if (instancesError) throw instancesError;
    if (!instances || instances.length === 0) {
      return new Response(
        JSON.stringify({ error: "Nenhuma instância Nitter ativa." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    // 2. Buscar todos os candidatos monitorados de todos os usuários
    const { data: candidates, error: candidatesError } = await supabase
      .from("candidates")
      .select("id, full_name, user_id")
      .eq("status", "active");

    if (candidatesError) throw candidatesError;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum candidato ativo para coletar." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    let totalInserted = 0;
    let totalCollected = 0;
    const perCandidate: Array<{ name: string; collected: number; inserted: number; instance: string | null }> = [];

    // 3. Para cada candidato, coletar via Nitter RSS
    for (const candidate of candidates) {
      const query = `"${candidate.full_name}"`;
      const { tweets, instanceUsed } = await fetchTweetsForQuery(
        instances as NitterInstance[],
        query,
        supabase,
      );
      totalCollected += tweets.length;

      if (tweets.length === 0) {
        perCandidate.push({ name: candidate.full_name, collected: 0, inserted: 0, instance: instanceUsed });
        continue;
      }

      // Deduplicação: verifica quais tweet_ids já existem (via author_profile_url que contém o link)
      const links = tweets.map((t) => t.link).filter(Boolean);
      const { data: existing } = await supabase
        .from("social_interactions")
        .select("author_profile_url")
        .eq("candidate_id", candidate.id)
        .eq("social_network", "Twitter/X")
        .in("author_profile_url", links);

      const existingLinks = new Set((existing ?? []).map((r: any) => r.author_profile_url));
      const fresh = tweets.filter((t) => !existingLinks.has(t.link));

      if (fresh.length === 0) {
        perCandidate.push({ name: candidate.full_name, collected: tweets.length, inserted: 0, instance: instanceUsed });
        continue;
      }

      const rows = fresh.map((t) => {
        const sentiment = quickSentiment(t.full_text);
        return {
          user_id: candidate.user_id,
          candidate_id: candidate.id,
          social_network: "Twitter/X",
          interaction_type: "post",
          comment_author: t.username,
          comment_text: t.full_text,
          author_profile_url: t.link,
          original_posted_at: t.created_at,
          sentiment_label: sentiment.label,
          sentiment_score: sentiment.score,
          likes_count: 0,
          replies_count: 0,
          shares_count: 0,
        };
      });

      const { error: insertError, count } = await supabase
        .from("social_interactions")
        .insert(rows, { count: "exact" });

      if (insertError) {
        console.error(`[NITTER] Erro inserindo para ${candidate.full_name}:`, insertError.message);
        perCandidate.push({ name: candidate.full_name, collected: tweets.length, inserted: 0, instance: instanceUsed });
        continue;
      }

      const inserted = count ?? rows.length;
      totalInserted += inserted;
      perCandidate.push({ name: candidate.full_name, collected: tweets.length, inserted, instance: instanceUsed });
    }

    return new Response(
      JSON.stringify({
        success: true,
        candidates_processed: candidates.length,
        total_collected: totalCollected,
        total_inserted: totalInserted,
        details: perCandidate,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("[NITTER] Erro fatal:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
