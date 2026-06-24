// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const CACHE_TTL_HOURS = 24;

async function sha256(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getCache(key: string) {
  const { data } = await admin
    .from("analysis_cache")
    .select("result, expires_at")
    .eq("cache_key", key)
    .eq("analysis_type", "politicians_search_ai")
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  admin.from("analysis_cache").update({
    hit_count: 1, last_hit_at: new Date().toISOString(),
  } as any).eq("cache_key", key).then(() => {});
  return data.result;
}

async function setCache(key: string, result: any) {
  const expires = new Date(Date.now() + CACHE_TTL_HOURS * 3600 * 1000).toISOString();
  await admin.from("analysis_cache").upsert({
    cache_key: key,
    analysis_type: "politicians_search_ai",
    result,
    provider: "lovable-ai",
    expires_at: expires,
    last_hit_at: new Date().toISOString(),
  } as any, { onConflict: "cache_key" });
}

interface Filters {
  q?: string | null;
  cargo?: string[] | null;
  partido?: string[] | null;
  regiao?: string[] | null;
  estado?: string[] | null;
  municipio?: string | null;
  onlyEleitos?: boolean;
  page?: number;
}

const NORMALIZE_SYSTEM = `Você é um normalizador de busca política brasileira.
Receba filtros do usuário com possíveis erros (acentos, typos, abreviações).
Corrija e devolva JSON com as chaves:
{
  "q": string|null,          // nome corrigido (Ex: "Flavio Bolsonaro" -> "Flávio Bolsonaro")
  "municipio": string|null,  // município corrigido (Ex: "Jundiai" -> "Jundiaí")
  "estado": string|null,     // sigla UF de 2 letras, se identificável
  "partido": string|null     // sigla partido em maiúsculas (PT, PL, MDB...)
}
Se um campo não tem correção ou está vazio, devolva null. NUNCA invente nomes — só corrija ortografia.`;

const SUGGEST_SYSTEM = `Você é um especialista em política brasileira. Liste até 5 nomes de políticos brasileiros REAIS cujo nome se assemelha ao termo buscado (typo, acento, apelido). Devolva JSON: {"suggestions":[{"nome":"...","cargo":"...","estado":"UF","partido":"..."}]}`;

async function callAi(system: string, user: string): Promise<any> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Lovable-API-Key": LOVABLE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
  } catch { return null; }
}

async function runSearch(f: Filters) {
  const { data, error } = await admin.rpc("search_politicians", {
    q: f.q?.trim() || null,
    p_cargo: f.cargo?.length ? f.cargo : null,
    p_partido: f.partido?.length ? f.partido : null,
    p_regiao: f.regiao?.length ? f.regiao : null,
    p_estado: f.estado?.length ? f.estado : null,
    p_municipio: f.municipio?.trim() || null,
    p_only_eleitos: !!f.onlyEleitos,
    p_limit: 50,
    p_offset: (f.page ?? 0) * 50,
  } as any);
  if (error) throw error;
  return (data ?? []) as any[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const filters: Filters = await req.json();

    const cacheKey = await sha256("v1:" + JSON.stringify(filters));
    const cached = await getCache(cacheKey);
    if (cached) {
      return new Response(JSON.stringify({ ...cached, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. AI normalize (only if there's text to normalize)
    let normalized: Filters = { ...filters };
    const normNotes: Record<string, string> = {};
    if (filters.q || filters.municipio) {
      const ai = await callAi(
        NORMALIZE_SYSTEM,
        JSON.stringify({
          q: filters.q ?? null,
          municipio: filters.municipio ?? null,
          estado: filters.estado?.[0] ?? null,
          partido: filters.partido?.[0] ?? null,
        }),
      );
      if (ai) {
        if (ai.q && filters.q && ai.q !== filters.q) { normalized.q = ai.q; normNotes.q = ai.q; }
        if (ai.municipio && filters.municipio && ai.municipio !== filters.municipio) {
          normalized.municipio = ai.municipio; normNotes.municipio = ai.municipio;
        }
        if (ai.estado && !filters.estado?.length) normalized.estado = [ai.estado];
        if (ai.partido && !filters.partido?.length) normalized.partido = [ai.partido];
      }
    }

    // 2. Search with normalized filters
    let rows = await runSearch(normalized);
    let total = rows[0]?.total_count ?? 0;

    // 3. Fallback to original if normalized returned 0
    if (rows.length === 0 && JSON.stringify(normalized) !== JSON.stringify(filters)) {
      rows = await runSearch(filters);
      total = rows[0]?.total_count ?? 0;
    }

    // 4. AI suggestions if still empty
    let suggestions: any[] = [];
    if (rows.length === 0 && filters.q?.trim()) {
      const { data: sug } = await admin.rpc("suggest_politicians", {
        q: filters.q.trim(), p_limit: 5,
      } as any);
      suggestions = (sug ?? []) as any[];
      if (suggestions.length === 0) {
        const ai = await callAi(SUGGEST_SYSTEM, filters.q);
        if (ai?.suggestions) suggestions = ai.suggestions.map((s: any, i: number) => ({
          id: `ai-${i}`, nome: s.nome, cargo: s.cargo, estado: s.estado,
          partido_sigla: s.partido, similarity: 0.5, ai_generated: true,
        }));
      }
    }

    const payload = {
      rows,
      total: Number(total),
      suggestions,
      normalized: normNotes,
      page: filters.page ?? 0,
    };
    await setCache(cacheKey, payload);

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[search-politicians-ai]", e);
    return new Response(JSON.stringify({ error: String(e), rows: [], total: 0, suggestions: [] }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
