// Sentiment Worker — claims jobs from analysis_jobs queue and analyzes
// Cache L1 (in-memory, per-invocation) + L2 (analysis_cache table, SHA-256 keyed)
// Provider routing with circuit breaker (provider_health table)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

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

type Provider = { name: string; call: (text: string) => Promise<{ label: string; score: number; confidence: number }> };

// Heurística PT-BR contextual — score contínuo -1..+1
// Considera apoio/mobilização, crítica/denúncia, factual neutralizador, hashtags, emojis, intensificadores.
function heuristic(text: string) {
  const t = text.toLowerCase();

  const supportLex = /(juntos|vamos\s+vencer|vamos\s+ganhar|conta\s+comigo|estou\s+com|fechad[ao]\s+com|apoio\s+total|incondicional|nosso\s+candidato|meu\s+voto|votarei|voto\s+\d+|mito|lenda|her[óo]i|orgulho|salvador|melhor\s+do\s+brasil|grande\s+l[íi]der|vencer|vit[óo]ria|esperan[cç]a|mudan[cç]a|trabalhador|honesto|competente|brilhante|sensacional|maravilh|admiro|respeito|gratid[ãa]o|deus\s+aben|for[cç]a|continue|n[ãa]o\s+desista|estamos\s+contigo|parab[ée]n|excelen|fant[áa]stico|fenomenal)/g;
  const supportEmoji = /(❤|♥|💚|💛|💙|🧡|🤍|👏|🙏|✊|💪|🇧🇷|🥰|😍|🤩|👍|🫡|✨|🌟|⭐|🔥)/gu;
  const supportHashtag = /#(fechado?com\w*|juntos\w*|apoio\w*|mito\w*|mudan[cç]a\w*|vamos\w*|forca\w*|for[cç]a\w*|euvoto\w*|votoem\w*)/g;

  const attackLex = /(corrupt|ladr[ãa]o|roubou|desviou|propin|esc[âa]ndalo|acusad[ao]|investig|denunciad|criminoso|pilantra|bandido|vagabund|mentiros|farsant|hip[óo]crita|traidor|trai[cç][ãa]o|covarde|incompetente|despreparad|idiota|burro|imbecil|in[úu]til|lixo|merda|fdp|ot[áa]rio|cad[ée]ia|preso|impeachment|\bfora\b|jamais|nunca\s+mais|fracass|destru|desastr|terr[íi]vel|p[ée]ssim|horr[íi]ve|nojo|nojent|[óo]dio|odeio|odiei|vergonha|verg[oô]nha|absurdo|inaceit[áa]vel|chocante|revolt|indigna)/g;
  const attackEmoji = /(💩|👎|🤮|😡|🤡|🤬|🙄|😤|🖕|💀)/gu;
  const attackHashtag = /#(fora\w*|impeachment\w*|cad[ée]ia\w*|corrupt\w*|nuncamais\w*)/g;

  const factualLex = /(segundo\s+\w+|de\s+acordo\s+com|informou|declarou|afirmou|disse\s+que|agenda\s+oficial|reuni[ãa]o\s+com|expectativa\s+por|movimenta\s+viagem|registra|n[ãa]o\s+registra|comunicado|nota\s+oficial|confirmou|negou|esclareceu)/g;
  const intens = /(muito|extrem|absurdamente|completamente|totalmente|sempre|infinit)/g;

  const sup = (t.match(supportLex) || []).length
            + (text.match(supportEmoji) || []).length * 1.2
            + (t.match(supportHashtag) || []).length * 1.5;
  const atk = (t.match(attackLex) || []).length
            + (text.match(attackEmoji) || []).length * 1.2
            + (t.match(attackHashtag) || []).length * 1.5;
  const fact = (t.match(factualLex) || []).length;
  const boost = 1 + Math.min(0.5, (t.match(intens) || []).length * 0.15);

  if (sup === 0 && atk === 0) {
    return { label: "Neutro", score: 0, confidence: fact > 0 ? 0.55 : 0.3 };
  }

  let raw = (sup - atk) / Math.max(1, sup + atk);
  raw = Math.max(-1, Math.min(1, raw * boost));
  if (fact >= 2 && Math.abs(raw) < 0.5) raw *= 0.4;

  const label = raw > 0.20 ? "Positivo" : raw < -0.20 ? "Negativo" : "Neutro";
  const confidence = Math.min(0.95, 0.55 + 0.07 * Math.min(5, sup + atk));
  return { label, score: raw, confidence };
}

