// Auto-descobre o @handle do TikTok de um candidato usando Firecrawl Search.
// Estratégia: busca "Nome Candidato site:tiktok.com", extrai handles dos resultados,
// valida cada candidato via Tikwm (verifica se perfil existe e tem posts), escolhe o melhor.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

interface HandleCandidate {
  handle: string;
  source: string; // url onde foi encontrado
  score: number;
}

function extractHandlesFromText(text: string): string[] {
  const out = new Set<string>();
  const re = /tiktok\.com\/@([A-Za-z0-9_.]{2,24})/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const h = m[1].toLowerCase();
    // ignora subpáginas comuns
    if (!["explore", "live", "foryou", "search", "tag", "music", "discover"].includes(h)) {
      out.add(h);
    }
  }
  return [...out];
}

async function firecrawlSearch(query: string): Promise<HandleCandidate[]> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY ausente");

  const resp = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 10, lang: "pt", country: "br" }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error || `Firecrawl HTTP ${resp.status}`);

  // Resposta pode vir em data[] ou data.web[]
  const results: any[] = Array.isArray(json?.data) ? json.data : (json?.data?.web || []);
  const found = new Map<string, HandleCandidate>();
  for (const r of results) {
    const url: string = r?.url || "";
    const title: string = r?.title || "";
    const desc: string = r?.description || r?.snippet || "";
    const blob = `${url} ${title} ${desc}`;
    for (const h of extractHandlesFromText(blob)) {
      const existing = found.get(h);
      const score = (existing?.score || 0) + 1;
      found.set(h, { handle: h, source: url, score });
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

async function validateHandleViaTikwm(handle: string, fullName: string): Promise<{ ok: boolean; postCount: number; nickname?: string; matchScore: number }> {
  try {
    const url = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(handle)}&count=5&cursor=0`;
    const resp = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) return { ok: false, postCount: 0, matchScore: 0 };
    const json = await resp.json();
    if (json?.code !== 0) return { ok: false, postCount: 0, matchScore: 0 };
    const videos = json?.data?.videos || [];
    const nickname: string = videos[0]?.author?.nickname || "";
    const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "");
    const fn = normalize(fullName);
    const nn = normalize(nickname);
    const hh = normalize(handle);
    let matchScore = 0;
    const tokens = fn.split(/\s+/).filter((t) => t.length >= 3);
    for (const t of tokens) {
      if (nn.includes(t)) matchScore += 2;
      if (hh.includes(t)) matchScore += 1;
    }
    return { ok: videos.length > 0, postCount: videos.length, nickname, matchScore };
  } catch {
    return { ok: false, postCount: 0, matchScore: 0 };
  }
}

async function resolveHandle(fullName: string, currentLink: string | null): Promise<{ handle: string | null; nickname?: string; reason: string; alternatives: HandleCandidate[] }> {
  // 1. Se já tem link válido com @, mantém
  if (currentLink) {
    const m = currentLink.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i);
    if (m?.[1]) {
      const v = await validateHandleViaTikwm(m[1], fullName);
      if (v.ok) return { handle: m[1], nickname: v.nickname, reason: "link existente válido", alternatives: [] };
    }
  }

  // 2. Busca via Firecrawl
  const queries = [
    `site:tiktok.com "${fullName}"`,
    `"${fullName}" tiktok oficial`,
    `${fullName} tiktok @`,
  ];
  const all = new Map<string, HandleCandidate>();
  for (const q of queries) {
    try {
      const found = await firecrawlSearch(q);
      for (const c of found) {
        const ex = all.get(c.handle);
        all.set(c.handle, { ...c, score: (ex?.score || 0) + c.score });
      }
    } catch (e) {
      console.warn(`[resolve-handle] busca "${q}" falhou:`, e instanceof Error ? e.message : e);
    }
  }

  if (all.size === 0) {
    return { handle: null, reason: "Nenhum @ encontrado nas buscas", alternatives: [] };
  }

  // 3. Valida cada candidato via Tikwm e ranqueia
  const ranked: Array<HandleCandidate & { matchScore: number; postCount: number; nickname?: string }> = [];
  for (const cand of [...all.values()].slice(0, 8)) {
    const v = await validateHandleViaTikwm(cand.handle, fullName);
    if (v.ok) {
      ranked.push({ ...cand, matchScore: v.matchScore, postCount: v.postCount, nickname: v.nickname });
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (ranked.length === 0) {
    return { handle: null, reason: "Nenhum candidato passou na validação Tikwm", alternatives: [...all.values()].slice(0, 5) };
  }

  // Score final = matchScore (similaridade nome) * 3 + score (frequência) + postCount bonus
  ranked.sort((a, b) => (b.matchScore * 3 + b.score + Math.min(b.postCount, 5)) - (a.matchScore * 3 + a.score + Math.min(a.postCount, 5)));
  const best = ranked[0];
  return {
    handle: best.handle,
    nickname: best.nickname,
    reason: `Melhor match (score=${best.matchScore}, freq=${best.score}, posts=${best.postCount})`,
    alternatives: ranked.slice(1, 4),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { candidateId, autoSave = true } = await req.json().catch(() => ({}));
    if (!candidateId) {
      return new Response(JSON.stringify({ error: "candidateId obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: c, error } = await supabase
      .from("candidates")
      .select("id, full_name, social_media_link, user_id")
      .eq("id", candidateId)
      .maybeSingle();
    if (error || !c) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[resolve-handle] Resolvendo TikTok para: ${c.full_name}`);
    const result = await resolveHandle(c.full_name, c.social_media_link);

    if (result.handle && autoSave) {
      const newLink = `https://www.tiktok.com/@${result.handle}`;
      // Só sobrescreve se o link atual não for de outra rede social diferente
      const currentIsTikTok = (c.social_media_link || "").includes("tiktok.com");
      const currentIsEmpty = !c.social_media_link;
      if (currentIsEmpty || currentIsTikTok) {
        await supabase.from("candidates").update({ social_media_link: newLink }).eq("id", candidateId);
        console.log(`[resolve-handle] ${c.full_name} → @${result.handle} (salvo)`);
      } else {
        console.log(`[resolve-handle] ${c.full_name} → @${result.handle} (NÃO salvo, link atual é de outra rede)`);
      }
    }

    return new Response(JSON.stringify({ ok: true, candidate: c.full_name, ...result, savedLink: result.handle ? `https://www.tiktok.com/@${result.handle}` : null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[resolve-handle] erro:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
