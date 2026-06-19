// Análise Regional 100% IA — gera percepção, temas, apoios, riscos, narrativas e recomendações
// para o Brasil inteiro + 5 regiões, sem depender de contagem de menções.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
type Region = typeof REGIONS[number];

interface RegionAnalysis {
  region: Region;
  temperatura: "Favorável" | "Competitiva" | "Fria" | "Hostil";
  regional_strength_score: number; // 0-100
  rejection_score: number; // 0-100
  percepcao: string;
  temas: { nome: string; intensidade: "Baixa" | "Média" | "Alta" }[];
  apoia: string[];
  rejeita: string[];
  riscos: { titulo: string; severidade: "baixa" | "média" | "alta" | "crítica" }[];
  oportunidades: string[];
  narrativas_funcionam: string[];
  narrativas_falham: string[];
  recomendacoes: string[];
}

interface NationalKPIs {
  forca_nacional: number;
  melhor_regiao: Region;
  regiao_risco: Region;
  expansao_potencial: Region;
  sintese: string;
}

interface Result {
  national: NationalKPIs;
  regions: RegionAnalysis[];
  generated_at: string;
  fallback?: boolean;
}

function fallbackResult(candidateName: string): Result {
  const r: RegionAnalysis[] = REGIONS.map((region) => ({
    region,
    temperatura: "Competitiva",
    regional_strength_score: 50,
    rejection_score: 35,
    percepcao: `Percepção sobre ${candidateName} na região ${region} ainda em construção. Análise contextual indisponível no momento.`,
    temas: [
      { nome: "Economia", intensidade: "Média" },
      { nome: "Segurança", intensidade: "Média" },
    ],
    apoia: ["base partidária local"],
    rejeita: ["oposição organizada"],
    riscos: [{ titulo: "Baixa exposição regional", severidade: "média" }],
    oportunidades: ["ampliar presença digital"],
    narrativas_funcionam: ["gestão"],
    narrativas_falham: ["radicalismo"],
    recomendacoes: ["intensificar agenda regional", "aliança com lideranças locais", "comunicação adaptada"],
  }));
  return {
    national: {
      forca_nacional: 50,
      melhor_regiao: "Sudeste",
      regiao_risco: "Nordeste",
      expansao_potencial: "Centro-Oeste",
      sintese: "Análise gerada em modo contextual. Resultados detalhados ficarão disponíveis na próxima execução.",
    },
    regions: r,
    generated_at: new Date().toISOString(),
    fallback: true,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: userData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { candidate_id, period_label, period_from, period_to } = body;
    if (!candidate_id) {
      return new Response(JSON.stringify({ error: "missing candidate_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carregar contexto do candidato
    const { data: cand, error: candErr } = await admin
      .from("candidates")
      .select("full_name, party, region")
      .eq("id", candidate_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (candErr) console.error("[regional-ai-analysis] candidate query error:", candErr.message);

    if (!cand) {
      return new Response(JSON.stringify({ error: "candidate not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const periodText = period_from && period_to
      ? `${period_from} a ${period_to}`
      : period_label || "últimos 30 dias";

    const prompt = `Você é um estrategista político sênior brasileiro especializado em análise regional eleitoral.

Analise a percepção pública do candidato abaixo em cada uma das 5 regiões do Brasil. Use seu conhecimento sobre política brasileira, perfis regionais de eleitorado, temas dominantes em cada região e o contexto ideológico/partidário do candidato.

CANDIDATO:
- Nome: ${cand.full_name}
- Partido: ${cand.party || "não informado"}
- Estado base: ${cand.state || "não informado"}
- Cargo disputado: ${cand.position || "não informado"}
- Biografia: ${(cand.biography || "não informada").slice(0, 600)}

PERÍODO DE ANÁLISE: ${periodText}

Gere uma análise estratégica para cada região (Norte, Nordeste, Centro-Oeste, Sudeste, Sul), cobrindo:
- temperatura eleitoral (Favorável / Competitiva / Fria / Hostil)
- regional_strength_score 0-100 (força do candidato na região)
- rejection_score 0-100 (rejeição na região)
- percepção pública (parágrafo curto, 2-3 frases)
- temas dominantes (5 a 8 temas com intensidade Baixa/Média/Alta)
- quem apoia (3 a 6 grupos sociais)
- quem rejeita (3 a 6 grupos sociais)
- riscos regionais (2 a 4 itens com severidade baixa/média/alta/crítica)
- oportunidades (3 a 5 itens)
- narrativas que funcionam (3 a 5 frases curtas)
- narrativas que falham (3 a 5 frases curtas)
- 3 recomendações estratégicas de campanha

Também gere um RESUMO NACIONAL com:
- forca_nacional (0-100)
- melhor_regiao (nome)
- regiao_risco (nome)
- expansao_potencial (nome)
- sintese (1-2 frases)

Responda APENAS um JSON válido neste formato exato:
{
  "national": {
    "forca_nacional": 0,
    "melhor_regiao": "Sudeste",
    "regiao_risco": "Nordeste",
    "expansao_potencial": "Centro-Oeste",
    "sintese": "..."
  },
  "regions": [
    {
      "region": "Norte",
      "temperatura": "Competitiva",
      "regional_strength_score": 0,
      "rejection_score": 0,
      "percepcao": "...",
      "temas": [{"nome":"Economia","intensidade":"Alta"}],
      "apoia": ["..."],
      "rejeita": ["..."],
      "riscos": [{"titulo":"...","severidade":"média"}],
      "oportunidades": ["..."],
      "narrativas_funcionam": ["..."],
      "narrativas_falham": ["..."],
      "recomendacoes": ["...","...","..."]
    }
  ]
}

Inclua EXATAMENTE 5 regiões: Norte, Nordeste, Centro-Oeste, Sudeste, Sul. Em português brasileiro.`;

    try {
      const aiRes = await callAICerebrasFirst({
        systemMsg: "Você é um estrategista político brasileiro. Sempre responda JSON válido em português.",
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 4500,
        temperature: 0.5,
        tag: "regional-ai-analysis",
      });

      let parsed: any = {};
      try {
        parsed = JSON.parse(aiRes.content || "{}");
      } catch {
        const m = (aiRes.content || "").match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }

      // Normalizar
      const regionsOut: RegionAnalysis[] = REGIONS.map((rg) => {
        const found = (parsed.regions || []).find((x: any) => (x.region || "").toString().toLowerCase().includes(rg.toLowerCase().slice(0, 4)));
        if (!found) {
          return {
            region: rg,
            temperatura: "Competitiva",
            regional_strength_score: 50,
            rejection_score: 40,
            percepcao: `Análise regional para ${rg} indisponível.`,
            temas: [], apoia: [], rejeita: [], riscos: [], oportunidades: [],
            narrativas_funcionam: [], narrativas_falham: [], recomendacoes: [],
          };
        }
        return {
          region: rg,
          temperatura: found.temperatura || "Competitiva",
          regional_strength_score: Number(found.regional_strength_score) || 50,
          rejection_score: Number(found.rejection_score) || 40,
          percepcao: String(found.percepcao || ""),
          temas: Array.isArray(found.temas) ? found.temas.slice(0, 8) : [],
          apoia: Array.isArray(found.apoia) ? found.apoia.slice(0, 6) : [],
          rejeita: Array.isArray(found.rejeita) ? found.rejeita.slice(0, 6) : [],
          riscos: Array.isArray(found.riscos) ? found.riscos.slice(0, 4) : [],
          oportunidades: Array.isArray(found.oportunidades) ? found.oportunidades.slice(0, 5) : [],
          narrativas_funcionam: Array.isArray(found.narrativas_funcionam) ? found.narrativas_funcionam.slice(0, 5) : [],
          narrativas_falham: Array.isArray(found.narrativas_falham) ? found.narrativas_falham.slice(0, 5) : [],
          recomendacoes: Array.isArray(found.recomendacoes) ? found.recomendacoes.slice(0, 3) : [],
        };
      });

      const nat = parsed.national || {};
      const result: Result = {
        national: {
          forca_nacional: Number(nat.forca_nacional) || 50,
          melhor_regiao: (nat.melhor_regiao as Region) || "Sudeste",
          regiao_risco: (nat.regiao_risco as Region) || "Nordeste",
          expansao_potencial: (nat.expansao_potencial as Region) || "Centro-Oeste",
          sintese: String(nat.sintese || ""),
        },
        regions: regionsOut,
        generated_at: new Date().toISOString(),
      };

      console.log(`[regional-ai-analysis] ✅ ${aiRes.provider}:${aiRes.model}`);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("[regional-ai-analysis] AI failed:", (e as Error).message);
      return new Response(JSON.stringify(fallbackResult(cand.full_name)), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("regional-ai-analysis error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
