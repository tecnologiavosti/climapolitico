// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Você é um especialista em política brasileira. Sua tarefa é identificar
políticos brasileiros (em qualquer esfera: federal, estadual, municipal) pelo nome,
mesmo com erros ortográficos, falta de acentos, apelidos ou nomes parciais.

Fontes consideradas: TSE, Câmara dos Deputados, Senado Federal, Assembleias
Legislativas, Câmaras Municipais, Prefeituras, partidos políticos.

Regras:
- Se identificar a pessoa com alta confiança, retorne os dados estruturados.
- Se houver dúvida razoável, retorne a melhor hipótese com confidence menor.
- Se realmente não identificar, retorne found=false.
- NUNCA invente partido, cargo ou cidade — só retorne se tiver convicção.
- Cargo deve ser um destes: Presidente, Vice-presidente, Ministro, Governador,
  Vice-governador, Secretário Estadual, Prefeito, Vice-prefeito, Secretário Municipal,
  Senador, Deputado Federal, Deputado Estadual, Deputado Distrital, Vereador,
  Presidente de partido, Ex-candidato, Influenciador político, Jornalista político.
- Estado deve ser a sigla (UF) de 2 letras, ou null para cargos nacionais.

Responda APENAS com JSON válido no formato:
{
  "found": boolean,
  "name": string | null,
  "party": string | null,
  "office": string | null,
  "state": string | null,
  "city": string | null,
  "confidence": number,
  "rationale": string
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (name.length < 3) {
      return new Response(JSON.stringify({ found: false, error: "name too short" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Identifique este político brasileiro: "${name}"` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[lookup-candidate-ai] gateway error", resp.status, text);
      return new Response(JSON.stringify({ found: false, error: "ai_gateway_error", status: resp.status }), {
        status: resp.status === 429 || resp.status === 402 ? resp.status : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { found: false }; }

    const result = {
      found: !!parsed.found && (parsed.confidence ?? 0) >= 0.5,
      name: parsed.name ?? null,
      party: parsed.party ?? null,
      office: parsed.office ?? null,
      state: parsed.state ?? null,
      city: parsed.city ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      rationale: parsed.rationale ?? null,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[lookup-candidate-ai] error", e);
    return new Response(JSON.stringify({ found: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
