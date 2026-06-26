// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CEREBRAS_API_KEY = Deno.env.get("CEREBRAS_API_KEY");
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = "llama-3.3-70b";

const VALID_OFFICES = new Set([
  "Presidente", "Vice-presidente", "Ministro", "Governador", "Vice-governador",
  "Secretário Estadual", "Prefeito", "Vice-prefeito", "Secretário Municipal",
  "Senador", "Deputado Federal", "Deputado Estadual", "Deputado Distrital",
  "Vereador", "Presidente de partido",
]);

const KNOWN_ALIASES = new Set(["lula", "bolsonaro", "ciro", "haddad", "boulos", "tiririca", "tabata"]);

function normalizeName(value: string) {
  return (value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function localNameSanity(name: string): { ok: boolean; reason?: string } {
  const n = name.trim();
  if (n.length < 3) return { ok: false, reason: "Nome muito curto." };
  if (/\d/.test(n)) return { ok: false, reason: "Nome contém números." };
  if (!/^[A-Za-zÀ-ÿ'´`~^çÇ\s.-]+$/.test(n)) return { ok: false, reason: "Nome contém caracteres inválidos." };
  if (/(.)\1{4,}/.test(n.toLowerCase())) return { ok: false, reason: "Nome parece spam." };
  const norm = normalizeName(n);
  const words = norm.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 2 && !KNOWN_ALIASES.has(norm)) {
    return { ok: false, reason: "Informe nome e sobrenome (apelidos políticos famosos são exceção)." };
  }
  return { ok: true };
}

const SYSTEM = `Você é um analista político brasileiro. Avalie se um candidato cadastrado é plausível como político real do Brasil, com base APENAS no contexto fornecido (nome, partido, cargo, estado, município).

Você NÃO tem acesso à internet, ao TSE ou a bases públicas. Avalie pela plausibilidade semântica:
- O nome soa como um nome de pessoa brasileira real?
- O contexto é coerente (cargo válido, partido brasileiro, UF/município reais e compatíveis)?
- Há sinais óbvios de spam, fantasia ou personagem estrangeiro (ex.: "Donald Trump vereador de Tarauacá")?
- Apelidos políticos curtos (Lula, Bolsonaro, Boulos, Dr Kachan, Tiririca) SÃO válidos.
- Vereadores e prefeitos de cidades pequenas SÃO políticos legítimos — não penalize por desconhecimento.

Faixas de score:
- 90–100: altamente plausível (nome real + contexto coerente + nenhum sinal de problema)
- 70–89: plausível (sem incoerências, mas sem evidências fortes)
- 40–69: pouco confiável (dados parcialmente inconsistentes)
- 0–39: suspeito (nome de fantasia, personagem famoso fora de contexto, spam)

Responda APENAS com JSON válido:
{"score": number 0-100, "plausibility": "high"|"medium"|"low"|"suspect", "reason": string curto em pt-BR}`;

async function callCerebras(payload: any) {
  const resp = await fetch(CEREBRAS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CEREBRAS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(15000),
  });
  return resp;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (!CEREBRAS_API_KEY) return json({ error: "CEREBRAS_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const ctx = body?.context ?? {};
    const ctxParty = String(ctx?.party ?? "").trim();
    const ctxOffice = String(ctx?.office ?? "").trim();
    const ctxState = String(ctx?.state ?? "").trim();
    const ctxCity = String(ctx?.city ?? "").trim();

    if (name.length < 2) return json({ error: "name too short" }, 400);

    const sanity = localNameSanity(name);
    if (!sanity.ok) {
      return json({
        score: 10, plausibility: "suspect",
        reason: sanity.reason ?? "Nome inválido.",
        name, party: ctxParty || null, office: VALID_OFFICES.has(ctxOffice) ? ctxOffice : null,
        state: ctxState || null, city: ctxCity || null,
      });
    }

    const payload = {
      nome: name,
      partido: ctxParty || null,
      cargo: ctxOffice || null,
      estado: ctxState || null,
      municipio: ctxCity || null,
    };

    let resp = await callCerebras(payload);
    for (let attempt = 1; attempt <= 2 && resp.status === 429; attempt++) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
      resp = await callCerebras(payload);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("[lookup-candidate-ai] cerebras error", resp.status, text);
      return json({ error: resp.status === 429 ? "rate_limited" : "ai_error", status: resp.status });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    let score = Number(parsed?.score);
    if (!Number.isFinite(score)) score = 50;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const plausibility =
      score >= 90 ? "high" :
      score >= 70 ? "medium" :
      score >= 40 ? "low" : "suspect";

    return json({
      score,
      plausibility,
      reason: typeof parsed?.reason === "string" ? parsed.reason : "",
      name,
      party: ctxParty || null,
      office: VALID_OFFICES.has(ctxOffice) ? ctxOffice : null,
      state: ctxState || null,
      city: ctxCity || null,
    });
  } catch (e) {
    console.error("[lookup-candidate-ai] error", e);
    return json({ error: String(e) }, 500);
  }
});
