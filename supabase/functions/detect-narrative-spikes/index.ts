// Detecta picos de menções nas últimas 24h e gera narrative_alerts via Lovable AI Gateway.
// Pode ser chamado manualmente ou via cron. Roda por user (auth) ou para um candidato específico.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const isCronMode = token === SERVICE_KEY;

    const body = await req.json().catch(() => ({}));
    const candidateFilter: string | undefined = body.candidate_id;

    // Buscar candidatos (cron: todos os ativos; user: só do user)
    let candQ = supabase.from("candidates").select("id, full_name, user_id").eq("status", "active");
    if (!isCronMode) {
      const { data: userRes } = await supabase.auth.getUser(token);
      const user = userRes?.user;
      if (!user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      candQ = candQ.eq("user_id", user.id);
    }
    if (candidateFilter) candQ = candQ.eq("id", candidateFilter);
    const { data: candidates, error: candErr } = await candQ;
    if (candErr) throw candErr;

    const now = Date.now();
    const spikeWindowStart = new Date(now - 6 * 3600_000).toISOString();
    const baselineStart = new Date(now - 24 * 3600_000).toISOString();
    const baselineEnd = spikeWindowStart;

    const alertsCreated: any[] = [];

    for (const cand of candidates || []) {
      const candUserId = (cand as any).user_id;
      // Pegar interações últimas 24h
      const { data: interactions } = await supabase
        .from("social_interactions")
        .select("comment_text, sentiment_label, social_network, region, city, state, original_posted_at, created_at")
        .eq("user_id", candUserId)
        .eq("candidate_id", cand.id)
        .gte("original_posted_at", baselineStart)
        .limit(2000);

      if (!interactions || interactions.length < 10) continue;

      const recent = interactions.filter((i) => (i.original_posted_at || i.created_at || "") >= spikeWindowStart);
      const baseline = interactions.filter((i) => {
        const t = i.original_posted_at || i.created_at || "";
        return t >= baselineStart && t < baselineEnd;
      });

      const recentRate = recent.length / 6; // por hora
      const baselineRate = baseline.length / 18 || 0.1;
      const ratio = recentRate / baselineRate;

      // Pico = volume recente >= 2x baseline E pelo menos 15 menções recentes
      if (ratio < 2 || recent.length < 15) continue;

      // Já existe alerta recente (<6h) para esse candidato?
      const { data: existing } = await supabase
        .from("narrative_alerts")
        .select("id")
        .eq("user_id", user.id)
        .eq("candidate_id", cand.id)
        .gte("created_at", new Date(now - 6 * 3600_000).toISOString())
        .limit(1);
      if (existing && existing.length > 0) continue;

      // Sample texts (top 30 + sentiment mix)
      const sample = recent.slice(0, 30).map((i) => ({
        text: (i.comment_text || "").slice(0, 280),
        sentiment: i.sentiment_label,
        network: i.social_network,
        region: i.region || i.state || i.city || null,
      }));

      const posCount = recent.filter((i) => (i.sentiment_label || "").toLowerCase().startsWith("pos")).length;
      const negCount = recent.filter((i) => (i.sentiment_label || "").toLowerCase().startsWith("neg")).length;
      const dominantSent = posCount > negCount ? "Positivo" : negCount > posCount ? "Negativo" : "Neutro";

      const prompt = `Você é analista político brasileiro. Detectamos um PICO de menções para "${cand.full_name}" (${recent.length} menções em 6h, ${ratio.toFixed(1)}x acima do normal). Sentimento dominante: ${dominantSent}.

Amostra de comentários (JSON): ${JSON.stringify(sample).slice(0, 6000)}

Responda APENAS em JSON válido com este schema exato:
{
  "trigger_reason": "string curta (1 frase) explicando o gatilho do pico",
  "detected_bubble": "qual bolha está reagindo (ex: 'eleitorado evangélico', 'esquerda jovem', 'classe média SP')",
  "dominant_theme": "tema central da conversa em 3-6 palavras",
  "affected_groups": ["grupo1", "grupo2"],
  "suggested_action": "ação concreta recomendada (1-2 frases)",
  "alternative_narrative": "narrativa alternativa que o candidato pode adotar (1-2 frases)",
  "risks": ["risco1", "risco2"],
  "opportunities": ["oport1", "oport2"],
  "confidence": 0.0-1.0
}`;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });

      if (!aiResp.ok) {
        console.error("AI gateway error", aiResp.status, await aiResp.text());
        continue;
      }
      const aiJson = await aiResp.json();
      const content = aiJson?.choices?.[0]?.message?.content;
      let parsed: any = {};
      try { parsed = typeof content === "string" ? JSON.parse(content) : content; } catch { parsed = {}; }

      const { data: inserted, error: insErr } = await supabase
        .from("narrative_alerts")
        .insert({
          user_id: user.id,
          candidate_id: cand.id,
          trigger_reason: parsed.trigger_reason || `Pico de ${recent.length} menções em 6h (${ratio.toFixed(1)}x baseline)`,
          detected_bubble: parsed.detected_bubble || null,
          dominant_theme: parsed.dominant_theme || null,
          affected_groups: parsed.affected_groups || [],
          dominant_sentiment: dominantSent,
          suggested_action: parsed.suggested_action || null,
          alternative_narrative: parsed.alternative_narrative || null,
          risks: parsed.risks || [],
          opportunities: parsed.opportunities || [],
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
          spike_volume: recent.length,
          metadata: { ratio, baseline_count: baseline.length, candidate_name: cand.full_name },
        })
        .select()
        .single();

      if (insErr) console.error("Insert error", insErr);
      else if (inserted) alertsCreated.push(inserted);
    }

    return new Response(JSON.stringify({ ok: true, alerts_created: alertsCreated.length, alerts: alertsCreated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
