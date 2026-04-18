// Edge function: Coleta automática do Reddit via RSS nativo (gratuito, sem OAuth).
// Disparada por cron a cada 10 minutos para todos os candidatos ativos.
// Insere em social_interactions com deduplicação por URL única.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parse } from "https://deno.land/x/xml@2.1.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "ClimaPolitico/1.0 (Political Sentiment Monitor)";

interface Candidate {
  id: string;
  full_name: string;
  user_id: string;
}

function stripHtml(s: string): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function semanticMatch(text: string, fullName: string): boolean {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  // Exige pelo menos primeiro+último nome OU nome completo
  if (parts.length >= 2) {
    return t.includes(`${parts[0]} ${parts[parts.length - 1]}`) ||
      t.includes(norm(fullName));
  }
  return t.includes(parts[0]);
}

async function collectRedditForCandidate(
  supabase: ReturnType<typeof createClient>,
  candidate: Candidate,
): Promise<{ collected: number; skipped: number }> {
  const query = encodeURIComponent(`"${candidate.full_name}"`);
  const url =
    `https://www.reddit.com/search.rss?q=${query}&sort=new&limit=50&restrict_sr=&t=week`;

  let xmlText: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(
        `[REDDIT-CRON] ${candidate.full_name}: HTTP ${res.status}`,
      );
      return { collected: 0, skipped: 0 };
    }
    xmlText = await res.text();
  } catch (e) {
    console.warn(
      `[REDDIT-CRON] fetch falhou ${candidate.full_name}: ${(e as Error).message}`,
    );
    return { collected: 0, skipped: 0 };
  }

  let parsed: any;
  try {
    parsed = parse(xmlText);
  } catch (e) {
    console.warn(
      `[REDDIT-CRON] parse falhou ${candidate.full_name}: ${(e as Error).message}`,
    );
    return { collected: 0, skipped: 0 };
  }

  // Reddit RSS = Atom feed
  const entries = parsed?.feed?.entry;
  const items: any[] = Array.isArray(entries) ? entries : entries ? [entries] : [];

  if (items.length === 0) {
    console.log(`[REDDIT-CRON] ${candidate.full_name}: 0 itens no feed`);
    return { collected: 0, skipped: 0 };
  }

  const rows: any[] = [];
  let skipped = 0;

  for (const item of items) {
    const title = typeof item.title === "string"
      ? item.title
      : item.title?.["#text"] ?? "";
    const contentRaw = typeof item.content === "string"
      ? item.content
      : item.content?.["#text"] ?? "";
    const content = stripHtml(`${title}\n${contentRaw}`).slice(0, 4000);

    const link = item.link?.["@href"] ?? item.link?.href ?? item.link ?? "";
    const author = item.author?.name ?? "Reddit user";
    const updated = item.updated ?? item.published ?? new Date().toISOString();

    if (!link || !content) {
      skipped++;
      continue;
    }
    // Filtro semântico — evita falsos positivos
    if (!semanticMatch(content, candidate.full_name)) {
      skipped++;
      continue;
    }

    rows.push({
      candidate_id: candidate.id,
      user_id: candidate.user_id,
      social_network: "Reddit",
      interaction_type: "post",
      comment_text: content,
      comment_author: author,
      author_profile_url: link,
      original_posted_at: new Date(updated).toISOString(),
      collected_at: new Date().toISOString(),
      likes_count: 0,
      replies_count: 0,
      shares_count: 0,
    });
  }

  if (rows.length === 0) {
    console.log(
      `[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=0 skipped=${skipped}`,
    );
    return { collected: 0, skipped };
  }

  // Dedup contra existentes (por author_profile_url)
  const urls = rows.map((r) => r.author_profile_url);
  const { data: existing } = await supabase
    .from("social_interactions")
    .select("author_profile_url")
    .eq("candidate_id", candidate.id)
    .eq("social_network", "Reddit")
    .in("author_profile_url", urls);

  const existingSet = new Set(
    (existing ?? []).map((e: any) => e.author_profile_url),
  );
  const fresh = rows.filter((r) => !existingSet.has(r.author_profile_url));

  if (fresh.length === 0) {
    console.log(
      `[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=0 (todos duplicados)`,
    );
    return { collected: 0, skipped };
  }

  const { error } = await supabase.from("social_interactions").insert(fresh);
  if (error) {
    console.error(
      `[REDDIT-CRON] insert falhou ${candidate.full_name}: ${error.message}`,
    );
    return { collected: 0, skipped };
  }

  console.log(
    `[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=${fresh.length} skipped=${skipped}`,
  );
  return { collected: fresh.length, skipped };
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
    const { data: candidates, error } = await supabase
      .from("candidates")
      .select("id, full_name, user_id")
      .eq("status", "active");

    if (error) throw error;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum candidato ativo." }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    let totalCollected = 0;
    const results: any[] = [];

    // Sequencial com pequeno delay para respeitar rate limit (~60req/min)
    for (const c of candidates as Candidate[]) {
      const r = await collectRedditForCandidate(supabase, c);
      totalCollected += r.collected;
      results.push({ candidate: c.full_name, ...r });
      await new Promise((res) => setTimeout(res, 1200));
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_collected: totalCollected,
        candidates_processed: candidates.length,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (e) {
    console.error("[REDDIT-CRON] erro fatal:", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
