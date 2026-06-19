// Análise Regional 100% IA — Híbrida (Região + Estado)
// Gera inteligência política contextual para 5 macrorregiões + 27 UFs, sem depender de menções.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
type Region = typeof REGIONS[number];

const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
] as const;

const UF_TO_REGION: Record<string, Region> = {
  AC:"Norte",AM:"Norte",AP:"Norte",PA:"Norte",RO:"Norte",RR:"Norte",TO:"Norte",
  AL:"Nordeste",BA:"Nordeste",CE:"Nordeste",MA:"Nordeste",PB:"Nordeste",PE:"Nordeste",PI:"Nordeste",RN:"Nordeste",SE:"Nordeste",
  DF:"Centro-Oeste",GO:"Centro-Oeste",MT:"Centro-Oeste",MS:"Centro-Oeste",
  ES:"Sudeste",MG:"Sudeste",RJ:"Sudeste",SP:"Sudeste",
  PR:"Sul",RS:"Sul",SC:"Sul",
};

const TEMAS = ["seguranca","economia","corrupcao","agro","meio_ambiente","saude"] as const;

interface StateAnalysis {
  uf: string;
  region: Region;
  temperatura: "Favorável" | "Competitiva" | "Hostil" | "Neutra";
  electoral_strength: number; // 0-100
  rejection_score: number;    // 0-100
  perfil_eleitor_dominante: string;
  temas_sensibilidade: { tema: string; score: number }[];
  penetracao: { capitais: number; cidades_medias: number; interior: number; rural_profundo: number };
  riscos: { titulo: string; severidade: "baixa" | "média" | "alta" | "crítica" }[];
  oportunidades: string[];
}

interface RegionSummary {
  region: Region;
  temperatura: string;
  regional_strength_score: number;
  rejection_score: number;
  percepcao: string;
}

interface NationalKPIs {
  forca_nacional: number;
  melhor_uf: string;
  uf_risco: string;
  expansao_potencial: string;
  sintese: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: userData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { candidate_id, period_label, period_from, period_to } = body;
    if (!candidate_id) return json({ error: "missing candidate_id" }, 400);

