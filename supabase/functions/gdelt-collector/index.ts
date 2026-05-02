// Edge function: coleta menções dos últimos dias na GDELT DOC API.
// 100% gratuita, sem chave. Documentação: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
// Para cada candidato ativo, faz uma busca no idioma português brasileiro.
//
// Body opcional: { candidateId?: string }
// Sem body: percorre TODOS os candidatos ativos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc";

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

async function fetchGdelt(query: string, maxRecords = 250): Promise<GdeltArticle[]> {
  // sourcelang:Portuguese para forçar PT, sourcecountry:BR para Brasil
  const q = `${query} sourcelang:Portuguese sourcecountry:BR`;
  const url = `${GDELT_API}?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${maxRecords}&format=JSON&timespan=24H&sort=DateDesc`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`[GDELT] HTTP ${res.status} para "${query}"`);
      return [];
    }
    const json = await res.json();
    return Array.isArray(json?.articles) ? json.articles : [];
  } catch (e) {
    console.warn(`[GDELT] erro: ${(e as Error).message}`);
    return [];
  }
}

function nameMatches(text: string, fullName: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  if (parts.length >= 2) {
    return t.includes(`${parts[0]} ${parts[parts.length - 1]}`) || t.includes(norm(fullName));
  }
  return t.includes(parts[0]);
}

function parseGdeltDate(s: string): string {
  // formato YYYYMMDDTHHmmssZ
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
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
    const candidateId: string | undefined = body.candidateId;

    // Auto-pause via quota
    const { data: skipData } = await supabase.rpc("should_skip_collector", { _name: "gdelt" });
    if (skipData === true) {
      console.log("[GDELT] pulado por quota");
      return new Response(JSON.stringify({ skipped: true, reason: "quota" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let candidates: any[] = [];
    if (candidateId) {
      const { data } = await supabase
        .from("candidates").select("id, full_name, user_id").eq("id", candidateId).maybeSingle();
      if (data) candidates = [data];
    } else {
      const { data } = await supabase
        .from("candidates").select("id, full_name, user_id").eq("status", "active").limit(500);
      candidates = data || [];
    }

    const job = (async () => {
      let totalInserted = 0;
      for (const cand of candidates) {
        const fullName = cand.full_name as string;
        const articles = await fetchGdelt(`"${fullName}"`, 250);
        if (articles.length === 0) continue;

        const rows: any[] = [];
        for (const a of articles) {
          if (!a.url || !a.title) continue;
          if (!nameMatches(a.title, fullName)) continue;
          rows.push({
            user_id: cand.user_id,
            candidate_id: cand.id,
            social_network: "GDELT",
            interaction_type: "news",
            comment_text: a.title.slice(0, 4000),
            comment_author: a.domain || "GDELT",
            author_profile_url: a.url,
            original_posted_at: parseGdeltDate(a.seendate),
            collected_at: new Date().toISOString(),
            likes_count: 0, replies_count: 0, shares_count: 0,
          });
        }

        if (rows.length === 0) continue;

        // Dedup por URL
        const urls = rows.map((r) => r.author_profile_url);
        const { data: existing } = await supabase
          .from("social_interactions")
          .select("author_profile_url")
          .eq("candidate_id", cand.id)
          .eq("social_network", "GDELT")
          .in("author_profile_url", urls);
        const exSet = new Set((existing ?? []).map((e: any) => e.author_profile_url));
        const fresh = rows.filter((r) => !exSet.has(r.author_profile_url));

        if (fresh.length > 0) {
          const { error } = await supabase.from("social_interactions").insert(fresh);
          if (!error) {
            totalInserted += fresh.length;
            console.log(`[GDELT] ${fullName}: ${fresh.length} artigos novos`);
          } else {
            console.error(`[GDELT] insert falhou: ${error.message}`);
          }
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      await supabase.rpc("record_collector_call", {
        _name: "gdelt", _items: totalInserted, _had_error: false,
      });
      console.log(`[GDELT] Concluído: ${totalInserted} artigos inseridos`);
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(job);
    }

    return new Response(JSON.stringify({
      success: true, accepted: true, candidates: candidates.length,
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro";
    console.error("[GDELT] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
