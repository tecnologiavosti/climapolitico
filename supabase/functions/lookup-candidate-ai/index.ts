// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYSTEM = `Você é um especialista em política brasileira. Sua tarefa é identificar
políticos brasileiros (em qualquer esfera: federal, estadual, municipal) pelo nome,
mesmo com erros ortográficos, falta de acentos, apelidos ou nomes parciais.

Fontes consideradas: TSE, Senado Federal, Câmara dos Deputados, Assembleias
Legislativas, Câmaras Municipais, Prefeituras, governos estaduais e partidos políticos.

Regras:
- Se identificar a pessoa com alta confiança, retorne os dados estruturados.
- Se houver dúvida razoável, retorne a melhor hipótese com confidence menor.
- Se realmente não identificar, retorne found=false.
- NUNCA invente partido, cargo, estado ou cidade — só retorne se tiver convicção.
- Responda found=true apenas para políticos brasileiros reais ou dirigentes partidários.
- Cargo deve ser um destes: Presidente, Vice-presidente, Ministro, Governador,
  Vice-governador, Secretário Estadual, Prefeito, Vice-prefeito, Secretário Municipal,
  Senador, Deputado Federal, Deputado Estadual, Deputado Distrital, Vereador,
  Presidente de partido.
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

    const callGateway = async () => fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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

    let resp = await callGateway();
    // Retry on 429 with exponential backoff + jitter
    for (let attempt = 1; attempt <= 3 && resp.status === 429; attempt++) {
      const wait = Math.min(8000, 600 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
      console.warn(`[lookup-candidate-ai] 429 — retry ${attempt}/3 in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      resp = await callGateway();
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("[lookup-candidate-ai] gateway error", resp.status, text);
      // Always return 200 with found=false so the client UI degrades gracefully
      const friendly =
        resp.status === 429 ? "rate_limited" :
        resp.status === 402 ? "credits_exhausted" : "ai_gateway_error";
      return new Response(JSON.stringify({ found: false, error: friendly, status: resp.status }), {
        status: 200,
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
