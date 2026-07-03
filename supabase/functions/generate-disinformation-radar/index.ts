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
}) {
  const {
    candidate, periodLabel, daysBack, totals,
    keywords, topNegativeSamples, topPosts, networks, regions
  } = input;

  const systemMsg = `Você é um analista brasileiro sênior em inteligência política e desinformação. Sua tarefa é identificar narrativas de fake news e ataques reputacionais REAIS ou altamente plausíveis contra um candidato específico, com base EXCLUSIVAMENTE nos dados coletados fornecidos.

REGRAS INEGOCIÁVEIS:
- NÃO invente acusações genéricas (ex: "desvio de merenda", "milícia", "lavagem de dinheiro", "compra de votos") a menos que apareçam claramente nos dados reais fornecidos.
- NÃO reutilize narrativas padrão de outros candidatos.
- Toda fake news identificada DEVE ter conexão direta com os temas dominantes, palavras-chave, comentários negativos ou contexto regional presente nos dados.
- Se os dados forem insuficientes ou não apontarem para narrativas específicas, retorne "insufficient_data": true e uma lista vazia de fake_news_items — NUNCA invente.
- Responda SEMPRE em português do Brasil e SEMPRE em JSON válido.`;

  const userPrompt = `Analise os dados REAIS coletados sobre o candidato abaixo nos últimos ${periodLabel}.

## CANDIDATO
- Nome: ${candidate.full_name}
- Partido: ${candidate.party || "N/D"} (${candidate.party_name || "N/D"})
- Região/UF: ${candidate.region || "N/D"}

## VOLUMES COLETADOS (${daysBack} dias)
- Total de menções: ${totals.total}
- Positivas: ${totals.positive} | Negativas: ${totals.negative} | Neutras: ${totals.neutral}
- Redes com maior volume: ${networks.slice(0, 5).map(n => `${n.network} (${n.count})`).join(", ") || "N/D"}
- Regiões com maior volume: ${regions.slice(0, 5).map(r => `${r.region} (${r.count})`).join(", ") || "N/D"}

## PALAVRAS-CHAVE DOMINANTES (extraídas dos comentários e posts reais)
${keywords.slice(0, 20).map(k => `- ${k.word} (${k.count}x)`).join("\n") || "- (nenhuma detectada)"}

## AMOSTRAS DE COMENTÁRIOS NEGATIVOS REAIS
${topNegativeSamples.length ? topNegativeSamples.map((c, i) => `${i + 1}. "${c.slice(0, 260)}"`).join("\n") : "(nenhum comentário negativo relevante)"}

## POSTS/HEADLINES DE MAIOR ENGAJAMENTO
${topPosts.length ? topPosts.slice(0, 8).map((p, i) => `${i + 1}. [${p.social_network || "?"}] ${(p.post_title || p.comment_text || "").slice(0, 200)}`).join("\n") : "(nenhum post relevante)"}

## TAREFA
Com base ESTRITAMENTE nos dados acima, identifique:
1. Narrativas de desinformação ou fake news que já estão circulando OU têm alta probabilidade de surgir dado o contexto real do candidato.
2. Cada fake news identificada precisa citar em "explanation" a evidência específica dos dados que a sustenta (palavras-chave, tópicos, comentários).
3. Se os dados não apontarem para narrativas específicas (ex: total < 20 menções OU keywords sem padrão hostil), retorne "insufficient_data": true e "fake_news_items": [].

Responda EXCLUSIVAMENTE com JSON no formato:
{
  "insufficient_data": boolean,
  "fake_news_count": number,
  "reputational_risk": "Baixo" | "Médio" | "Alto" | "Crítico",
  "attack_intensity": number (0-100, baseado em % negativas e volume real),
  "digital_vulnerability": "Baixa" | "Moderada" | "Alta" | "Crítica",
  "executive_summary": "3-5 frases citando dados concretos: volume, redes dominantes, temas reais detectados",
  "fake_news_items": [
    {
      "title": "narrativa específica ligada aos dados reais",
      "probability": number (0-100, baseado em frequência real nos dados),
      "explanation": "por que é suspeita, citando keywords/temas encontrados",
      "likely_origin": "rede social, região ou padrão observado nos dados"
    }
  ],
  "how_to_identify": ["dica prática 1", ...] (4-6 dicas contextualizadas ao caso),
  "how_to_respond": ["ação estratégica 1", ...] (4-6 ações específicas para este candidato/contexto),
  "narrative_categories": [
    { "category": "nome da categoria REAL detectada nos dados", "intensity": 0-100 }
  ] (use apenas categorias que emergem dos dados; se detectar temas como "obras públicas", "mobilidade", "orçamento", use-os literalmente)
}`;

  const r = await callAICerebrasFirst({
    systemMsg,
    userPrompt,
    jsonMode: true,
    maxTokens: 2800,
    temperature: 0.35,
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
