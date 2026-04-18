// Edge function: Coleta automática do Reddit via RSS nativo (gratuito, sem OAuth).
// Disparada por cron a cada 10 minutos para todos os candidatos ativos.
// Insere em social_interactions com deduplicação por URL única.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Rotação de User-Agents de navegadores reais — bypass do anti-bot do Reddit em IPs de cloud.
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
];
function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

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
  // JSON API pública — funciona melhor que .rss em 2025 com UA correto
  const url =
    `https://www.reddit.com/search.json?q=${query}&sort=new&limit=50&t=week&raw_json=1`;

  let json: any;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(
        `[REDDIT-CRON] ${candidate.full_name}: HTTP ${res.status}`,
      );
      return { collected: 0, skipped: 0 };
    }
    json = await res.json();
  } catch (e) {
    console.warn(
      `[REDDIT-CRON] fetch falhou ${candidate.full_name}: ${(e as Error).message}`,
    );
    return { collected: 0, skipped: 0 };
  }

  const children: any[] = json?.data?.children ?? [];

  if (children.length === 0) {
    console.log(`[REDDIT-CRON] ${candidate.full_name}: 0 itens no feed`);
    return { collected: 0, skipped: 0 };
  }

  const rows: any[] = [];
  let skipped = 0;

  for (const child of children) {
    const d = child?.data;
    if (!d) {
      skipped++;
      continue;
    }
    const title = d.title ?? "";
    const selftext = d.selftext ?? "";
    const content = stripHtml(`${title}\n${selftext}`).slice(0, 4000);
    const link = d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url ?? "");
    const author = d.author ?? "Reddit user";
    const created = d.created_utc
      ? new Date(d.created_utc * 1000).toISOString()
      : new Date().toISOString();
    const score = typeof d.score === "number" ? d.score : 0;
    const numComments = typeof d.num_comments === "number" ? d.num_comments : 0;

    if (!link || !content) {
      skipped++;
      continue;
    }
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
      original_posted_at: created,
      collected_at: new Date().toISOString(),
      likes_count: score,
      replies_count: numComments,
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
