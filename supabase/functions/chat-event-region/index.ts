// Chat sobre repercussão de evento, opcionalmente filtrado por região.
// Carrega comentários reais e usa IA (Cerebras→fallback) para responder.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UF_TO_REGION: Record<string, string> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

function normRegion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (n.startsWith("nort") && !n.includes("este")) return "Norte";
  if (n.startsWith("nordest")) return "Nordeste";
  if (n.startsWith("centro")) return "Centro-Oeste";
  if (n.startsWith("sudest")) return "Sudeste";
  if (n.startsWith("sul")) return "Sul";
  return null;
}

function inferRegion(text: string): string | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [uf, region] of Object.entries(UF_TO_REGION)) {
    if (new RegExp(`\\b${uf.toLowerCase()}\\b`, "i").test(t)) return region;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { eventId, region, question } = await req.json();
    if (!eventId || !question) return new Response(JSON.stringify({ error: "eventId e question são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: event } = await admin.from("political_events").select("*").eq("id", eventId).eq("user_id", user.id).maybeSingle();
    if (!event) return new Response(JSON.stringify({ error: "Evento não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const eventDate = new Date(event.event_date);
    const start = new Date(eventDate.getTime() - 86400_000);
    const end = new Date(eventDate.getTime() + 7 * 86400_000);
    const keywords: string[] = Array.isArray(event.keywords) ? event.keywords.map((k: string) => String(k).toLowerCase().trim()).filter(Boolean) : [];

    // Pull comments (cap 8k)
    const all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("social_interactions")
        .select("comment_text, sentiment_label, likes_count, replies_count, region, social_network, comment_author, created_at, original_posted_at")
        .eq("candidate_id", event.candidate_id)
        .or(`and(original_posted_at.gte.${start.toISOString()},original_posted_at.lte.${end.toISOString()}),and(original_posted_at.is.null,created_at.gte.${start.toISOString()},created_at.lte.${end.toISOString()})`)
        .order("original_posted_at", { ascending: false, nullsFirst: false })
        .range(from, from + 999);
      if (error || !data || !data.length) break;
      all.push(...data);
      if (data.length < 1000 || all.length >= 8000) break;
      from += 1000;
    }

    let filtered = keywords.length > 0
      ? all.filter((c) => { const t = (c.comment_text || "").toLowerCase(); return keywords.some((k) => t.includes(k)); })
      : all;

    if (region) {
      filtered = filtered.filter((c) => {
        const r = normRegion(c.region) || inferRegion(`${c.comment_text || ""} ${c.comment_author || ""}`);
        return r === region;
      });
    }

    if (filtered.length < 20) {
      return new Response(JSON.stringify({
        answer: `Dados insuficientes para uma análise confiável${region ? ` na região ${region}` : ""}. Foram encontrados apenas ${filtered.length} comentários relevantes.`,
        sampleCount: filtered.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build sample: top engagement
    const pos = filtered.filter((c) => c.sentiment_label === "Positivo").sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0)).slice(0, 30);
    const neg = filtered.filter((c) => c.sentiment_label === "Negativo").sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0)).slice(0, 30);
    const neu = filtered.filter((c) => c.sentiment_label === "Neutro").sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0)).slice(0, 15);

    const sample = (rows: any[]) => rows.map((r) => `- ${String(r.comment_text || "").slice(0, 220)}`).join("\n");

    const stats = {
      total: filtered.length,
      pos: filtered.filter((c) => c.sentiment_label === "Positivo").length,
      neg: filtered.filter((c) => c.sentiment_label === "Negativo").length,
      neu: filtered.filter((c) => c.sentiment_label === "Neutro").length,
    };

    const prompt = `Evento: "${event.event_name}" (${event.event_type}) em ${event.event_date.slice(0, 10)}.
${region ? `Foco: região ${region} do Brasil.` : "Análise nacional."}

Estatísticas dos comentários filtrados:
- Total: ${stats.total}
- Positivos: ${stats.pos}
- Negativos: ${stats.neg}
- Neutros: ${stats.neu}

Amostra positiva:
${sample(pos)}

Amostra negativa:
${sample(neg)}

Amostra neutra:
${sample(neu)}

Pergunta do usuário: "${question}"

Responda em português, de forma direta e baseada SOMENTE nos comentários acima. Máximo 6 frases. Cite tendências reais identificadas, não invente. Se a pergunta não puder ser respondida com os dados, diga isso claramente.`;

    try {
      const ai = await callAICerebrasFirst({
        systemMsg: "Você é um analista político brasileiro especialista em análise regional de opinião pública. Responda em português, sempre baseado em dados reais fornecidos.",
        userPrompt: prompt,
        maxTokens: 700,
        temperature: 0.4,
        tag: "chat-event-region",
      });
      return new Response(JSON.stringify({
        answer: ai.content?.trim() || "Sem resposta da IA.",
        provider: ai.provider,
        model: ai.model,
        sampleCount: filtered.length,
        stats,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({
        answer: `Encontrei ${stats.total} comentários relevantes (${stats.pos} positivos, ${stats.neg} negativos, ${stats.neu} neutros)${region ? ` na região ${region}` : ""}, mas a IA está temporariamente indisponível para gerar a análise contextual. Tente novamente em alguns minutos.`,
        fallback: true,
        error: (e as Error).message,
        stats,
        sampleCount: filtered.length,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