    const { data: cand, error: candErr } = await admin
      .from("candidates")
      .select("full_name, party, region")
      .eq("id", candidate_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (candErr) console.error("[regional-ai-analysis] candidate query error:", candErr.message);
    if (!cand) return json({ error: "candidate not found" }, 404);

    const periodText = period_from && period_to
      ? `${period_from} a ${period_to}`
      : period_label || "últimos 30 dias";

    const prompt = `Você é um estrategista político brasileiro sênior, com domínio de:
- histórico eleitoral por UF (TSE, eleições 2018/2020/2022/2024)
- densidade partidária e bases organizadas
- perfil socioeconômico (PIB per capita, IDH, urbanização)
- religiosidade (evangélicos/católicos), agro x urbano, capitais x interior
- ideologia dominante e fissuras locais

Faça uma análise política HÍBRIDA (5 macrorregiões + 27 estados) do candidato abaixo. Cada estado deve ter análise ESPECÍFICA E CONCRETA, citando fatos, atores políticos locais, demografia e dinâmicas reais — JAMAIS frases genéricas.

CANDIDATO:
- Nome: ${cand.full_name}
- Partido: ${cand.party || "não informado"}
- Região-base: ${cand.region || "não informada"}
PERÍODO: ${periodText}

PROIBIDO usar termos vagos como:
- "perfil agropecuarista"
- "base partidária local"
- "oposição organizada"
- "pode gerar adesão"
- "região desafiadora"
- "perfil conservador" (sem dizer qual conservadorismo, em que cidade, com que base)
- "ampliar presença digital"
- "aliança com lideranças locais" (sem nomear contexto real)

OBRIGATÓRIO em cada estado:
- "perfil_eleitor_dominante": frase concreta citando cidades, faixa etária ou grupo (ex: "Classe média B/C da Grande SP e ABC, eleitor 35-55 anos com peso evangélico em Guarulhos e Osasco").
- "riscos": nomear o RISCO REAL (ex: "Bolsão petista em Diadema e Mauá", "Lula 60%+ no semiárido baiano").
- "oportunidades": ações concretas e específicas (ex: "Disputar voto evangélico em Cariri-CE via pauta de costumes", não "ampliar presença digital").

NUNCA use scores genéricos (50/50). Diferencie cada UF com base no perfil real e no candidato específico.

Responda APENAS JSON válido neste formato exato:

{
  "national": {
    "forca_nacional": 0,
    "melhor_uf": "SP",
    "uf_risco": "BA",
    "expansao_potencial": "MG",
    "sintese": "Síntese estratégica nacional em 3-4 frases citando estados-chave."
  },
  "regions": [
    {"region":"Norte","temperatura":"Competitiva","regional_strength_score":0,"rejection_score":0,"percepcao":"3 a 4 frases densas e específicas sobre como o candidato é percebido nessa região, citando estados, polos e clivagens reais"}
  ],
  "states": [
    {
      "uf":"SP",
      "temperatura":"Favorável|Competitiva|Hostil|Neutra",
      "electoral_strength":0,
      "rejection_score":0,
      "perfil_eleitor_dominante":"frase específica com cidade/região, faixa etária e clivagem",
      "temas_sensibilidade":[
        {"tema":"seguranca","score":0},
        {"tema":"economia","score":0},
        {"tema":"corrupcao","score":0},
        {"tema":"agro","score":0},
        {"tema":"meio_ambiente","score":0},
        {"tema":"saude","score":0}
      ],
      "penetracao":{"capitais":0,"cidades_medias":0,"interior":0,"rural_profundo":0},
      "riscos":[{"titulo":"risco concreto com cidade/ator","severidade":"média"}],
      "oportunidades":["ação concreta e específica","outra ação concreta"]
    }
  ]
}

REGRAS OBRIGATÓRIAS:
- "regions": EXATAMENTE 5 itens (Norte, Nordeste, Centro-Oeste, Sudeste, Sul).
- "states": EXATAMENTE 27 itens, um para cada UF: ${UFS.join(", ")}.
- Todos os scores 0-100, diferenciados.
- "temas_sensibilidade": sempre os 6 temas: ${TEMAS.join(", ")}.
- Português brasileiro. Sem markdown. Apenas JSON.`;

    try {
      const aiRes = await callAICerebrasFirst({
        systemMsg: "Você é estrategista político brasileiro sênior. Responda APENAS JSON válido, em português, com dados diferenciados por UF (jamais scores idênticos).",
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 12000,
        temperature: 0.65,
        tag: "regional-ai-analysis",
      });

      let parsed: any = {};
      try { parsed = JSON.parse(aiRes.content || "{}"); }
      catch {
        const m = (aiRes.content || "").match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }

      if (!Array.isArray(parsed.states) || parsed.states.length < 20) {
        throw new Error("AI_INCOMPLETE_STATES");
      }
      if (!Array.isArray(parsed.regions) || parsed.regions.length < 5) {
        throw new Error("AI_INCOMPLETE_REGIONS");
      }

      const statesOut: StateAnalysis[] = UFS.map((uf) => {
        const found = parsed.states.find((x: any) => String(x.uf || "").toUpperCase() === uf);
        if (!found) throw new Error(`AI_MISSING_STATE:${uf}`);
        const temas = Array.isArray(found.temas_sensibilidade) ? found.temas_sensibilidade : [];
        const normTemas = TEMAS.map((t) => {
          const hit = temas.find((x: any) => String(x.tema || "").toLowerCase().includes(t.slice(0, 4)));
          return { tema: t, score: clamp(Number(hit?.score)) };
        });
        const pen = found.penetracao || {};
        return {
          uf,
          region: UF_TO_REGION[uf],
          temperatura: (String(found.temperatura || "").trim() || "Neutra") as any,
          electoral_strength: clamp(Number(found.electoral_strength)),
          rejection_score: clamp(Number(found.rejection_score)),
          perfil_eleitor_dominante: String(found.perfil_eleitor_dominante || "").trim() || "Perfil regional não mapeado",
          temas_sensibilidade: normTemas,
          penetracao: {
            capitais: clamp(Number(pen.capitais)),
            cidades_medias: clamp(Number(pen.cidades_medias)),
            interior: clamp(Number(pen.interior)),
            rural_profundo: clamp(Number(pen.rural_profundo)),
          },
          riscos: Array.isArray(found.riscos) ? found.riscos.slice(0, 4).map((r: any) => ({
            titulo: String(r.titulo || "").trim(),
            severidade: String(r.severidade || "média").toLowerCase(),
          })).filter((r: any) => r.titulo) : [],
          oportunidades: Array.isArray(found.oportunidades)
            ? found.oportunidades.slice(0, 5).map((s: any) => String(s).trim()).filter(Boolean)
            : [],
        };
      });

      // Bloquear scores totalmente genéricos
      const strengths = statesOut.map((s) => s.electoral_strength);
      if (strengths.every((s) => s === strengths[0])) throw new Error("AI_GENERIC_SCORES");

      const regionsOut: RegionSummary[] = REGIONS.map((rg) => {
        const found = parsed.regions.find((x: any) =>
          String(x.region || "").toLowerCase().includes(rg.toLowerCase().slice(0, 4))
        );
        return {
          region: rg,
          temperatura: String(found?.temperatura || "Neutra"),
          regional_strength_score: clamp(Number(found?.regional_strength_score)),
          rejection_score: clamp(Number(found?.rejection_score)),
          percepcao: String(found?.percepcao || "").trim(),
        };
      });

      const nat = parsed.national || {};
      const national: NationalKPIs = {
        forca_nacional: clamp(Number(nat.forca_nacional)),
        melhor_uf: String(nat.melhor_uf || statesOut.reduce((a, b) => a.electoral_strength > b.electoral_strength ? a : b).uf).toUpperCase(),
        uf_risco: String(nat.uf_risco || statesOut.reduce((a, b) => a.rejection_score > b.rejection_score ? a : b).uf).toUpperCase(),
        expansao_potencial: String(nat.expansao_potencial || "").toUpperCase(),
        sintese: String(nat.sintese || "").trim(),
      };

      console.log(`[regional-ai-analysis] ✅ ${aiRes.provider}:${aiRes.model}`);
      return json({
        national,
        regions: regionsOut,
        states: statesOut,
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      const msg = (e as Error).message || "AI_UNAVAILABLE";
      console.error("[regional-ai-analysis] AI failed:", msg);
      return json({
        error: "AI_UNAVAILABLE",
        detail: msg,
        message: "A IA está temporariamente indisponível. Tente novamente em instantes.",
      }, 503);
    }
  } catch (e) {
    console.error("regional-ai-analysis error:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
