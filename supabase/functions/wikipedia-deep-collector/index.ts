// Edge function: coleta PROFUNDA na Wikipedia/Wikinews (PT + EN)
// Sem API key. Fontes:
//   1) summary (REST) - resumo principal
//   2) search API - artigos relacionados (até 10)
//   3) revisions API - últimas 20 revisões do artigo principal (cada revisão = 1 interação histórica)
//   4) Wikinews PT (pt.wikinews.org) - notícias relacionadas
//   5) sections - extrai parágrafos das seções "Polêmicas", "Carreira política", "Controvérsias"
//
// Cada item é gravado como social_network='wikipedia' em social_interactions (SSOT).
// Idempotente via author_profile_url (URL única por artigo/revisão).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "ClimaPolitico/1.0 (https://climapolitico.lovable.app)";
const HEADERS = { "User-Agent": UA, "Accept": "application/json" };

interface CollectedItem {
  title: string;
  text: string;
  url: string;
  author: string;
  postedAt: string;
  type: string; // 'article' | 'revision' | 'related' | 'news' | 'section'
}

async function safeFetch(url: string, timeoutMs = 12000): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) {
      console.warn(`[WIKI] HTTP ${r.status} ${url}`);
      return null;
    }
    return r;
  } catch (e) {
    console.warn(`[WIKI] fetch erro ${url}:`, (e as Error).message);
    return null;
  }
}

async function getSummary(domain: string, title: string): Promise<CollectedItem | null> {
  const url = `https://${domain}/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await safeFetch(url);
  if (!r) return null;
  const d = await r.json();
  if (!d?.extract) return null;
  return {
    title: d.title,
    text: d.extract,
    url: d.content_urls?.desktop?.page || `https://${domain}/wiki/${encodeURIComponent(d.title)}`,
    author: domain.split(".")[0] === "pt" ? "Wikipedia PT" : "Wikipedia",
    postedAt: new Date().toISOString(),
    type: "article",
  };
}

async function searchTitles(domain: string, q: string, limit = 10): Promise<string[]> {
  const url = `https://${domain}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${limit}`;
  const r = await safeFetch(url);
  if (!r) return [];
  const d = await r.json();
  return (d?.query?.search || []).map((s: any) => s.title).filter(Boolean);
}

async function getRevisions(domain: string, title: string, limit = 20): Promise<CollectedItem[]> {
  // Últimas N revisões com comentário do editor — revela polêmicas/edições recentes
  const url = `https://${domain}/w/api.php?action=query&prop=revisions&titles=${encodeURIComponent(title)}` +
    `&rvprop=timestamp|user|comment|size&rvlimit=${limit}&format=json`;
  const r = await safeFetch(url);
  if (!r) return [];
  const d = await r.json();
  const pages = d?.query?.pages || {};
  const items: CollectedItem[] = [];
  for (const pid of Object.keys(pages)) {
    const revs = pages[pid]?.revisions || [];
    for (const rev of revs) {
      const comment = (rev.comment || "").trim();
      if (!comment || comment.length < 8) continue; // ignora bot/typo
      items.push({
        title: `Revisão por ${rev.user}`,
        text: comment,
        url: `https://${domain}/wiki/${encodeURIComponent(title)}?oldid=${rev.revid || ""}#${rev.timestamp}`,
        author: rev.user || "anon",
        postedAt: rev.timestamp,
        type: "revision",
      });
    }
  }
  return items;
}

