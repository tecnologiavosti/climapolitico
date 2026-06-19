// Análise Regional 100% IA — Híbrida (Região + Estado) com DNA eleitoral, segmentos, fragilidade e crescimento
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

const TEMAS = ["agro","seguranca","economia","corrupcao","costumes","saude"] as const;
const SEGMENTOS = ["agro","evangelicos","empresarios","jovens_urbanos","servidores","classe_media"] as const;

interface StateAnalysis {
  uf: string;
  region: Region;
  temperatura: string;
  electoral_strength: number;
  rejection_score: number;
  perfil_eleitor_dominante: string;
  dna_eleitoral: { tema: string; score: number }[];
  segmentos_voto: { segmento: string; score: number }[];
  penetracao: { capitais: number; cidades_medias: number; interior: number; rural_profundo: number };
  fragilidade: { titulo: string; descricao: string };
  crescimento: { titulo: string; descricao: string };
  riscos: { titulo: string; severidade: string }[];
  oportunidades: string[];
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

    const { data: cand } = await admin
      .from("candidates")
      .select("full_name, party, region")
      .eq("id", candidate_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!cand) return json({ error: "candidate not found" }, 404);

    const periodText = period_from && period_to
      ? `${period_from} a ${period_to}`
      : period_label || "últimos 30 dias";

    const prompt = `Você é um estrategista político brasileiro sênior. Faça uma análise híbrida (5 macrorregiões + 27 UFs) do candidato abaixo.

CANDIDATO:
- Nome: ${cand.full_name}
- Partido: ${cand.party || "não informado"}
- Região-base: ${cand.region || "não informada"}
PERÍODO: ${periodText}

REGRAS ANTI-INVENÇÃO (CRÍTICO):
- PROIBIDO citar percentuais eleitorais específicos sem fonte (ex: "47% em 2022", "ganhou com 53%").
- PROIBIDO inventar número de prefeituras, vereadores ou cadeiras.
- PROIBIDO inventar resultados de eleição específicos.
- Se NÃO houver dado verificável, use linguagem CONTEXTUAL: "historicamente", "tende a", "costuma", "tradicionalmente", "perfil que costuma rejeitar/apoiar".
- Sempre que possível, cite NOMES REAIS de cidades, regiões metropolitanas, polos econômicos ou clivagens (ex: "Grande SP", "ABC", "Cariri-CE", "semiárido baiano", "agronegócio do MT").

PROIBIDO frases genéricas como "perfil agropecuarista", "base partidária local", "oposição organizada", "ampliar presença digital", "aliança com lideranças locais".

OBRIGATÓRIO por estado:
- "perfil_eleitor_dominante": frase específica com cidades + clivagem ideológica + faixa demográfica.
- "fragilidade": maior vulnerabilidade eleitoral do candidato naquele estado (com contexto).
- "crescimento": cidade/região concreta com potencial real de expansão (e por quê).
- Scores diferenciados por UF (jamais 50/50/50 em todos).

Responda APENAS JSON válido neste formato:

{
  "national": {
    "forca_nacional": 0,
    "melhor_uf": "SP",
    "uf_risco": "BA",
    "expansao_potencial": "MG",
    "sintese": "Síntese estratégica em 3-4 frases citando estados e clivagens."
  },
  "regions": [
    {"region":"Norte","temperatura":"Competitiva","regional_strength_score":0,"rejection_score":0,"percepcao":"3-4 frases densas citando estados, polos e clivagens reais"}
  ],
  "states": [
    {
      "uf":"SP",
      "temperatura":"Favorável|Competitiva|Hostil|Neutra",
      "electoral_strength":0,
      "rejection_score":0,
      "perfil_eleitor_dominante":"frase específica com cidade/região e clivagem",
      "dna_eleitoral":[
        {"tema":"agro","score":0},
        {"tema":"seguranca","score":0},
        {"tema":"economia","score":0},
        {"tema":"corrupcao","score":0},
        {"tema":"costumes","score":0},
        {"tema":"saude","score":0}
      ],
      "segmentos_voto":[
        {"segmento":"agro","score":0},
        {"segmento":"evangelicos","score":0},
        {"segmento":"empresarios","score":0},
        {"segmento":"jovens_urbanos","score":0},
        {"segmento":"servidores","score":0},
        {"segmento":"classe_media","score":0}
      ],
      "penetracao":{"capitais":0,"cidades_medias":0,"interior":0,"rural_profundo":0},
      "fragilidade":{"titulo":"título curto da vulnerabilidade","descricao":"contexto específico com cidade/grupo"},
      "crescimento":{"titulo":"cidade ou microrregião concreta","descricao":"por que há potencial real de expansão ali"},
      "riscos":[{"titulo":"risco concreto com cidade/ator","severidade":"média"}],
      "oportunidades":["ação concreta e específica","outra ação concreta"]
    }
  ]
}

REGRAS:
- "regions": EXATAMENTE 5 (${REGIONS.join(", ")}).
- "states": EXATAMENTE 27 (${UFS.join(", ")}).
- "dna_eleitoral": sempre os 6 temas ${TEMAS.join(", ")}.
- "segmentos_voto": sempre os 6 segmentos ${SEGMENTOS.join(", ")}.
- Português brasileiro. Sem markdown. Apenas JSON.`;

