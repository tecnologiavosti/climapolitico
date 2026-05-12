// Sentiment Worker — claims jobs from analysis_jobs queue and analyzes
// Cache L1 (in-memory, per-invocation) + L2 (analysis_cache table, SHA-256 keyed)
// Provider routing with circuit breaker (provider_health table)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const WORKER_ID = `sentiment-${crypto.randomUUID().slice(0, 8)}`;
const CORRELATION = crypto.randomUUID();
const BATCH = 5;
const LEASE_SEC = 90;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ---------- L1 cache (in-memory) ----------
const L1 = new Map<string, { label: string; score: number; confidence: number }>();
const L1_MAX = 500;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function logJSON(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, msg, worker: WORKER_ID, correlation: CORRELATION, ts: new Date().toISOString(), ...extra }));
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

type Provider = { name: string; call: (text: string) => Promise<{ label: string; score: number; confidence: number }> };

// Heuristic PT-BR fallback — calibrated to be decisive (less Neutro)
function heuristic(text: string) {
  const t = text.toLowerCase();
  const pos = /(bom|[óo]tim|excelen|adoro|maravilh|parab[ée]n|melhor|apoio|forte|incr[íi]vel|gosto|gostei|mito|her[óo]i|orgulho|votarei|voto\s+em|te\s+amo|presidente|for[cç]a|vai\s+ganhar|vencer|vit[óo]ria|sucesso|deus\s+aben|honesto|trabalhador|competente|sensacional|brilhante|admiro|respeito|salvou|melhorou|fant[áa]stico|top|fenomenal|✨|❤|👏|🙏|✊|🇧🇷|💚|💛|🥰|😍|🤩|👍|💪|🫡)/g;
  const neg = /(ruim|p[ée]ssim|horr[íi]ve|odeio|ladr[ãa]o|corrupt|mentiros|vagabund|bandido|\bfora\b|jamais|nunca|safad|canalha|vergonha|nojo|[óo]dio|fracass|incompetente|idiota|burro|imbecil|lixo|merda|fdp|gado|petralha|bolsominion|destru|enganador|farsa|hip[óo]crita|trai[cç][ãa]o|escroto|absurdo|cad[ée]ia|preso|impeachment|criminoso|pilantra|in[úu]til|decep[cç][ãa]o|odiei|💩|👎|🤮|😡|🤡|🤬|🙄|😤|🖕)/g;
  const p = (t.match(pos) || []).length;
  const n = (t.match(neg) || []).length;
  if (p === 0 && n === 0) return { label: "Neutro", score: 0, confidence: 0.3 };
  const score = (p - n) / Math.max(1, p + n);
  // Lowered threshold from 0.15 → 0.05 to reduce false-Neutro classifications
  return {
    label: score > 0.05 ? "Positivo" : score < -0.05 ? "Negativo" : "Neutro",
    score,
    confidence: 0.6 + 0.05 * Math.min(4, p + n),
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
        { role: "system", content: "Você classifica sentimento político em PT-BR. Seja DECISIVO: use 'Neutro' APENAS quando o texto for puramente informativo, uma pergunta sem opinião, ou impossível de determinar polaridade. Comentários curtos de apoio ('Lula presidente', 'Parabéns', 'mito') são Positivo. Críticas, xingamentos, sarcasmo crítico são Negativo. Responda APENAS JSON: {\"label\":\"Positivo|Negativo|Neutro\",\"score\":-1..1,\"confidence\":0..1}" },
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

    // Anti prompt-injection: cap length and strip control chars
    const safeText = row.comment_text.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 1000);
    const key = await sha256(safeText.toLowerCase().trim());

    let r = L1.get(key);
    let cached = !!r;
    if (!r) {
      const { data: c } = await sb.from("analysis_cache").select("result").eq("cache_key", key).maybeSingle();
      if (c?.result) {
        r = c.result as any;
        cached = true;
        await sb.from("analysis_cache").update({ hit_count: (c as any).hit_count ? undefined : 1, last_hit_at: new Date().toISOString() }).eq("cache_key", key);
      }
    }
    if (!r) {
      r = await analyze(safeText);
      await sb.from("analysis_cache").upsert({ cache_key: key, analysis_type: "sentiment", result: r as any }, { onConflict: "cache_key" });
    }
    if (L1.size >= L1_MAX) L1.delete(L1.keys().next().value);
    L1.set(key, r);
    logJSON("info", "analyzed", { job: job.id, cached, label: r.label });

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
    if (ok && job.user_id) {
      await sb.rpc("record_usage_event", {
        _user_id: job.user_id,
        _event_type: "ai_analysis",
        _resource: "sentiment",
        _quantity: 1,
        _cost_units: 1,
        _metadata: { job_id: job.id, duration_ms: Date.now() - t0 },
      }).catch(() => {});
    }
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
