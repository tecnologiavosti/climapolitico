import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CACHE = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30min

interface Payload {
  candidateId: string;
  daysBack?: number;
}

function fallbackReport(candidate: any, periodLabel: string) {
  return {
    fake_news_count: 0,
    reputational_risk: "Médio",
    attack_intensity: 40,
    digital_vulnerability: "Moderada",
    executive_summary: `Análise indisponível no momento para ${candidate.full_name} (${periodLabel}). Tente gerar novamente em alguns instantes.`,
    fake_news_items: [],
    how_to_identify: [
      "Verifique a fonte original da informação em órgãos oficiais",
      "Confirme datas, autores e contexto antes de compartilhar",
      "Desconfie de manchetes sensacionalistas ou emocionais",
      "Consulte agências de checagem (Lupa, Aos Fatos, Comprova)",
    ],
    how_to_respond: [
      "Publicar nota oficial esclarecendo os fatos",
      "Gravar vídeo curto direto ao ponto para redes sociais",
      "Acionar fact-checkers reconhecidos para checagem independente",
      "Reforçar comunicação institucional com dados verificáveis",
    ],
    narrative_categories: [
      { category: "Corrupção", intensity: 20 },
      { category: "Economia", intensity: 15 },
      { category: "Segurança", intensity: 10 },
      { category: "Saúde", intensity: 10 },
      { category: "Educação", intensity: 10 },
      { category: "Ataques pessoais", intensity: 15 },
    ],
  };
}

async function callAI(candidate: any, periodLabel: string, daysBack: number) {
  const systemMsg =
    "Você é um analista brasileiro sênior em desinformação política, fake news, ataques reputacionais e narrativas manipuladas. Responda SEMPRE em português do Brasil e SEMPRE em JSON válido conforme o schema.";
  const userPrompt = `Analise possíveis riscos de desinformação, fake news e ataques narrativos contra o candidato abaixo nos últimos ${daysBack} dias (${periodLabel}).

Candidato: ${candidate.full_name}
Partido (nome): ${candidate.party_name || "N/D"}
Partido: ${candidate.party || "N/D"}
Estado: ${candidate.region || "N/D"}

Considere o cenário político brasileiro atual, narrativas comuns contra candidatos deste perfil (cargo/partido/região), padrões de disseminação coordenada em redes sociais e vulnerabilidades típicas de exposição digital.

Responda EXCLUSIVAMENTE com JSON no formato:
{
  "fake_news_count": number (0-50),
  "reputational_risk": "Baixo" | "Médio" | "Alto" | "Crítico",
  "attack_intensity": number (0-100),
  "digital_vulnerability": "Baixa" | "Moderada" | "Alta" | "Crítica",
  "executive_summary": "texto de 3-5 frases descrevendo o cenário de desinformação e riscos identificados no período",
  "fake_news_items": [
    { "title": "manchete/afirmação da possível fake news", "probability": number (0-100), "explanation": "breve explicação do porquê é suspeita e como se propaga" }
  ] (retorne 4-8 itens plausíveis),
  "how_to_identify": ["dica 1", "dica 2", ...] (4-6 dicas práticas),
  "how_to_respond": ["ação estratégica 1", ...] (4-6 ações),
  "narrative_categories": [
    { "category": "Corrupção", "intensity": 0-100 },
    { "category": "Economia", "intensity": 0-100 },
    { "category": "Segurança", "intensity": 0-100 },
    { "category": "Saúde", "intensity": 0-100 },
    { "category": "Educação", "intensity": 0-100 },
    { "category": "Ataques pessoais", "intensity": 0-100 }
  ]
}`;

  const r = await callAICerebrasFirst({
    systemMsg,
    userPrompt,
    jsonMode: true,
    maxTokens: 2500,
    temperature: 0.55,
    tag: "disinfo-radar",
  });
  const parsed = JSON.parse(r.content || "{}");
  return { report: parsed, model_used: `${r.provider}/${r.model}` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: Payload = await req.json();
    if (!body.candidateId) {
      return new Response(JSON.stringify({ error: "candidateId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const daysBack = Math.max(1, Math.min(365, body.daysBack ?? 7));

    const { data: candidate, error: candErr } = await supabase
      .from("candidates")
      .select("id, full_name, party, party_name, region, user_id")
      .eq("id", body.candidateId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (candErr || !candidate) {
      return new Response(JSON.stringify({ error: "candidate not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const periodLabel = `${daysBack} dias`;
    const cacheKey = `${candidate.id}::${daysBack}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return new Response(
        JSON.stringify({ ...cached.data, cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let report: any;
    let model_used = "fallback";
    try {
      const r = await callAI(candidate, periodLabel, daysBack);
      report = r.report;
      model_used = r.model_used;
    } catch (e) {
      console.error("[disinfo-radar] AI failed:", (e as Error).message);
      report = fallbackReport(candidate, periodLabel);
    }

    const payload = {
      candidate: {
        id: candidate.id,
        full_name: candidate.full_name,
        party: candidate.party,
        region: candidate.region,
        party_name: candidate.party_name,
      },
      period: { daysBack, label: periodLabel },
      report,
      model_used,
      generated_at: new Date().toISOString(),
    };
    CACHE.set(cacheKey, { data: payload, ts: Date.now() });

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[disinfo-radar] fatal:", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
