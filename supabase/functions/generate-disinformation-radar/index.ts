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

const STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","que","um","uma","para","por","com","em","no","na","nos","nas",
  "os","as","se","na","à","às","ao","aos","sua","seu","suas","seus","este","esta","isso","isto","aquilo",
  "ele","ela","eles","elas","você","voce","vocês","voces","é","era","foi","ser","estar","tem","tinha",
  "mais","menos","também","ja","já","não","sim","mas","como","onde","quando","porque","porquê","por que",
  "the","and","of","for","to","in","on","at","is","are","was","were","be","this","that","it","https","http",
  "www","com","org","br","html","php","p","the","of","and","www","tem","the","um","2024","2025","2023"
]);

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9áéíóúãõçâêô\s#@]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function topKeywords(texts: string[], limit = 20): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const w of tokenize(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function fallbackReport(candidate: any, periodLabel: string) {
  return {
    fake_news_count: 0,
    reputational_risk: "Médio",
    attack_intensity: 30,
    digital_vulnerability: "Moderada",
    executive_summary: `Não foi possível gerar análise detalhada para ${candidate.full_name} nos últimos ${periodLabel}. Tente novamente em instantes.`,
    fake_news_items: [],
    how_to_identify: [],
    how_to_respond: [],
    narrative_categories: [],
  };
}

type AnalysisMode = "data_driven" | "ai_research";

