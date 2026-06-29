// Classifica uma figura como pré-candidato político via IA (chain Cerebras→...→Lovable).
// Cacheia em analysis_cache 24h. Se confidence>=70 faz upsert em pre_candidates.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { normalizeName } from "../_shared/normalize-name.ts";

interface Body {
  nome: string;
  contexto?: string;
  estado?: string;
  municipio?: string;
  signals?: Array<{ source: string; url?: string; snippet?: string; matched_keywords?: string[] }>;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CACHE_TTL_HOURS = 24;

const SYSTEM = `Você é um analista político brasileiro especializado em detectar pré-candidatos a cargos eletivos no Brasil para o ciclo de 2026. Responda SEMPRE em JSON válido.`;

function buildPrompt(b: Body): string {
  return `Analise se a pessoa abaixo demonstra sinais reais de pré-candidatura política no Brasil em 2026.

Nome: ${b.nome}
${b.estado ? `Estado: ${b.estado}` : ""}
${b.municipio ? `Município: ${b.municipio}` : ""}
${b.contexto ? `Contexto adicional:\n${b.contexto}` : ""}

Considere:
- menções eleitorais
- discurso político
- participação em eventos políticos
- hashtags de campanha
- slogans ("rumo a Brasília", "conto com vocês em 2026", etc.)
- alianças partidárias
- cobertura em notícias

Retorne JSON estrito:
{
  "is_political": boolean,
  "confidence": number (0-100),
  "cargo_sugerido": string ("Presidente"|"Governador"|"Senador"|"Deputado Federal"|"Deputado Estadual"|"Prefeito"|"Vereador"|"Pré-candidato"|null),
  "partido_sugerido": string|null,
  "reason": string (1-2 frases em português)
}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    if (!body?.nome || body.nome.trim().length < 2) {
      return new Response(JSON.stringify({ error: "nome obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const norm = normalizeName(body.nome);
    const cacheKey = `precand-classify:${norm}:${body.estado || ""}:${body.municipio || ""}`;
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // Cache lookup
    const { data: cached } = await db
      .from("analysis_cache")
      .select("result, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached && cached.expires_at && new Date(cached.expires_at) > new Date()) {
      return new Response(JSON.stringify({ ...cached.result, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI call
    const ai = await callAICerebrasFirst({
      systemMsg: SYSTEM,
      userPrompt: buildPrompt(body),
      jsonMode: true,
      maxTokens: 400,
      temperature: 0.2,
      tag: "classify-political-figure",
    });

    let parsed: any;
    try { parsed = JSON.parse(ai.content); } catch { parsed = null; }
    if (!parsed || typeof parsed.confidence !== "number") {
      return new Response(JSON.stringify({ error: "AI parse failed", raw: ai.content }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    const result = {
      is_political: !!parsed.is_political,
      confidence,
      cargo_sugerido: parsed.cargo_sugerido || null,
      partido_sugerido: parsed.partido_sugerido || null,
      reason: String(parsed.reason || ""),
      provider: ai.provider,
      model: ai.model,
    };

    // Cache
    const expires = new Date(Date.now() + CACHE_TTL_HOURS * 3600_000).toISOString();
    await db.from("analysis_cache").upsert({
      cache_key: cacheKey,
      result,
      expires_at: expires,
    }, { onConflict: "cache_key" });

    // Auto-save when confident
    if (result.is_political && confidence >= 70) {
      const { data: existing } = await db
        .from("pre_candidates")
        .select("id")
        .eq("nome_normalizado", norm)
        .eq("estado", body.estado || null)
        .eq("municipio", body.municipio || null)
        .maybeSingle();

      const payload: Record<string, unknown> = {
        nome: body.nome.trim(),
        nome_normalizado: norm,
        estado: body.estado || null,
        municipio: body.municipio || null,
        cargo_sugerido: result.cargo_sugerido,
        partido_sugerido: result.partido_sugerido,
        confidence_score: confidence,
        source: "ai",
        reason: result.reason,
        status: "auto_detected",
      };

      if (existing?.id) {
        await db.from("pre_candidates").update(payload).eq("id", existing.id);
      } else {
        const { data: ins } = await db.from("pre_candidates").insert(payload).select("id").maybeSingle();
        if (ins?.id && body.signals?.length) {
          await db.from("pre_candidate_signals").insert(
            body.signals.slice(0, 20).map((s) => ({
              pre_candidate_id: ins.id,
              nome_normalizado: norm,
              source: s.source,
              url: s.url || null,
              snippet: s.snippet || null,
              matched_keywords: s.matched_keywords || [],
            })),
          );
        }
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[classify-political-figure]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
