// Generates "pontos fortes" + "como melhorar" for a region/network combo using Cerebras.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { candidate_id, region, social_network, social_network_values, totals } = await req.json();
    if (!candidate_id || !region || !social_network) {
      return new Response(JSON.stringify({ error: "missing params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const netValues: string[] = Array.isArray(social_network_values) && social_network_values.length
      ? social_network_values
      : [social_network];

    // Fetch sample comments (positive + negative). Sentiments in DB are 'Positivo'/'Negativo'/'Neutro' (PT) — accept both.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const baseFilter = (sentiments: string[]) =>
      admin
        .from("social_interactions")
        .select("comment_text")
        .eq("user_id", userId)
        .eq("candidate_id", candidate_id)
        .eq("region", region)
        .in("social_network", netValues)
        .in("sentiment_label", sentiments)
        .not("comment_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(8);

    const [{ data: pos }, { data: neg }] = await Promise.all([
      baseFilter(["Positivo", "positive", "positivo"]),
      baseFilter(["Negativo", "negative", "negativo"]),
    ]);

    const positives = (pos ?? []).map((r) => `- ${(r.comment_text || "").slice(0, 200)}`).join("\n") || "(sem amostras)";
    const negatives = (neg ?? []).map((r) => `- ${(r.comment_text || "").slice(0, 200)}`).join("\n") || "(sem amostras)";

    const apiKey = Deno.env.get("CEREBRAS_API_KEY");

    const prompt = `Você é um analista político especialista em comunicação regional brasileira.
Com base nos dados reais abaixo de menções ao candidato na região ${region} no ${social_network}, gere uma análise.

Total de menções: ${totals?.total ?? 0}
Taxa de aceitação: ${totals?.acceptance ?? 0}%
Taxa de rejeição: ${totals?.rejection ?? 0}%

Amostra de comentários positivos:
${positives}

Amostra de comentários negativos:
${negatives}

Responda APENAS um JSON no formato exato:
{"pontos_fortes":["...","...","...","...","..."],"como_melhorar":["...","...","...","...","..."]}
Cada item deve ter no máximo 140 caracteres, em português brasileiro.`;

    const systemMsg = "Você é um estrategista político brasileiro. Responda sempre em JSON válido em português.";
    let json: any = null;
    let lastErr = "";
    let quotaExceeded = false;

    // 1) Try Cerebras first (fast and free if quota available)
    if (apiKey) {
      const cerebrasModels = ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"];
      for (const model of cerebrasModels) {
        const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_tokens: 1000,
            temperature: 0.4,
          }),
        });
        if (r.ok) { json = await r.json(); break; }
        const errText = (await r.text()).slice(0, 300);
        lastErr = `${model} ${r.status}: ${errText}`;
        if (r.status === 429 || /token_quota_exceeded|too_many_tokens/i.test(errText)) {
          quotaExceeded = true;
          console.warn("[regional-insights] Cerebras quota exceeded, falling back to Lovable AI");
          break;
        }
        console.warn("[regional-insights]", lastErr);
      }
    } else {
      quotaExceeded = true;
    }

    // 2) Fallback to Lovable AI Gateway
    if (!json) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error(`Cerebras failed: ${lastErr} | LOVABLE_API_KEY missing`);
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "system", content: systemMsg }, { role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });
      if (!r.ok) {
        const errText = (await r.text()).slice(0, 300);
        if (r.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em alguns minutos.");
        if (r.status === 402) throw new Error("Créditos da IA esgotados. Adicione créditos em Settings > Workspace > Usage.");
        throw new Error(`AI fallback failed: ${r.status} ${errText}`);
      }
      json = await r.json();
    }

    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = typeof content === "string" ? JSON.parse(content) : content;

    return new Response(
      JSON.stringify({
        pontos_fortes: Array.isArray(parsed.pontos_fortes) ? parsed.pontos_fortes.slice(0, 5) : [],
        como_melhorar: Array.isArray(parsed.como_melhorar) ? parsed.como_melhorar.slice(0, 5) : [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = (e as Error).message || "";
    console.error("regional-insights error:", msg);
    // Falhas de IA (créditos esgotados, rate limit, fallback) NÃO devem quebrar a UI.
    // Retorna 200 com fallback vazio + flag para o cliente exibir mensagem amigável.
    const isAiQuota =
      msg.includes("Créditos da IA esgotados") ||
      msg.includes("Limite de requisições") ||
      msg.includes("AI fallback failed") ||
      msg.includes("token_quota_exceeded") ||
      msg.includes("too_many_tokens");
    if (isAiQuota) {
      return new Response(
        JSON.stringify({
          pontos_fortes: [],
          como_melhorar: [],
          fallback: true,
          error: msg.includes("Créditos") ? "AI_CREDITS_EXHAUSTED" : "AI_RATE_LIMITED",
          message: msg,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