async function callAI(input: {
  candidate: any;
  periodLabel: string;
  daysBack: number;
  totals: any;
  keywords: { word: string; count: number }[];
  topNegativeSamples: string[];
  topPosts: any[];
  networks: { network: string; count: number }[];
  regions: { region: string; count: number }[];
  mode: AnalysisMode;
}) {
  const {
    candidate, periodLabel, daysBack, totals,
    keywords, topNegativeSamples, topPosts, networks, regions, mode,
  } = input;

  const commonJsonSchema = `Responda EXCLUSIVAMENTE com JSON válido no formato:
{
  "fake_news_count": number,
  "reputational_risk": "Baixo" | "Médio" | "Alto" | "Crítico",
  "attack_intensity": number (0-100),
  "digital_vulnerability": "Baixa" | "Moderada" | "Alta" | "Crítica",
  "executive_summary": "3-5 frases analíticas em pt-BR",
  "fake_news_items": [
    {
      "title": "narrativa específica e plausível",
      "probability": number (0-100),
      "explanation": "por que essa narrativa é plausível neste contexto",
      "likely_origin": "rede social, região ou grupo típico"
    }
  ],
  "how_to_identify": ["dica prática 1", ...] (4-6 dicas),
  "how_to_respond": ["ação estratégica 1", ...] (4-6 ações),
  "narrative_categories": [
    { "category": "nome da categoria", "intensity": 0-100 }
  ]
}`;

  let systemMsg: string;
  let userPrompt: string;

  if (mode === "data_driven") {
    systemMsg = `Você é um analista brasileiro sênior em inteligência política e desinformação. Analise fake news e ataques reputacionais REAIS contra o candidato com base EXCLUSIVAMENTE nos dados coletados fornecidos.

REGRAS:
- Toda fake news identificada DEVE ter conexão direta com temas dominantes, palavras-chave ou comentários negativos presentes nos dados.
- NÃO reutilize narrativas padrão genéricas se não estiverem nos dados.
- Responda SEMPRE em português do Brasil e SEMPRE em JSON válido.`;

    userPrompt = `Analise os dados REAIS coletados sobre o candidato abaixo nos últimos ${periodLabel}.

## CANDIDATO
- Nome: ${candidate.full_name}
- Partido: ${candidate.party || "N/D"} (${candidate.party_name || "N/D"})
- Região/UF: ${candidate.region || "N/D"}

## VOLUMES COLETADOS (${daysBack} dias)
- Total de menções: ${totals.total}
- Positivas: ${totals.positive} | Negativas: ${totals.negative} | Neutras: ${totals.neutral}
- Redes com maior volume: ${networks.slice(0, 5).map(n => `${n.network} (${n.count})`).join(", ") || "N/D"}
- Regiões com maior volume: ${regions.slice(0, 5).map(r => `${r.region} (${r.count})`).join(", ") || "N/D"}

## PALAVRAS-CHAVE DOMINANTES
${keywords.slice(0, 20).map(k => `- ${k.word} (${k.count}x)`).join("\n") || "- (nenhuma detectada)"}

## AMOSTRAS DE COMENTÁRIOS NEGATIVOS REAIS
${topNegativeSamples.length ? topNegativeSamples.map((c, i) => `${i + 1}. "${c.slice(0, 260)}"`).join("\n") : "(nenhum)"}

## POSTS DE MAIOR ENGAJAMENTO
${topPosts.length ? topPosts.slice(0, 8).map((p, i) => `${i + 1}. [${p.social_network || "?"}] ${(p.post_title || p.comment_text || "").slice(0, 200)}`).join("\n") : "(nenhum)"}

${commonJsonSchema}`;
  } else {
    // AI RESEARCH MODE — sem dados coletados suficientes
    systemMsg = `Você é um analista brasileiro sênior em inteligência política, desinformação eleitoral e comportamento do eleitorado brasileiro. Sua tarefa é gerar uma análise preditiva de possíveis narrativas de fake news que podem atingir um candidato, baseada em conhecimento contextual sobre:
- histórico político da região
- polarização ideológica local
- padrões brasileiros de desinformação eleitoral
- narrativas típicas contra o cargo político em questão
- perfil do eleitorado da região/cargo

REGRAS:
- Fake news devem ser PLAUSÍVEIS e contextualizadas ao cargo, partido e região — não genéricas nem absurdas.
- Considere o nível do cargo: vereador/prefeito → narrativas municipais; deputado estadual/distrital → estaduais; deputado federal/senador → nacionais/regionais; governador → estaduais amplas; presidente → nacionais.
- NUNCA diga "dados insuficientes". Gere sempre análise preditiva útil.
- Responda SEMPRE em português do Brasil e SEMPRE em JSON válido.`;

    userPrompt = `Gere uma análise PREDITIVA de fake news e riscos reputacionais para o candidato abaixo. Não há volume suficiente de menções coletadas (${totals.total} nos últimos ${periodLabel}), então baseie a análise em contexto político e padrões brasileiros de desinformação.

## CANDIDATO
- Nome: ${candidate.full_name}
- Cargo/Posição: ${candidate.party_name || "N/D"}
- Partido: ${candidate.party || "N/D"}
- Estado/Região: ${candidate.region || "N/D"}

## TAREFA
Analise possíveis narrativas de fake news que podem atingir este candidato considerando:
1. Cargo político e nível de exposição (municipal, estadual, federal)
2. Espectro ideológico do partido e polarização típica que ele gera
3. Contexto regional (${candidate.region || "Brasil"}) — histórico político, temas sensíveis
4. Padrões brasileiros de desinformação eleitoral (ex: para vereadores → favorecimento familiar, compra de votos, desvio de verba municipal; para presidente → corrupção nacional, manipulação econômica)
5. Perfil típico do eleitorado adversário

Gere:
- 4 a 7 narrativas de fake news PLAUSÍVEIS e contextualizadas
- Score de risco reputacional realista
- Intensidade de ataques esperada
- Vulnerabilidade digital
- Como identificar e como neutralizar essas narrativas
- Categorias de narrativa com intensidade estimada

${commonJsonSchema}`;
  }

  const r = await callAICerebrasFirst({
    systemMsg,
    userPrompt,
    jsonMode: true,
    maxTokens: 2800,
    temperature: mode === "ai_research" ? 0.6 : 0.4,
    tag: `disinfo-radar-${mode}`,
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

    const { data: candidate } = await supabase
      .from("candidates")
      .select("id, full_name, party, party_name, region, user_id")
      .eq("id", body.candidateId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!candidate) {
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

    // Fetch REAL data for this candidate — social_interactions
    const sinceIso = new Date(Date.now() - daysBack * 86400_000).toISOString();
    const { data: interactions } = await supabase
      .from("social_interactions")
      .select("comment_text,post_title,post_description,social_network,sentiment_label,sentiment_score,region,state,likes_count,shares_count,replies_count,original_posted_at")
      .eq("candidate_id", candidate.id)
      .gte("original_posted_at", sinceIso)
      .order("original_posted_at", { ascending: false })
      .limit(600);

    const rows = interactions ?? [];
    const totals = {
      total: rows.length,
      positive: rows.filter((r) => (r.sentiment_label || "").toLowerCase().startsWith("pos")).length,
      negative: rows.filter((r) => (r.sentiment_label || "").toLowerCase().startsWith("neg")).length,
      neutral: rows.filter((r) => (r.sentiment_label || "").toLowerCase().startsWith("neu")).length,
    };

    // Insufficient data guard — do NOT hallucinate
    if (totals.total < 15) {
      const payload = {
        candidate,
        period: { daysBack, label: periodLabel },
        report: fallbackInsufficient(candidate, periodLabel, totals),
        totals,
        model_used: "deterministic/insufficient-data",
        generated_at: new Date().toISOString(),
      };
      CACHE.set(cacheKey, { data: payload, ts: Date.now() });
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract signal
    const allTexts = rows.map((r) => [r.comment_text, r.post_title, r.post_description].filter(Boolean).join(" "));
    const keywords = topKeywords(allTexts, 25);

    const negatives = rows
      .filter((r) => (r.sentiment_label || "").toLowerCase().startsWith("neg") && r.comment_text)
      .slice(0, 20)
      .map((r) => r.comment_text as string);

    const topPosts = [...rows]
      .filter((r) => r.post_title || r.comment_text)
      .sort((a, b) =>
        ((b.likes_count || 0) + (b.shares_count || 0) + (b.replies_count || 0)) -
        ((a.likes_count || 0) + (a.shares_count || 0) + (a.replies_count || 0)),
      )
      .slice(0, 10);

    const netMap = new Map<string, number>();
    const regMap = new Map<string, number>();
    for (const r of rows) {
      if (r.social_network) netMap.set(r.social_network, (netMap.get(r.social_network) ?? 0) + 1);
      const reg = r.state || r.region;
      if (reg) regMap.set(reg, (regMap.get(reg) ?? 0) + 1);
    }
    const networks = [...netMap.entries()].map(([network, count]) => ({ network, count })).sort((a, b) => b.count - a.count);
    const regions = [...regMap.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);

    let report: any;
    let model_used = "fallback";
    try {
      const r = await callAI({
        candidate, periodLabel, daysBack, totals,
        keywords, topNegativeSamples: negatives, topPosts, networks, regions,
      });
      report = r.report;
      model_used = r.model_used;
    } catch (e) {
      console.error("[disinfo-radar] AI failed:", (e as Error).message);
      report = fallbackInsufficient(candidate, periodLabel, totals);
    }

    const payload = {
      candidate,
      period: { daysBack, label: periodLabel },
      report,
      totals,
      signals: {
        top_keywords: keywords.slice(0, 15),
        networks: networks.slice(0, 8),
        regions: regions.slice(0, 8),
      },
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
