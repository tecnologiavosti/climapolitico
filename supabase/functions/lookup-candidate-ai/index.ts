// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Fallback chain de modelos OpenRouter — tentamos um por um.
const MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
];

const VALID_OFFICES = new Set([
  "Presidente", "Vice-presidente", "Ministro", "Governador", "Vice-governador",
  "Secretário Estadual", "Prefeito", "Vice-prefeito", "Secretário Municipal",
  "Senador", "Deputado Federal", "Deputado Estadual", "Deputado Distrital",
  "Vereador", "Presidente de partido",
]);

// Mapeia label do modal -> slug usado em public.politicians.cargo
const OFFICE_TO_CARGO_SLUG: Record<string, string> = {
  "Presidente": "presidente",
  "Vice-presidente": "vice_presidente",
  "Ministro": "ministro",
  "Governador": "governador",
  "Vice-governador": "vice_governador",
  "Senador": "senador",
  "Deputado Federal": "deputado_federal",
  "Deputado Estadual": "deputado_estadual",
  "Deputado Distrital": "deputado_distrital",
  "Prefeito": "prefeito",
  "Vice-prefeito": "vice_prefeito",
  "Vereador": "vereador",
};

const BLACKLIST = new Set([
  "batman", "naruto", "goku", "homem aranha", "homem-aranha", "spiderman",
  "messi", "cristiano ronaldo", "cr7", "elon musk", "elon",
  "superman", "mickey", "mickey mouse", "donald trump", "joe biden", "putin",
]);

const KNOWN_ALIASES = new Set([
  "lula", "bolsonaro", "ciro", "haddad", "boulos", "tiririca", "tabata",
]);

function normalize(s: string) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim();
}

// Validação local antes da IA.
function isPlausibleBrazilianCandidate(name: string): { ok: boolean; reason?: string } {
  const trimmed = (name || "").trim();
  if (trimmed.length < 3) return { ok: false, reason: "Nome muito curto." };
  if (/\d/.test(trimmed)) return { ok: false, reason: "Nome contém números." };
  if (!/^[A-Za-zÀ-ÿ'´`~^çÇ\s.-]+$/.test(trimmed)) {
    return { ok: false, reason: "Nome contém caracteres inválidos." };
  }
  if (/(.)\1{4,}/.test(trimmed.toLowerCase())) {
    return { ok: false, reason: "Nome parece spam." };
  }
  const norm = normalize(trimmed);
  if (BLACKLIST.has(norm)) {
    return { ok: false, reason: "Esse nome não parece ser de um candidato político brasileiro." };
  }
  for (const bad of BLACKLIST) {
    if (norm === bad) return { ok: false, reason: "Esse nome não parece ser de um candidato político brasileiro." };
  }
  const words = norm.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 2 && !KNOWN_ALIASES.has(norm)) {
    return { ok: false, reason: "Informe nome e sobrenome (apelidos famosos são exceção)." };
  }
  return { ok: true };
}

const SYSTEM = `Você é um analista político brasileiro. Determine se o nome fornecido pertence plausivelmente a um político brasileiro (candidato, vereador, prefeito, deputado, senador, governador, ministro ou figura pública política).

Avalie pela plausibilidade semântica do nome + contexto (partido, cargo, estado, município):
- Apelidos políticos curtos (Lula, Bolsonaro, Boulos, Dr Kachan, Tiririca) SÃO válidos.
- Vereadores e prefeitos de cidades pequenas SÃO políticos legítimos.
- Penalize nomes de personagens, estrangeiros famosos fora de contexto, ou spam.

Faixas:
- 0–30: inválido / improvável
- 31–60: incerto
- 61–100: plausível

Responda APENAS com JSON:
{"score": number 0-100, "valid": boolean, "reason": string curto em pt-BR}`;

async function callOpenRouter(model: string, payload: any): Promise<Response> {
  return await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://climapolitico.com.br",
      "X-Title": "Clima Politico",
    },
    body: JSON.stringify({
      model,
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
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: any, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const ctx = body?.context ?? {};
    const ctxParty = String(ctx?.party ?? "").trim();
    const ctxOffice = String(ctx?.office ?? "").trim();
    const ctxState = String(ctx?.state ?? "").trim();
    const ctxCity = String(ctx?.city ?? "").trim();

    if (name.length < 2) return json({ error: "name too short" }, 400);

    // 1) Validação local — bloqueia antes de chamar IA.
    const sanity = isPlausibleBrazilianCandidate(name);
    if (!sanity.ok) {
      return json({
        score: 10, valid: false, plausibility: "suspect",
        reason: sanity.reason ?? "Nome inválido.",
        name, party: ctxParty || null,
        office: VALID_OFFICES.has(ctxOffice) ? ctxOffice : null,
        state: ctxState || null, city: ctxCity || null,
      });
    }

    if (!OPENROUTER_API_KEY) {
      // Sem chave: nunca trava — devolve pendente neutro.
      return json({
        score: 50, valid: true, plausibility: "medium",
        reason: "Validação pendente: provider indisponível.",
        pending: true,
        name, party: ctxParty || null,
        office: VALID_OFFICES.has(ctxOffice) ? ctxOffice : null,
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

    // 2) Fallback automático por modelo.
    let lastErr = "";
    for (const model of MODELS) {
      try {
        const resp = await callOpenRouter(model, payload);
        if (!resp.ok) {
          lastErr = `${model} ${resp.status}`;
          console.warn("[lookup-candidate-ai] model failed", lastErr);
          continue;
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
          valid: typeof parsed?.valid === "boolean" ? parsed.valid : score >= 31,
          plausibility,
          reason: typeof parsed?.reason === "string" ? parsed.reason : "",
          provider: model,
          name,
          party: ctxParty || null,
          office: VALID_OFFICES.has(ctxOffice) ? ctxOffice : null,
          state: ctxState || null,
          city: ctxCity || null,
        });
      } catch (e) {
        lastErr = `${model} threw ${(e as Error).message}`;
        console.warn("[lookup-candidate-ai]", lastErr);
        continue;
      }
    }

    // 3) Todos os modelos falharam — NUNCA travar: retorna pendente.
    console.error("[lookup-candidate-ai] all models failed", lastErr);
    return json({
      score: 50, valid: true, plausibility: "medium",
      reason: "Não foi possível validar agora, mas você pode continuar o cadastro.",
      pending: true,
      name, party: ctxParty || null,
      office: VALID_OFFICES.has(ctxOffice) ? ctxOffice : null,
      state: ctxState || null, city: ctxCity || null,
    });
  } catch (e) {
    console.error("[lookup-candidate-ai] error", e);
    // Nunca propaga erro — mantém UI estável.
    return json({
      score: 50, valid: true, plausibility: "medium",
      reason: "Não foi possível validar agora, mas você pode continuar o cadastro.",
      pending: true,
    });
  }
});
