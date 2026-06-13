// Edge Function: radar-ai-search
// AI-first political event radar. Consulta IA externa (Lovable AI Gateway) e devolve eventos estruturados.
// Cache em radar_cache (TTL 6h por user_id + period_hash).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";

interface ReqBody {
  candidate_id?: string | null;
  candidate_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  categories?: string[];
  force_refresh?: boolean;
}

function hashPeriod(b: ReqBody): string {
  const cats = [...(b.categories ?? [])].sort().join(",");
  return `${b.candidate_id ?? "all"}|${b.candidate_name}|${b.start_date}|${b.end_date}|${cats}`;
}

function safeNum(v: any, def = 0, min = 0, max = 100) {
  const n = Number(v);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeEvents(raw: any[]): any[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((e) => e && typeof e.title === "string" && e.title.length > 3)
    .map((e, i) => {
      const sources = Array.isArray(e.sources) ? e.sources.filter((s: any) => s?.name && s?.url) : [];
      const source_count = sources.length || safeNum(e.source_count, 1, 0, 999);
      const institutional_sources = safeNum(e.institutional_sources, 0, 0, 999);
      const social_score = safeNum(e.social_score, 0);
      const computed = source_count * 2 + institutional_sources * 10 + social_score * 0.3;
      const importance = Math.min(100, Math.round(computed));
      return {
        id: e.id ?? `${Date.now()}-${i}`,
        title: String(e.title).slice(0, 280),
        summary: String(e.summary ?? "").slice(0, 1200),
        category: String(e.category ?? "Outros"),
        event_date: e.event_date ?? null,
        source_count,
        institutional_sources,
        social_score,
        importance,
        sources: sources.slice(0, 20).map((s: any) => ({
          name: String(s.name).slice(0, 120),
          url: String(s.url).slice(0, 600),
          type: s.type ?? "news",
        })),
      };
    });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY ausente" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "invalid_auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const body = (await req.json().catch(() => null)) as ReqBody | null;
    if (!body?.candidate_name || !body?.start_date || !body?.end_date) {
      return new Response(JSON.stringify({ error: "campos obrigatórios: candidate_name, start_date, end_date" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const period_hash = hashPeriod(body);

    // Cache lookup
    if (!body.force_refresh) {
      const { data: cached } = await admin
        .from("radar_cache")
        .select("response_json,expires_at,event_count,created_at")
        .eq("user_id", userId)
        .eq("period_hash", period_hash)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (cached?.response_json) {
        return new Response(
          JSON.stringify({
            events: cached.response_json,
            cached: true,
            cached_at: cached.created_at,
            count: cached.event_count,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const catFilter =
      body.categories && body.categories.length > 0 && !body.categories.includes("Todos")
        ? `Filtrar APENAS para as categorias: ${body.categories.join(", ")}.`
        : "Cobrir todas as categorias políticas.";

    const systemPrompt = `Você é um pesquisador político brasileiro especializado em eventos institucionais e midiáticos.
Sua tarefa: listar EVENTOS POLÍTICOS REAIS já cobertos por veículos profissionais.
Fontes prioritárias: STF, STJ, TSE, Senado, Câmara, Planalto, PF, AGU, CGU, TCU, CNJ, Diário Oficial,
G1, Folha, Estadão, UOL, CNN Brasil, O Globo, Agência Brasil, Reuters, Bloomberg, Metrópoles, Poder360, JOTA, Veja, Valor.
Nunca invente fontes ou URLs. Se não tiver certeza, omita o evento.
Responda SEMPRE em português do Brasil.
Responda EXCLUSIVAMENTE com JSON válido — sem markdown, sem texto fora do JSON.`;

    const userPrompt = `Liste eventos políticos relevantes envolvendo "${body.candidate_name}" no período de ${body.start_date} até ${body.end_date}.
${catFilter}

Critérios de inclusão:
- decisões judiciais (STF/STJ/TSE), investigações, prisões, julgamentos
- ações do Executivo, vetos, MPs, nomeações
- votações relevantes no Congresso, CPIs
- declarações, escândalos, repercussão nacional
- eventos eleitorais e partidários

Formato OBRIGATÓRIO de resposta:
{
  "events": [
    {
      "title": "string (até 200 chars)",
      "summary": "string (2-4 frases factuais)",
      "category": "Eleições|STF|TSE|PF|CPI|Congresso|Executivo|Economia|Escândalos|Prisões|Julgamentos|Internacional|Outros",
      "event_date": "YYYY-MM-DD",
      "source_count": 0,
      "institutional_sources": 0,
      "social_score": 0,
      "sources": [
        { "name": "Nome do veículo", "url": "https://...", "type": "institutional|news|international" }
      ]
    }
  ]
}

Retorne entre 30 e 80 eventos quando o período for amplo, e o máximo que tiver com alta confiabilidade quando o período for curto.
Ordene do mais recente para o mais antigo.`;

    async function callModel(model: string) {
      return await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_KEY! },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });
    }

    let aiRes = await callModel(MODEL);
    if (aiRes.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      aiRes = await callModel(FALLBACK_MODEL);
    }

    if (!aiRes.ok) {
      const t = await aiRes.text();
      const friendly =
        aiRes.status === 429
          ? "A IA está com limite excedido no momento (muitos usuários gratuitos). Tente novamente em 30s ou faça upgrade do plano."
          : aiRes.status === 402
          ? "Créditos de IA esgotados. Adicione créditos para continuar."
          : `Falha na IA (${aiRes.status}).`;
      return new Response(JSON.stringify({ error: `ai_${aiRes.status}`, message: friendly, detail: t.slice(0, 300) }), {
        status: aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const text = aiData?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = { events: [] };
        }
      }
    }

    const events = normalizeEvents(parsed.events ?? parsed);

    await admin
      .from("radar_cache")
      .upsert(
        {
          user_id: userId,
          candidate_id: body.candidate_id ?? null,
          candidate_name: body.candidate_name,
          period_hash,
          start_date: body.start_date,
          end_date: body.end_date,
          categories: body.categories ?? [],
          response_json: events,
          event_count: events.length,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "user_id,period_hash" },
      );

    return new Response(
      JSON.stringify({ events, cached: false, count: events.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
