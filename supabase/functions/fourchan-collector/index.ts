// Coletor 4chan /pol/ + /news/ - API pública JSON, sem key
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resilientFetch } from "../_shared/scrape-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOARDS = ["pol", "news", "biz"];

async function getCatalog(board: string): Promise<any[]> {
  const r = await resilientFetch(`https://a.4cdn.org/${board}/catalog.json`, { timeoutMs: 12000 });
  if (!r) return [];
  try {
    const d = await r.json();
    const threads: any[] = [];
    for (const page of d) for (const t of (page.threads || [])) threads.push({ ...t, board });
    return threads;
  } catch { return []; }
}

async function getThread(board: string, no: number): Promise<any[]> {
  const r = await resilientFetch(`https://a.4cdn.org/${board}/thread/${no}.json`, { timeoutMs: 12000 });
  if (!r) return [];
  try {
    const d = await r.json();
    return d?.posts || [];
  } catch { return []; }
}

function clean(html: string): string {
  return (html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const targetId = body.candidateId as string | undefined;

    let candidates: any[] = [];
    if (targetId) {
      const { data } = await supabase.from("candidates").select("id, full_name, user_id").eq("id", targetId).maybeSingle();
      if (data) candidates = [data];
    } else {
      const { data } = await supabase.from("candidates").select("id, full_name, user_id").eq("status", "active").limit(200);
      candidates = data || [];
    }

    // Carrega todos os catálogos uma vez (e reusa pra todos os candidatos)
    const allThreads: any[] = [];
    for (const b of BOARDS) {
      allThreads.push(...await getCatalog(b));
      await new Promise(r => setTimeout(r, 800));
    }

    let totalInserted = 0;
    for (const c of candidates) {
      const nameLow = c.full_name.toLowerCase();
      const nameTokens = nameLow.split(/\s+/).filter((t: string) => t.length > 3);
      // Filtra threads cujo subject/com mencionam o nome
      const matches = allThreads.filter(t => {
        const blob = `${t.sub || ""} ${clean(t.com || "")}`.toLowerCase();
        return blob.includes(nameLow) || nameTokens.every((tk: string) => blob.includes(tk));
      });
      for (const t of matches.slice(0, 30)) {
        const posts = await getThread(t.board, t.no);
        for (const p of posts.slice(0, 50)) {
          const text = clean(p.com || "").slice(0, 4000);
          if (!text || text.length < 20) continue;
          if (!text.toLowerCase().includes(nameTokens[0] || nameLow)) continue;
          const url = `https://boards.4chan.org/${t.board}/thread/${t.no}#p${p.no}`;
          const { data: existing } = await supabase
            .from("social_interactions").select("id")
            .eq("candidate_id", c.id).eq("social_network", "4chan")
            .eq("author_profile_url", url).maybeSingle();
          if (existing) continue;
          const { error } = await supabase.from("social_interactions").insert({
            user_id: c.user_id, candidate_id: c.id, social_network: "4chan",
            interaction_type: "post", comment_text: text,
            comment_author: p.name || "Anonymous", author_profile_url: url,
            sentiment_label: "Neutro", sentiment_score: 0.5,
            likes_count: 0, replies_count: 0, shares_count: 0,
            collected_at: new Date().toISOString(),
            original_posted_at: new Date(p.time * 1000).toISOString(),
          });
          if (!error) totalInserted++;
        }
        await new Promise(r => setTimeout(r, 1200)); // 4chan exige 1 req/s
      }
    }
    try { await supabase.rpc("record_collector_call", { _name: "4chan", _items: totalInserted, _had_error: false }); } catch (_) {}
    return new Response(JSON.stringify({ success: true, total_inserted: totalInserted, candidates: candidates.length, threads_scanned: allThreads.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[4CHAN]", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
