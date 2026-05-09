// Bulk sentiment backfill with provider fallback, exponential backoff, circuit breaker.
// Designed to safely process 20k+ records without busting rate limits.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Provider = "lovable" | "groq" | "cerebras" | "gemini";

interface ProviderState {
  failures: number;
  openedAt: number | null; // circuit breaker open timestamp
}

const state: Record<Provider, ProviderState> = {
  lovable: { failures: 0, openedAt: null },
  groq: { failures: 0, openedAt: null },
  cerebras: { failures: 0, openedAt: null },
  gemini: { failures: 0, openedAt: null },
};

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

function isOpen(p: Provider): boolean {
  const s = state[p];
  if (s.openedAt === null) return false;
  if (Date.now() - s.openedAt > CIRCUIT_COOLDOWN_MS) {
    s.openedAt = null;
    s.failures = 0;
    return false;
  }
  return true;
}

function recordFailure(p: Provider) {
  const s = state[p];
  s.failures++;
  if (s.failures >= CIRCUIT_THRESHOLD) s.openedAt = Date.now();
}

function recordSuccess(p: Provider) {
  state[p] = { failures: 0, openedAt: null };
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry<T>(fn: () => Promise<T>, max = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      await sleep(Math.min(1000 * Math.pow(2, i), 8000));
    }
  }
  throw lastErr;
}

const SYSTEM_PROMPT = `Você é um classificador de sentimento político em PT-BR.
Classifique o comentário sobre um candidato em: positive, negative ou neutral.
Retorne JSON com {"label":"positive|negative|neutral","score":-1..1,"confidence":0..1}.
Só use "neutral" se o texto for genuinamente factual SEM opinião. Ironia/sarcasmo conta como sentimento.`;

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // Heuristic fallback
  const lower = s.toLowerCase();
  if (/positiv|favor|apoio|elogio/.test(lower)) return { label: "positive", score: 0.5, confidence: 0.5 };
  if (/negativ|critica|ruim|odeio|contra/.test(lower)) return { label: "negative", score: -0.5, confidence: 0.5 };
  return { label: "neutral", score: 0, confidence: 0.4 };
}

async function callLovable(text: string): Promise<any> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("no LOVABLE_API_KEY");
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: text }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`lovable ${r.status}`);
  const j = await r.json();
  return safeJson(j.choices[0].message.content);
}

async function callGroq(text: string): Promise<any> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("no GROQ_API_KEY");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: text }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

async function callCerebras(text: string): Promise<any> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) throw new Error("no CEREBRAS_API_KEY");
  const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.1-8b",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: text }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`cerebras ${r.status}`);
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

async function callGemini(text: string): Promise<any> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("no GEMINI_API_KEY");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nTexto: ${text}\n\nResponda APENAS JSON.` }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const j = await r.json();
  return JSON.parse(j.candidates[0].content.parts[0].text);
}

const PROVIDERS: Array<[Provider, (t: string) => Promise<any>]> = [
  ["lovable", callLovable],
  ["groq", callGroq],
  ["cerebras", callCerebras],
  ["gemini", callGemini],
];

async function classifyWithFallback(text: string): Promise<{ result: any; provider: Provider }> {
  let lastErr: any;
  for (const [name, fn] of PROVIDERS) {
    if (isOpen(name)) continue;
    try {
      const result = await withRetry(() => fn(text), 2);
      recordSuccess(name);
      return { result, provider: name };
    } catch (e) {
      recordFailure(name);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all providers down");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(Number(body.limit) || 200, 500);
  const mode = body.mode || "nulls"; // nulls | low_confidence

  let query = supa.from("social_interactions")
    .select("id, comment_text, candidate_id, user_id, sentiment_label, sentiment_confidence, analysis_attempts")
    .not("comment_text", "is", null)
    .lt("analysis_attempts", 5)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (mode === "nulls") query = query.is("sentiment_label", null);
  else query = query.eq("sentiment_label", "neutral").lt("sentiment_confidence", 0.6);

  const { data: rows, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!rows?.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: "nothing to do" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0, failed = 0;
  const providerCounts: Record<string, number> = {};

  // Process in chunks of 5 in parallel; light throttling.
  const CHUNK = 5;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await Promise.all(slice.map(async (row: any) => {
      const text = String(row.comment_text || "").slice(0, 2000);
      try {
        const { result, provider } = await classifyWithFallback(text);
        providerCounts[provider] = (providerCounts[provider] || 0) + 1;
        const label = ["positive", "negative", "neutral"].includes(result.label) ? result.label : "neutral";
        const score = typeof result.score === "number" ? Math.max(-1, Math.min(1, result.score)) : 0;
        const confidence = typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : 0.5;
        await supa.from("social_interactions").update({
          sentiment_label: label,
          sentiment_score: score,
          sentiment_confidence: confidence,
          analysis_attempts: (row.analysis_attempts || 0) + 1,
        }).eq("id", row.id);
        processed++;
      } catch (e: any) {
        failed++;
        await supa.from("social_interactions")
          .update({ analysis_attempts: (row.analysis_attempts || 0) + 1 })
          .eq("id", row.id);
        await supa.from("failed_analyses").insert({
          interaction_id: row.id,
          candidate_id: row.candidate_id,
          user_id: row.user_id,
          comment_text: text,
          last_error: String(e?.message || e).slice(0, 500),
          attempts: (row.analysis_attempts || 0) + 1,
          provider_used: "all_failed",
          metadata: { mode, circuit: state },
        });
      }
    }));
    await sleep(250); // throttle to respect rate limits
  }

  await supa.from("edge_function_logs").insert({
    function_name: "bulk-backfill-sentiment",
    status: failed > processed ? "error" : "ok",
    duration_ms: Date.now() - t0,
    metadata: { processed, failed, providerCounts, mode, batch_size: rows.length },
  });

  return new Response(JSON.stringify({
    ok: true, processed, failed, providerCounts,
    duration_ms: Date.now() - t0, batch_size: rows.length, mode,
    circuitState: state,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
