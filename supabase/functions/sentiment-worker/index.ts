// Sentiment Worker — claims jobs from analysis_jobs queue and analyzes
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const CEREBRAS_KEY = Deno.env.get("CEREBRAS_API_KEY");
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");

const WORKER_ID = `sentiment-${crypto.randomUUID().slice(0, 8)}`;
const BATCH = 5;
const LEASE_SEC = 90;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

type Provider = { name: string; call: (text: string) => Promise<{ label: string; score: number; confidence: number }> };

// Heuristic PT-BR fallback
function heuristic(text: string) {
  const t = text.toLowerCase();
  const pos = /(bom|ótim|excelen|adoro|maravilh|parabén|melhor|apoio|forte|incrível|gosto|✨|❤️|👏)/g;
  const neg = /(ruim|péssim|horríve|odeio|ladrão|corrupt|mentiroso|fora|vergonha|destru|💩|👎)/g;
  const p = (t.match(pos) || []).length;
  const n = (t.match(neg) || []).length;
  if (p === 0 && n === 0) return { label: "Neutro", score: 0, confidence: 0.3 };
  const score = (p - n) / Math.max(1, p + n);
  return {
    label: score > 0.15 ? "Positivo" : score < -0.15 ? "Negativo" : "Neutro",
    score,
    confidence: 0.55,
  };
}

async function callLovable(text: string) {
  const t0 = Date.now();
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: "Classifique o sentimento político em PT-BR. Responda APENAS JSON: {\"label\":\"Positivo|Negativo|Neutro\",\"score\":-1..1,\"confidence\":0..1}" },
        { role: "user", content: text.slice(0, 500) },
      ],
    }),
  });
  const latency = Date.now() - t0;
  if (!r.ok) {
    await sb.rpc("record_provider_call", { _provider: "lovable", _success: false, _latency_ms: latency });
    throw new Error(`lovable ${r.status}`);
  }
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content || "{}";
  const m = content.match(/\{[^}]+\}/);
  const parsed = JSON.parse(m?.[0] ?? "{}");
  await sb.rpc("record_provider_call", { _provider: "lovable", _success: true, _latency_ms: latency });
  return {
    label: parsed.label || "Neutro",
    score: Number(parsed.score) || 0,
    confidence: Number(parsed.confidence) || 0.5,
  };
}

const providers: Provider[] = [{ name: "lovable", call: callLovable }];

async function analyze(text: string) {
  // Check provider health
  const { data: health } = await sb.from("provider_health").select("provider,state,health_score").order("health_score", { ascending: false });
  const healthy = (health || []).filter((h: any) => h.state !== "open").map((h: any) => h.provider);
  for (const p of providers) {
    if (!healthy.includes(p.name)) continue;
    try {
      return await p.call(text);
    } catch (_) { /* try next */ }
  }
  return heuristic(text);
}

async function processJob(job: any) {
  const t0 = Date.now();
  let ok = false;
  let err: string | null = null;
  try {
    const interactionId = job.payload?.interaction_id ?? job.related_id;
    if (!interactionId) throw new Error("missing interaction_id");
    const { data: row, error: e1 } = await sb.from("social_interactions").select("id,comment_text").eq("id", interactionId).maybeSingle();
    if (e1) throw e1;
    if (!row?.comment_text) throw new Error("no text");
    const r = await analyze(row.comment_text);
    await sb.from("social_interactions").update({
      sentiment_label: r.label,
      sentiment_score: r.score,
      sentiment_confidence: r.confidence,
      analysis_attempts: (job.attempts ?? 1),
    }).eq("id", interactionId);
    await sb.from("analysis_jobs").update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      result: r as any,
      worker_id: WORKER_ID,
    }).eq("id", job.id);
    ok = true;
  } catch (e: any) {
    err = e?.message || String(e);
    const dead = (job.attempts ?? 1) >= (job.max_attempts ?? 5);
    await sb.from("analysis_jobs").update({
      status: dead ? "dead" : "queued",
      last_error: err,
      worker_id: null,
      leased_at: null,
      lease_expires_at: null,
      scheduled_at: new Date(Date.now() + Math.min(300_000, Math.pow(2, job.attempts ?? 1) * 1000 + Math.random() * 500)).toISOString(),
    }).eq("id", job.id);
    if (dead) {
      await sb.from("failed_analyses").insert({
        interaction_id: job.related_id,
        candidate_id: job.candidate_id,
        user_id: job.user_id,
        last_error: err,
        attempts: job.attempts,
        metadata: { job_id: job.id },
      });
    }
  } finally {
    await sb.from("job_execution_history").insert({
      job_id: job.id,
      worker_id: WORKER_ID,
      status: ok ? "succeeded" : "failed",
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      error_message: err,
    });
    await sb.rpc("record_worker_heartbeat", {
      _worker_id: WORKER_ID,
      _worker_type: "sentiment",
      _current_job_id: null,
      _processed_delta: ok ? 1 : 0,
      _failed_delta: ok ? 0 : 1,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    await sb.rpc("record_worker_heartbeat", { _worker_id: WORKER_ID, _worker_type: "sentiment" });
    const { data: jobs, error } = await sb.rpc("claim_jobs", {
      _worker_id: WORKER_ID,
      _job_type: "sentiment",
      _batch_size: BATCH,
      _lease_seconds: LEASE_SEC,
    });
    if (error) throw error;
    if (!jobs?.length) return new Response(JSON.stringify({ claimed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    await Promise.all(jobs.map(processJob));
    return new Response(JSON.stringify({ claimed: jobs.length, worker: WORKER_ID }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
