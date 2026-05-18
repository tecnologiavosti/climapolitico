// Edge function: gera sugestões de canais Telegram, subreddits e keywords
// Google News para um candidato político brasileiro recém-adicionado.
// Usa Lovable AI Gateway (gpt-5-mini) com tool calling para garantir JSON válido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAIChatCompat } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCHEMA = {
  type: "object",
  properties: {
    canais_telegram: {
      type: "array",
      items: { type: "string" },
      description: "10 possíveis usernames de canais Telegram (sem @, sem t.me/)",
    },
    subreddits: {
      type: "array",
      items: { type: "string" },
      description: "5 subreddits relevantes (sem r/)",
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "15 palavras-chave em português para Google News",
    },
  },
  required: ["canais_telegram", "subreddits", "keywords"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurado");

    // Validação JWT obrigatória
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const candidateName: string = (body.candidateName ?? "").trim();
    const party: string = (body.party ?? "").trim();
    const region: string = (body.region ?? "").trim();
    if (!candidateName) {
      return new Response(JSON.stringify({ error: "candidateName obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Dado o candidato político brasileiro "${candidateName}"${party ? ` do partido "${party}"` : ""}${region ? `, região ${region}` : ""}, gere:
1. canais_telegram: 10 possíveis usernames de canais do Telegram relacionados (apoiadores, mídia regional, partido).
2. subreddits: 5 subreddits brasileiros relevantes onde esse candidato é discutido.
3. keywords: 15 palavras-chave em português para monitorar no Google News (variações do nome, partido, temas associados).

Use apenas usernames realistas (sem @ nem t.me/). Para subreddits, sem r/. Para keywords, frases curtas em português.`;

    // Try tool-call (Lovable) first, then fall back to multi-provider JSON chain.
    let parsed: any = null;
    try {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages: [
            { role: "system", content: "Você é um especialista em monitoramento político brasileiro. Responda apenas via tool call." },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "suggest_config",
              description: "Retorna sugestões de canais, subreddits e keywords",
              parameters: SCHEMA,
            },
          }],
          tool_choice: { type: "function", function: { name: "suggest_config" } },
          max_completion_tokens: 1500,
        }),
      });
      if (aiResp.ok) {
        const data = await aiResp.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) parsed = JSON.parse(toolCall.function.arguments);
      } else {
        console.warn("[suggest-candidate-config] Lovable tool-call failed:", aiResp.status);
      }
    } catch (e) {
      console.warn("[suggest-candidate-config] Lovable tool-call threw:", (e as Error).message);
    }

    if (!parsed) {
      try {
        const fb = await callAIChatCompat({
          systemMsg: "Você é um especialista em monitoramento político brasileiro. Responda APENAS com JSON válido seguindo exatamente o schema pedido.",
          userPrompt: `${prompt}\n\nResponda APENAS JSON no formato: {"canais_telegram":[...],"subreddits":[...],"keywords":[...]}`,
          jsonMode: true,
          maxTokens: 1500,
          temperature: 0.5,
          tag: "suggest-candidate-config",
        });
        const content = fb.choices?.[0]?.message?.content || "{}";
        const m = content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m?.[0] ?? content);
        console.log(`✅ Fallback ${fb.provider}:${fb.model}`);
      } catch (e) {
        const msg = (e as Error).message || "AI indisponível";
        return new Response(JSON.stringify({ error: msg }), {
          status: /créditos/i.test(msg) ? 402 : /limite/i.test(msg) ? 429 : 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    return new Response(JSON.stringify({
      canais_telegram: parsed.canais_telegram ?? [],
      subreddits: parsed.subreddits ?? [],
      keywords: parsed.keywords ?? [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[suggest-candidate-config] erro:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