async function callLovable(text: string) {
  const t0 = Date.now();
  try {
    const res = await callAICerebrasFirst({
      systemMsg: `Você é um analista sênior de mídia social política brasileira. Classifique o sentimento considerando CONTEXTO completo, não palavras isoladas.

ESCALA -1.0 a +1.0:
• POSITIVO (+0.20 a +1.0): apoio explícito, mobilização ("Juntos vamos vencer"), elogios, celebração, hashtags #fechadoCom #mito #vamos, emojis ❤️👏🙏🇧🇷, gratidão, defesa.
• NEGATIVO (-1.0 a -0.20): críticas, acusações, denúncias, ataques, ironia destrutiva, xingamentos, hashtags #fora #impeachment #cadeia, emojis 💩🤡🤬, pedidos de prisão/saída.
• NEUTRO (-0.19 a +0.19): notícias factuais sem juízo ("Agenda oficial não registra encontro"), anúncios, perguntas informativas.

EXEMPLOS:
"Juntos vamos vencer! Compartilhe para mostrar apoio" → {"label":"Positivo","score":0.75,"confidence":0.9}
"Expectativa por reunião com Trump movimenta viagem de Flávio" → {"label":"Neutro","score":0.1,"confidence":0.65}
"Agenda oficial não registra encontro" → {"label":"Neutro","score":0,"confidence":0.7}
"Mais um escândalo de corrupção, vergonha!" → {"label":"Negativo","score":-0.85,"confidence":0.95}
"Mito! O melhor presidente que tivemos 🇧🇷👏" → {"label":"Positivo","score":0.9,"confidence":0.95}
"que governo maravilhoso, só destruiu tudo" → {"label":"Negativo","score":-0.7,"confidence":0.85} (ironia)

REGRAS:
- Detecte IRONIA e SARCASMO.
- Hashtags e emojis são FORTES sinais de polaridade.
- NÃO classifique como Neutro apenas porque o texto é curto ou cita nome próprio.
- Se realmente incerto, use confidence < 0.5.

Responda APENAS JSON: {"label":"Positivo|Negativo|Neutro","score":-1..1,"confidence":0..1}`,
      userPrompt: text.slice(0, 500),
      jsonMode: true,
      maxTokens: 200,
      temperature: 0.2,
      tag: "sentiment-worker",
    });
    const latency = Date.now() - t0;
    const content = res.content || "{}";
    const m = content.match(/\{[\s\S]*?\}/);
    const parsed = JSON.parse(m?.[0] ?? "{}");
    await sb.rpc("record_provider_call", { _provider: res.provider, _success: true, _latency_ms: latency });
    const score = Number(parsed.score) || 0;
    // Reconcilia label com score (defesa contra inconsistência da IA)
    let label = parsed.label || "Neutro";
    if (score > 0.20) label = "Positivo";
    else if (score < -0.20) label = "Negativo";
    else label = "Neutro";
    return { label, score, confidence: Number(parsed.confidence) || 0.5 };
  } catch (e) {
    const latency = Date.now() - t0;
    await sb.rpc("record_provider_call", { _provider: "ai_chain", _success: false, _latency_ms: latency });
    throw e;
  }
}

const providers: Provider[] = [{ name: "lovable", call: callLovable }];


async function analyze(text: string) {
  // Check provider health
  const { data: health } = await sb.from("provider_health").select("provider,state,health_score").order("health_score", { ascending: false });
  const healthy = (health || []).filter((h: any) => h.state !== "open").map((h: any) => h.provider);
  for (const p of providers) {
    if (healthy.length > 0 && !healthy.includes(p.name)) continue;
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
        await sb.from("analysis_cache").update({ last_hit_at: new Date().toISOString() }).eq("cache_key", key);
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
      try {
        await sb.rpc("record_usage_event", {
          _user_id: job.user_id,
          _event_type: "ai_analysis",
          _resource: "sentiment",
          _quantity: 1,
          _cost_units: 1,
          _metadata: { job_id: job.id, duration_ms: Date.now() - t0 },
        });
      } catch (_) {
        // Métrica de uso é não-bloqueante para o processamento de sentimento.
      }
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
