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

    const { candidate_id, region, social_network, totals } = await req.json();
    if (!candidate_id || !region || !social_network) {
      return new Response(JSON.stringify({ error: "missing params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch sample comments (positive + negative)
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const baseFilter = (sentiment: string) =>
      admin
        .from("social_interactions")
        .select("comment_text")
        .eq("user_id", userId)
        .eq("candidate_id", candidate_id)
        .eq("region", region)
        .eq("social_network", social_network)
        .eq("sentiment_label", sentiment)
        .not("comment_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(8);

    const [{ data: pos }, { data: neg }] = await Promise.all([baseFilter("positive"), baseFilter("negative")]);

    const positives = (pos ?? []).map((r) => `- ${(r.comment_text || "").slice(0, 200)}`).join("\n") || "(sem amostras)";
    const negatives = (neg ?? []).map((r) => `- ${(r.comment_text || "").slice(0, 200)}`).join("\n") || "(sem amostras)";

    const apiKey = Deno.env.get("CEREBRAS_API_KEY");
    if (!apiKey) throw new Error("CEREBRAS_API_KEY missing");

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

    const models = ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"];
    let json: any = null;
    let lastErr = "";
    for (const model of models) {
      const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Você é um estrategista político brasileiro. Responda sempre em JSON válido em português." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
          temperature: 0.4,
        }),
      });
      if (r.ok) { json = await r.json(); break; }
      lastErr = `${model} ${r.status}: ${(await r.text()).slice(0, 200)}`;
      console.warn("[regional-insights]", lastErr);
    }
    if (!json) throw new Error(`Cerebras failed: ${lastErr}`);
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");

    return new Response(
      JSON.stringify({
        pontos_fortes: Array.isArray(parsed.pontos_fortes) ? parsed.pontos_fortes.slice(0, 5) : [],
        como_melhorar: Array.isArray(parsed.como_melhorar) ? parsed.como_melhorar.slice(0, 5) : [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("regional-insights error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
