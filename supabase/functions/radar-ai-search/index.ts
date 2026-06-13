// Edge Function: radar-ai-search
// AI-first political event radar. Consulta IA externa (Lovable AI Gateway) e devolve eventos estruturados.
// Cache em radar_cache (TTL 6h por user_id + period_hash).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_MODELS = ["llama-3.3-70b", "llama3.1-8b", "qwen-3-235b-a22b-instruct-2507"];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractText(provider: string, data: any): string {
  if (provider === "gemini") {
    return data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  }
  return data?.choices?.[0]?.message?.content ?? "";
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
    const CEREBRAS_KEY = Deno.env.get("CEREBRAS_API_KEY");
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!CEREBRAS_KEY && !GROQ_KEY && !GEMINI_KEY) {
      return jsonResponse({
        error: "ai_unconfigured",
        message: "Nenhum provedor de IA está configurado para o Radar Político.",
        fallback: true,
        events: [],
        cached: false,
        count: 0,
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

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    async function callOpenAICompat(provider: "cerebras" | "groq", model: string, key: string) {
      const res = await fetch(provider === "cerebras" ? CEREBRAS_URL : GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: provider === "cerebras" ? 8192 : 4096,
        }),
        signal: AbortSignal.timeout(provider === "cerebras" ? 35_000 : 30_000),
      });
      const raw = await res.text();
      return { ok: res.ok, status: res.status, raw, provider, model };
    }

    async function callGemini(model: string, key: string) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(35_000),
      });
      const raw = await res.text();
      return { ok: res.ok, status: res.status, raw, provider: "gemini", model };
    }

    const attempts: Array<() => Promise<{ ok: boolean; status: number; raw: string; provider: string; model: string }>> = [];
    if (CEREBRAS_KEY) CEREBRAS_MODELS.forEach((model) => attempts.push(() => callOpenAICompat("cerebras", model, CEREBRAS_KEY)));
    if (GROQ_KEY) GROQ_MODELS.forEach((model) => attempts.push(() => callOpenAICompat("groq", model, GROQ_KEY)));
    if (GEMINI_KEY) GEMINI_MODELS.forEach((model) => attempts.push(() => callGemini(model, GEMINI_KEY)));

    let text = "{}";
    let usedProvider = "none";
    let lastFailure = "";
    for (const attempt of attempts) {
      try {
        const result = await attempt();
        if (!result.ok) {
          lastFailure = `${result.provider}:${result.model} HTTP ${result.status} ${result.raw.slice(0, 220)}`;
          console.warn(`[RADAR-AI] ${lastFailure}`);
          if (result.status === 429 || result.status === 402) await sleep(900);
          continue;
        }
        const data = JSON.parse(result.raw);
        text = extractText(result.provider, data) || "{}";
        usedProvider = `${result.provider}:${result.model}`;
        break;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        console.warn(`[RADAR-AI] provider failed: ${lastFailure}`);
      }
    }

    if (usedProvider === "none") {
      return jsonResponse({
        error: "ai_unavailable",
        message: "Todos os provedores de IA estão temporariamente indisponíveis. Tente novamente em instantes.",
        detail: lastFailure.slice(0, 300),
        fallback: true,
        events: [],
        cached: false,
        count: 0,
      });
    }
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
      JSON.stringify({ events, cached: false, count: events.length, provider: usedProvider }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[RADAR-AI] erro inesperado", e);
    return jsonResponse({
      error: "radar_failed",
      message: "O Radar Político não conseguiu concluir a busca agora. Tente novamente em instantes.",
      detail: (e as Error).message,
      fallback: true,
      events: [],
      cached: false,
      count: 0,
    });
  }
});