async function getSections(domain: string, title: string): Promise<CollectedItem[]> {
  // Pega o HTML da página e extrai parágrafos das seções "polêmicas/controvérsias/carreira política"
  const url = `https://${domain}/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections|wikitext&format=json`;
  const r = await safeFetch(url);
  if (!r) return [];
  const d = await r.json();
  const sections = d?.parse?.sections || [];
  const wikitext: string = d?.parse?.wikitext?.["*"] || "";
  const wanted = sections.filter((s: any) =>
    /polêmic|controvérsi|carreira política|crítica|denúnci|escândalo|processo|investigaç/i.test(s.line || "")
  );
  const items: CollectedItem[] = [];
  for (const s of wanted) {
    // Extrai bloco bruto do wikitext após "== Título =="
    const re = new RegExp(`={2,4}\\s*${s.line.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*={2,4}([\\s\\S]*?)(?=\\n={2,4}|$)`, "i");
    const m = wikitext.match(re);
    if (!m) continue;
    const clean = m[1]
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
      .replace(/<ref[^>]*\/>/gi, "")
      .replace(/\{\{[^}]*\}\}/g, "")
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
      .replace(/'''?/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
      .slice(0, 2000);
    if (clean.length < 60) continue;
    items.push({
      title: s.line,
      text: clean,
      url: `https://${domain}/wiki/${encodeURIComponent(title)}#${encodeURIComponent(s.anchor || s.line)}`,
      author: `Wikipedia §${s.line}`,
      postedAt: new Date().toISOString(),
      type: "section",
    });
  }
  return items;
}

async function collectForCandidate(candidateName: string): Promise<CollectedItem[]> {
  const all: CollectedItem[] = [];

  // 1) PT summary direto
  const ptDirect = await getSummary("pt.wikipedia.org", candidateName);
  if (ptDirect) all.push(ptDirect);

  // 2) Search PT (artigos relacionados)
  const ptTitles = await searchTitles("pt.wikipedia.org", candidateName, 8);
  for (const t of ptTitles.slice(0, 5)) {
    const s = await getSummary("pt.wikipedia.org", t);
    if (s) all.push({ ...s, type: ptDirect && t === ptDirect.title ? "article" : "related" });
  }

  // 3) Revisões + seções do artigo principal
  const mainTitle = ptDirect?.title || ptTitles[0];
  if (mainTitle) {
    const [revs, secs] = await Promise.all([
      getRevisions("pt.wikipedia.org", mainTitle, 25),
      getSections("pt.wikipedia.org", mainTitle),
    ]);
    all.push(...revs, ...secs);
  }

  // 4) Wikinews PT
  const newsTitles = await searchTitles("pt.wikinews.org", candidateName, 10);
  for (const t of newsTitles.slice(0, 8)) {
    const s = await getSummary("pt.wikinews.org", t);
    if (s) all.push({ ...s, author: "Wikinews", type: "news" });
  }

  // 5) EN summary (fallback p/ figuras internacionais)
  if (!ptDirect) {
    const enDirect = await getSummary("en.wikipedia.org", candidateName);
    if (enDirect) all.push(enDirect);
  }

  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const targetCandidateId = body.candidateId as string | undefined;
    const targetName = body.candidateName as string | undefined;

    let candidates: Array<{ id: string; full_name: string; user_id: string }> = [];
    if (targetCandidateId) {
      const { data } = await supabase.from("candidates")
        .select("id, full_name, user_id").eq("id", targetCandidateId).maybeSingle();
      if (data) candidates = [data as any];
    } else {
      const { data } = await supabase.from("candidates")
        .select("id, full_name, user_id").eq("status", "active").limit(200);
      candidates = (data || []) as any[];
    }

    let totalInserted = 0;
    let totalCollected = 0;
    const summary: Array<{ name: string; collected: number; inserted: number }> = [];

    for (const c of candidates) {
      const name = targetName && c.id === targetCandidateId ? targetName : c.full_name;
      const items = await collectForCandidate(name);
      totalCollected += items.length;

      let inserted = 0;
      for (const item of items) {
        // Dedup por URL única
        const { data: existing } = await supabase
          .from("social_interactions")
          .select("id")
          .eq("candidate_id", c.id)
          .eq("social_network", "wikipedia")
          .eq("author_profile_url", item.url)
          .maybeSingle();
        if (existing) continue;

        const { error } = await supabase.from("social_interactions").insert({
          user_id: c.user_id,
          candidate_id: c.id,
          social_network: "wikipedia",
          interaction_type: item.type,
          comment_text: item.text.slice(0, 4000),
          comment_author: item.author,
          author_profile_url: item.url,
          sentiment_label: "Neutro",
          sentiment_score: 0.5,
          likes_count: 0,
          replies_count: 0,
          shares_count: 0,
          collected_at: new Date().toISOString(),
          original_posted_at: item.postedAt,
        });
        if (!error) inserted++;
      }
      totalInserted += inserted;
      summary.push({ name, collected: items.length, inserted });
      await new Promise((r) => setTimeout(r, 400));
    }

    try {
      await supabase.rpc("record_collector_call", {
        _name: "wikipedia", _items: totalInserted, _had_error: false,
      });
    } catch (_) {}

    return new Response(JSON.stringify({
      success: true,
      candidates_processed: candidates.length,
      total_collected: totalCollected,
      total_inserted: totalInserted,
      details: summary,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[WIKI-DEEP] erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
