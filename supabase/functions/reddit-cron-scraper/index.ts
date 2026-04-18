// Edge function: Coleta automática do Reddit via RSS-Bridge (instâncias públicas).
// Bypass do bloqueio 403 do Reddit em IPs de cloud — RSS-Bridge faz o fetch por nós.
// Disparada por cron a cada 10 minutos para todos os candidatos ativos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Instâncias públicas do RSS-Bridge — fallback automático em caso de falha.
const RSS_BRIDGE_INSTANCES = [
  "https://rss-bridge.org/bridge01",
  "https://bridge.sysadmins.ws",
  "https://rssbridge.pw",
  "https://rss.nixnet.services",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticMatch(text: string, fullName: string): boolean {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  if (parts.length >= 2) {
    return t.includes(`${parts[0]} ${parts[parts.length - 1]}`) ||
      t.includes(norm(fullName));
  }
  return t.includes(parts[0]);
}

// Parser RSS 2.0 minimalista (regex) — RSS-Bridge devolve <item> tags simples.
function parseRssItems(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const pick = (tag: string): string => {
      const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const r = block.match(re);
      return r ? stripHtml(r[1]) : "";
    };
    items.push({
      title: pick("title"),
      link: pick("link"),
      description: pick("description"),
      author: pick("author") || pick("dc:creator"),
      pubDate: pick("pubDate") || pick("published") || pick("updated"),
    });
  }
  return items;
}

async function fetchViaRssBridge(query: string): Promise<Array<Record<string, string>>> {
  for (const instance of RSS_BRIDGE_INSTANCES) {
    const url =
      `${instance}/?action=display&bridge=RedditBridge&context=Search+query&q=${encodeURIComponent(query)}&format=Mrss`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        console.warn(`[REDDIT-CRON] ${instance}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length > 0) {
        console.log(`[REDDIT-CRON] ${instance}: ${items.length} itens para "${query}"`);
        return items;
      }
      console.warn(`[REDDIT-CRON] ${instance}: 0 itens para "${query}"`);
    } catch (e) {
      console.warn(
        `[REDDIT-CRON] ${instance} falhou: ${(e as Error).message}`,
      );
    }
  }
  return [];
}

async function collectRedditForCandidate(
  supabase: ReturnType<typeof createClient>,
  candidate: Candidate,
): Promise<{ collected: number; skipped: number; raw: number }> {
  const items = await fetchViaRssBridge(`"${candidate.full_name}"`);

  if (items.length === 0) {
    console.log(`[REDDIT-CRON] ${candidate.full_name}: 0 itens em todas as instâncias`);
    return { collected: 0, skipped: 0, raw: 0 };
  }

  const rows: any[] = [];
  let skipped = 0;

  for (const it of items) {
    const content = `${it.title}\n${it.description}`.slice(0, 4000).trim();
    const link = it.link;
    const author = it.author || "Reddit user";
    const created = it.pubDate
      ? new Date(it.pubDate).toISOString()
      : new Date().toISOString();

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
      likes_count: 0,
      replies_count: 0,
      shares_count: 0,
    });
  }

  if (rows.length === 0) {
    console.log(
      `[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=0 skipped=${skipped}`,
    );
    return { collected: 0, skipped, raw: items.length };
  }

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
    return { collected: 0, skipped, raw: items.length };
  }

  const { error } = await supabase.from("social_interactions").insert(fresh);
  if (error) {
    console.error(
      `[REDDIT-CRON] insert falhou ${candidate.full_name}: ${error.message}`,
    );
    return { collected: 0, skipped, raw: items.length };
  }

  console.log(
    `[REDDIT-CRON] ${candidate.full_name}: bruto=${items.length} novos=${fresh.length} skipped=${skipped}`,
  );
  return { collected: fresh.length, skipped, raw: items.length };
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

    for (const c of candidates as Candidate[]) {
      const r = await collectRedditForCandidate(supabase, c);
      totalCollected += r.collected;
      results.push({ candidate: c.full_name, ...r });
      await new Promise((res) => setTimeout(res, 1500));
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
