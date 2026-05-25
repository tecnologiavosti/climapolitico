// Detecta picos de menções e cria political_events.
// Execução assíncrona: retorna 202 imediatamente e processa em background.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const STOPWORDS = new Set([
  "para","como","mais","menos","esse","essa","isso","aquele","aquela","sobre","entre","quando",
  "porque","muito","pelo","pela","pelos","pelas","seus","suas","nosso","nossa","você","vocês","aqui",
  "ali","então","ainda","sempre","nunca","cada","tudo","tanto","quanto","qual","quais","onde","quem",
  "fazer","fazendo","ser","estar","tem","têm","tinha","tinham","será","sido","sendo",
  "the","and","that","this","with","from","have","https","http",
]);

function extractKeywords(text: string): string[] {
  const words = (text || "").toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/);
  const result: string[] = [];
  for (const w of words) if (w.length >= 5 && !STOPWORDS.has(w)) result.push(w);
  return result;
}

async function aiNameEvent(candidateName: string, date: string, topKeywords: string[], sampleTexts: string[]) {
  try {
    const prompt = `Você é analista político. Em ${date}, o candidato "${candidateName}" teve um pico de menções.
Palavras-chave: ${topKeywords.slice(0, 10).join(", ")}
Amostra:
${sampleTexts.slice(0, 3).map((t, i) => `${i + 1}. ${t.slice(0, 200)}`).join("\n")}

Responda APENAS JSON: {"name":"...","type":"entrevista|debate|comicio|discurso|polemica|outro","description":"1 frase"}`;
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content || "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return {
        name: parsed.name || `Pico de menções (${date})`,
        type: parsed.type || "outro",
        description: parsed.description || "",
      };
    }
  } catch (_e) {}
  return { name: `Pico de menções (${date})`, type: "outro", description: `Volume anômalo em ${date}.` };
}

async function processDetection(userId: string, jobId: string, days: number, spikeMultiplier: number) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const { data: candidates } = await admin.from("candidates").select("id, full_name").eq("user_id", userId).eq("status", "active");
    let totalCreated = 0;
    const summary: any[] = [];

    for (const cand of candidates || []) {
      const all: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await admin
          .from("social_interactions")
          .select("original_posted_at, created_at, content, comment_text")
          .eq("user_id", userId)
          .eq("candidate_id", cand.id)
          .gte("original_posted_at", since)
          .order("original_posted_at", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
        if (all.length > 30000) break;
      }
      if (all.length < 20) continue;

      const byDay = new Map<string, { date: string; count: number; texts: string[]; topics: Record<string, number> }>();
      for (const row of all) {
        const ts = row.original_posted_at || row.created_at;
        if (!ts) continue;
        const day = String(ts).slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, { date: day, count: 0, texts: [], topics: {} });
        const b = byDay.get(day)!;
        b.count++;
        const text = String(row.comment_text || row.content || "");
        if (text && b.texts.length < 30) b.texts.push(text);
        for (const kw of extractKeywords(text)) b.topics[kw] = (b.topics[kw] || 0) + 1;
      }

      const counts = Array.from(byDay.values()).map((b) => b.count);
      if (counts.length < 5) continue;
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const threshold = Math.max(avg * spikeMultiplier, avg + 5);

      const { data: existing } = await admin
        .from("political_events")
        .select("event_date")
        .eq("user_id", userId)
        .eq("candidate_id", cand.id)
        .gte("event_date", since);
      const existingDays = new Set((existing || []).map((e) => String(e.event_date).slice(0, 10)));

      for (const bucket of byDay.values()) {
        if (bucket.count < threshold || existingDays.has(bucket.date)) continue;
        const topKeywords = Object.entries(bucket.topics).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
        const ai = await aiNameEvent(cand.full_name, bucket.date, topKeywords, bucket.texts);
        const { error: insErr } = await admin.from("political_events").insert({
          user_id: userId,
          candidate_id: cand.id,
          event_name: ai.name,
          event_type: ai.type,
          event_date: new Date(`${bucket.date}T12:00:00Z`).toISOString(),
          description: ai.description,
          keywords: topKeywords.slice(0, 8),
          metadata: { auto_detected: true, spike_volume: bucket.count, baseline_avg: Math.round(avg), threshold: Math.round(threshold), job_id: jobId },
        });
        if (!insErr) {
          totalCreated++;
          summary.push({ candidate: cand.full_name, date: bucket.date, name: ai.name, volume: bucket.count });
        }
      }
    }

    await admin.from("event_detection_jobs").upsert({
      id: jobId,
      user_id: userId,
      status: "completed",
      events_created: totalCreated,
      result: { summary },
      completed_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("processDetection error", e);
    await admin.from("event_detection_jobs").upsert({
      id: jobId,
      user_id: userId,
      status: "failed",
      error_message: e?.message || String(e),
      completed_at: new Date().toISOString(),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const url = new URL(req.url);
    const isStatus = url.searchParams.get("status") === "1";

    if (isStatus) {
      const jobId = url.searchParams.get("job_id");
      if (!jobId) return new Response(JSON.stringify({ error: "job_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: job } = await admin.from("event_detection_jobs").select("*").eq("id", jobId).eq("user_id", user.id).maybeSingle();
      return new Response(JSON.stringify(job || { status: "not_found" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 30, 7), 90);
    const spikeMultiplier = Number(body.spike_multiplier) || 2.0;

    const jobId = crypto.randomUUID();
    await admin.from("event_detection_jobs").insert({
      id: jobId,
      user_id: user.id,
      status: "processing",
      params: { days, spike_multiplier: spikeMultiplier },
    });

    // Background processing — não bloqueia a resposta
    // @ts-ignore - EdgeRuntime global do Supabase
    EdgeRuntime.waitUntil(processDetection(user.id, jobId, days, spikeMultiplier));

    return new Response(JSON.stringify({ job_id: jobId, status: "processing", message: "Detecção iniciada em background" }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e), fallback: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
