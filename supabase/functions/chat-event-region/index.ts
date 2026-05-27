// External-first chat about event repercussion.
// Uses cached external publications + (optional) internal comments as evidence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { eventId, region, question } = await req.json();
    if (!eventId || !question) return new Response(JSON.stringify({ error: "eventId e question obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: event } = await admin.from("political_events").select("*").eq("id", eventId).eq("user_id", user.id).maybeSingle();
    if (!event) return new Response(JSON.stringify({ error: "Evento não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const cached = event.metadata?.external_cache?.payload;
    const sources = cached?.externalRepercussion?.sources || [];
    const narratives = cached?.externalRepercussion?.narratives || { apoio: [], criticas: [], debates: [] };
    const dist = cached?.externalRepercussion?.regionalDistribution || {};
    const internal = cached?.internalReaction || { mentions: 0 };

    const filteredSources = region
      ? sources.filter((s: any) => s.region === region)
      : sources;
    const sourceList = (filteredSources.length ? filteredSources : sources).slice(0, 30).map((s: any, i: number) =>
      `[${i + 1}] (${s.outlet}, ${s.region}, ${s.publishedAt?.slice(0, 10) || "?"}) ${s.title} — ${s.snippet}`
    ).join("\n");

    const prompt = `Analise apenas dados relacionados ao evento abaixo usando as PUBLICAÇÕES EXTERNAS como fonte principal. Use os dados internos da plataforma apenas como complemento.

Evento: "${event.event_name}" (${event.event_type}) em ${String(event.event_date).slice(0, 10)}.
${region ? `Foco regional: ${region}.` : "Análise nacional."}

DISTRIBUIÇÃO REGIONAL DA COBERTURA (externa):
${Object.entries(dist).map(([r, p]) => `- ${r}: ${p}%`).join("\n") || "(sem dados)"}

NARRATIVAS DETECTADAS:
- Apoio: ${(narratives.apoio || []).join(" | ") || "—"}
- Críticas: ${(narratives.criticas || []).join(" | ") || "—"}
- Debates: ${(narratives.debates || []).join(" | ") || "—"}

REAÇÃO DA PLATAFORMA (complemento): ${internal.mentions} menções internas (${internal.positive || 0} pos / ${internal.negative || 0} neg).

PUBLICAÇÕES EXTERNAS:
${sourceList || "(sem publicações coletadas)"}

Pergunta: "${question}"

Responda em português, baseado SOMENTE nas evidências acima. Máximo 6 frases. Cite veículos quando relevante. Se a pergunta não puder ser respondida com os dados disponíveis, diga claramente.`;

    try {
      const ai = await callAICerebrasFirst({
        systemMsg: "Você é um analista político brasileiro. Responde apenas com base nas publicações externas fornecidas, usando dados internos como complemento.",
        userPrompt: prompt,
        maxTokens: 700,
        temperature: 0.35,
        tag: "chat-event-region-external",
      });
      return new Response(JSON.stringify({
        answer: ai.content?.trim() || "Sem resposta da IA.",
        provider: ai.provider,
        model: ai.model,
        externalSourceCount: filteredSources.length || sources.length,
        internalMentions: internal.mentions,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({
        answer: `Coletei ${sources.length} publicações externas${region ? ` (${filteredSources.length} de ${region})` : ""} sobre este evento, mas a IA está temporariamente indisponível. Tente novamente em alguns instantes.`,
        fallback: true,
        error: (e as Error).message,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