    try {
      const aiRes = await callAICerebrasFirst({
        systemMsg: "Você é estrategista político brasileiro sênior. Responda APENAS JSON válido, em português, com dados diferenciados por UF (jamais scores idênticos). Nunca invente percentuais eleitorais ou estatísticas sem fonte — use linguagem contextual.",
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 14000,
        temperature: 0.65,
        tag: "regional-ai-analysis",
      });

      let parsed: any = {};
      try { parsed = JSON.parse(aiRes.content || "{}"); }
      catch {
        const m = (aiRes.content || "").match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }

      if (!Array.isArray(parsed.states) || parsed.states.length < 20) throw new Error("AI_INCOMPLETE_STATES");
      if (!Array.isArray(parsed.regions) || parsed.regions.length < 5) throw new Error("AI_INCOMPLETE_REGIONS");

      const statesOut: StateAnalysis[] = UFS.map((uf) => {
        const found = parsed.states.find((x: any) => String(x.uf || "").toUpperCase() === uf);
        if (!found) throw new Error(`AI_MISSING_STATE:${uf}`);
        const dnaRaw = Array.isArray(found.dna_eleitoral) ? found.dna_eleitoral
          : (Array.isArray(found.temas_sensibilidade) ? found.temas_sensibilidade : []);
        const dna = TEMAS.map((t) => {
          const hit = dnaRaw.find((x: any) => String(x.tema || "").toLowerCase().includes(t.slice(0, 4)));
          return { tema: t, score: clamp(Number(hit?.score)) };
        });
        const segRaw = Array.isArray(found.segmentos_voto) ? found.segmentos_voto : [];
        const segs = SEGMENTOS.map((s) => {
          const hit = segRaw.find((x: any) => String(x.segmento || "").toLowerCase().includes(s.slice(0, 4)));
          return { segmento: s, score: clamp(Number(hit?.score)) };
        });
        const pen = found.penetracao || {};
        const fr = found.fragilidade || {};
        const cr = found.crescimento || {};
        return {
          uf,
          region: UF_TO_REGION[uf],
          temperatura: (String(found.temperatura || "").trim() || "Neutra"),
          electoral_strength: clamp(Number(found.electoral_strength)),
          rejection_score: clamp(Number(found.rejection_score)),
          perfil_eleitor_dominante: String(found.perfil_eleitor_dominante || "").trim() || "Perfil regional não mapeado",
          dna_eleitoral: dna,
          segmentos_voto: segs,
          penetracao: {
            capitais: clamp(Number(pen.capitais)),
            cidades_medias: clamp(Number(pen.cidades_medias)),
            interior: clamp(Number(pen.interior)),
            rural_profundo: clamp(Number(pen.rural_profundo)),
          },
          fragilidade: {
            titulo: String(fr.titulo || "").trim() || "Vulnerabilidade não mapeada",
            descricao: String(fr.descricao || "").trim(),
          },
          crescimento: {
            titulo: String(cr.titulo || "").trim() || "Potencial não mapeado",
            descricao: String(cr.descricao || "").trim(),
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

      const strengths = statesOut.map((s) => s.electoral_strength);
      if (strengths.every((s) => s === strengths[0])) throw new Error("AI_GENERIC_SCORES");

      const regionsOut = REGIONS.map((rg) => {
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
      const national = {
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
