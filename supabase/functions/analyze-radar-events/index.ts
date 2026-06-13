// Edge Function: analyze-radar-events
// Recebe uma lista resumida de eventos e devolve análise política em markdown.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface EventLite {
  title: string;
  date: string;
  category?: string;
  importance?: number;
  social?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY ausente" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const events: EventLite[] = Array.isArray(body.events) ? body.events.slice(0, 80) : [];
    const startDate: string = body.start_date ?? "";
    const endDate: string = body.end_date ?? "";
    const candidate: string = body.candidate_name ?? "todos os candidatos";

    if (events.length === 0) {
      return new Response(JSON.stringify({ analysis: "Sem eventos no período selecionado." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventsText = events
      .map(
        (e, i) =>
          `${i + 1}. [${e.date?.slice(0, 10)}] (${e.category ?? "—"}, imp:${Math.round(e.importance ?? 0)}, social:${Math.round(e.social ?? 0)}) ${e.title}`,
      )
      .join("\n");

    const prompt = `Você é um analista político brasileiro. Analise os eventos abaixo (${candidate}, período ${startDate} a ${endDate}) e produza em **português do Brasil**, em markdown, as seções:

## Principais tendências
## Eventos de maior impacto
## Alertas e riscos políticos
## Score geral de risco político
Inclua um número de 0 a 100 com 1-2 frases de justificativa.

Eventos:
${eventsText}`;

    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um analista político especializado em Brasil. Seja objetivo, factual e use markdown limpo." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: `AI gateway ${res.status}`, detail: txt }), {
        status: res.status === 429 || res.status === 402 ? res.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const analysis = data?.choices?.[0]?.message?.content ?? "Sem resposta.";

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
