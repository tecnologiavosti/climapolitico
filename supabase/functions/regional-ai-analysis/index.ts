// Análise Regional — Modo OVERVIEW: IA gera só 5 regiões; 27 estados são calculados por algoritmo.
// Modo STATE_DEEP: IA gera análise profunda de UM estado quando o usuário clica.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { jsonrepair } from "npm:jsonrepair@3.13.1";
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

// Perfil eleitoral simplificado por UF (-1 esquerda ... +1 direita) e profile dominante
const UF_PROFILE: Record<string, { leaning: number; profile: "agro"|"urbano"|"industrial"|"servicos"|"misto"; weight: number }> = {
  AC:{leaning:0.6,profile:"agro",weight:0.4}, AM:{leaning:0.3,profile:"misto",weight:0.6},
  AP:{leaning:0.1,profile:"misto",weight:0.4}, PA:{leaning:0.0,profile:"agro",weight:0.7},
  RO:{leaning:0.7,profile:"agro",weight:0.5}, RR:{leaning:0.6,profile:"agro",weight:0.3}, TO:{leaning:0.4,profile:"agro",weight:0.4},
  AL:{leaning:-0.2,profile:"misto",weight:0.5}, BA:{leaning:-0.5,profile:"misto",weight:0.8},
  CE:{leaning:-0.4,profile:"servicos",weight:0.7}, MA:{leaning:-0.5,profile:"agro",weight:0.6},
  PB:{leaning:-0.3,profile:"misto",weight:0.5}, PE:{leaning:-0.4,profile:"industrial",weight:0.7},
  PI:{leaning:-0.4,profile:"agro",weight:0.5}, RN:{leaning:-0.2,profile:"servicos",weight:0.5}, SE:{leaning:-0.2,profile:"misto",weight:0.4},
  DF:{leaning:0.2,profile:"servicos",weight:0.6}, GO:{leaning:0.6,profile:"agro",weight:0.7},
  MT:{leaning:0.8,profile:"agro",weight:0.7}, MS:{leaning:0.7,profile:"agro",weight:0.6},
  ES:{leaning:0.4,profile:"industrial",weight:0.6}, MG:{leaning:0.2,profile:"misto",weight:0.9},
  RJ:{leaning:0.1,profile:"servicos",weight:0.9}, SP:{leaning:0.3,profile:"industrial",weight:1.0},
  PR:{leaning:0.6,profile:"agro",weight:0.8}, RS:{leaning:0.3,profile:"agro",weight:0.8}, SC:{leaning:0.7,profile:"industrial",weight:0.7},
};

const PARTY_IDEOLOGY: Record<string, number> = {
  PT:-0.8, PSOL:-0.9, PCDOB:-0.8, PDT:-0.4, PSB:-0.4, REDE:-0.3,
  MDB:0.0, PSDB:0.1, PSD:0.1, CIDADANIA:0.0, AGIR:0.1, AVANTE:0.1, SOLIDARIEDADE:0.0,
  UNIAO:0.5, "UNIÃO":0.5, UB:0.5, PP:0.5, REPUBLICANOS:0.6, REP:0.6, PL:0.7,
  NOVO:0.7, PRTB:0.7, PATRIOTA:0.6, PMB:0.3, PODE:0.3, PODEMOS:0.3,
};

const TEMAS = ["agro","seguranca","economia","corrupcao","costumes","saude"] as const;
const SEGMENTOS = ["agro","evangelicos","empresarios","jovens_urbanos","servidores","classe_media"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return processingResponse("Sessão não validada. Atualize a página e tente novamente.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userData?.user?.id;
    if (!userId) return processingResponse("Sessão não validada. Atualize a página e tente novamente.");

    const body = await req.json();
    const { candidate_id, period_label, period_from, period_to, mode = "overview", uf: ufParam } = body || {};
    if (!candidate_id) return processingResponse("Selecione um candidato para gerar a análise regional.");

    const { data: cand } = await admin
      .from("candidates")
      .select("full_name, party, region")
      .eq("id", candidate_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!cand) return processingResponse("Não foi possível localizar o candidato selecionado.");

    const periodText = period_from && period_to ? `${period_from} a ${period_to}` : period_label || "últimos 30 dias";

    // ============ MODE: STATE_DEEP ============
    if (mode === "state_deep") {
      const uf = String(ufParam || "").toUpperCase();
      if (!UFS.includes(uf as any)) return processingResponse("UF inválida.");
      try {
        const deep = await generateStateDeep(cand, periodText, uf);
        return json({ success: true, mode: "state_deep", uf, state: deep, generated_at: new Date().toISOString() });
      } catch (e) {
        return json({ success: false, fallback: true, message: "A análise está sendo processada. Tente novamente em instantes.", detail: (e as Error).message });
      }
    }

    // ============ MODE: OVERVIEW ============
    try {
      const regionsParsed = await callAIJson(regionsPrompt(cand, periodText), "macro_regions", 3200);
      const rawRegions = Array.isArray((regionsParsed as any).regions) ? (regionsParsed as any).regions : [];

      // normaliza regiões (com rescale 0-10 -> 0-100 + diferenciação forçada)
      let regionsOut = REGIONS.map((rg) => {
        const found = rawRegions.find((x: any) => String(x.region || "").toLowerCase().includes(rg.toLowerCase().slice(0, 4)));
        return {
          region: rg,
          regional_strength_score: rescale(Number(found?.regional_strength_score ?? found?.forca ?? 50)),
          rejection_score: rescale(Number(found?.rejection_score ?? found?.rejeicao ?? 35)),
          percepcao: String(found?.percepcao || found?.resumo || "").trim(),
          temperatura: String(found?.temperatura || "").trim(),
        };
      });
      regionsOut = differentiateRegions(regionsOut);

      // calcula 27 estados algoritmicamente
      const statesOut = UFS.map((uf) => computeStateScore(uf, cand, regionsOut));

      // national síntese
      const best = statesOut.reduce((a, b) => a.electoral_strength > b.electoral_strength ? a : b);
      const worst = statesOut.reduce((a, b) => a.rejection_score > b.rejection_score ? a : b);
      const expansion = statesOut
        .filter((s) => s.electoral_strength >= 40 && s.electoral_strength < 65)
        .sort((a, b) => b.electoral_strength - a.electoral_strength)[0];
      const national = {
        forca_nacional: Math.round(statesOut.reduce((a, b) => a + b.electoral_strength, 0) / statesOut.length),
        melhor_uf: best.uf,
        uf_risco: worst.uf,
        expansao_potencial: expansion?.uf || best.uf,
        sintese: `Cenário híbrido: ${cand.full_name} apresenta maior tração em ${best.uf} e maior vulnerabilidade em ${worst.uf}. Potencial real de expansão concentrado em ${expansion?.uf || best.uf}.`,
      };

      return json({
        success: true,
        mode: "overview",
        national,
        regions: regionsOut,
        states: statesOut,
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[regional-ai-analysis] overview AI failed:", (e as Error).message);
      return json({ success: false, fallback: true, message: "A análise está sendo processada. Tente novamente em instantes.", detail: (e as Error).message });
    }
  } catch (e) {
    console.error("regional-ai-analysis error:", (e as Error).message);
    return json({ success: false, fallback: true, message: "A análise está sendo processada. Tente novamente em instantes.", detail: (e as Error).message });
  }
});

// =========================================================
// PROMPTS
// =========================================================
function baseContext(cand: any, periodText: string) {
  return `Você é estrategista político brasileiro sênior. Analise:
- Candidato: ${cand.full_name}
- Partido: ${cand.party || "não informado"}
- Região-base: ${cand.region || "não informada"}
- Período: ${periodText}

REGRAS ANTI-INVENÇÃO (CRÍTICO):
- PROIBIDO percentuais eleitorais específicos sem fonte (ex: "47% em 2022").
- PROIBIDO inventar nº de prefeituras, vereadores, cadeiras ou resultados eleitorais.
- Use linguagem CONTEXTUAL: "historicamente", "tende a", "costuma", "tradicionalmente".
- Sempre que possível, cite NOMES REAIS (Grande SP, ABC, Cariri, semiárido, agro do MT etc).
- PROIBIDO frases genéricas: "perfil agropecuarista", "base partidária local", "oposição organizada", "ampliar presença digital", "aliança com lideranças locais", "conflito com logística de SP", "fragilidade em toda região metropolitana".

Português brasileiro. Sem markdown. Apenas JSON válido.`;
}

function regionsPrompt(cand: any, periodText: string) {
  return `${baseContext(cand, periodText)}

Gere análise das 5 macrorregiões. Cada uma com força (0-100), rejeição (0-100) e percepção (3 frases densas, com clivagens reais).
NÃO classifique todas como "Competitiva". Diferencie usando: Favorável / Competitiva / Hostil / Neutra.
SOMENTE este JSON:
{"regions":[
{"region":"Norte","regional_strength_score":0,"rejection_score":0,"percepcao":"...","temperatura":"Competitiva"},
{"region":"Nordeste","regional_strength_score":0,"rejection_score":0,"percepcao":"...","temperatura":"Hostil"},
{"region":"Centro-Oeste","regional_strength_score":0,"rejection_score":0,"percepcao":"...","temperatura":"Favorável"},
{"region":"Sudeste","regional_strength_score":0,"rejection_score":0,"percepcao":"...","temperatura":"Competitiva"},
{"region":"Sul","regional_strength_score":0,"rejection_score":0,"percepcao":"...","temperatura":"Favorável"}
]}`;
}

async function generateStateDeep(cand: any, periodText: string, uf: string) {
  const region = UF_TO_REGION[uf];
  const prompt = `${baseContext(cand, periodText)}

Análise PROFUNDA do estado ${uf} (região ${region}).
Cite cidades reais, clivagens locais, polos econômicos do ${uf}. Scores 0-100 (não 0-10).

SOMENTE este JSON:
{"perfil_eleitor_dominante":"frase específica com cidades de ${uf} + clivagem ideológica + faixa demográfica",
"dna_eleitoral":[{"tema":"agro","score":0},{"tema":"seguranca","score":0},{"tema":"economia","score":0},{"tema":"corrupcao","score":0},{"tema":"costumes","score":0},{"tema":"saude","score":0}],
"segmentos_voto":[{"segmento":"agro","score":0},{"segmento":"evangelicos","score":0},{"segmento":"empresarios","score":0},{"segmento":"jovens_urbanos","score":0},{"segmento":"servidores","score":0},{"segmento":"classe_media","score":0}],
"penetracao":{"capitais":0,"cidades_medias":0,"interior":0,"rural_profundo":0},
"fragilidade":{"titulo":"título curto","descricao":"contexto específico com cidade/grupo de ${uf}"},
"crescimento":{"titulo":"cidade/microrregião concreta de ${uf}","descricao":"por que há potencial real ali"},
"riscos":[{"titulo":"risco concreto em cidade/ator de ${uf}","severidade":"média"}],
"oportunidades":["ação concreta e específica em ${uf}","outra ação"],
"temas_dominantes":["tema 1 com contexto","tema 2"]}`;

  const parsed = await callAIJson(prompt, `state_deep_${uf}`, 2800);
  const dnaRaw = Array.isArray(parsed.dna_eleitoral) ? parsed.dna_eleitoral : [];
  const segRaw = Array.isArray(parsed.segmentos_voto) ? parsed.segmentos_voto : [];
  const pen = parsed.penetracao || {};
  const fr = parsed.fragilidade || {};
  const cr = parsed.crescimento || {};
  return {
    uf, region,
    perfil_eleitor_dominante: String(parsed.perfil_eleitor_dominante || "").trim(),
    dna_eleitoral: TEMAS.map((t) => {
      const hit = dnaRaw.find((x: any) => String(x.tema || "").toLowerCase().includes(t.slice(0, 4)));
      return { tema: t, score: rescale(Number(hit?.score)) };
    }),
    segmentos_voto: SEGMENTOS.map((s) => {
      const hit = segRaw.find((x: any) => String(x.segmento || "").toLowerCase().includes(s.slice(0, 4)));
      return { segmento: s, score: rescale(Number(hit?.score)) };
    }),
    penetracao: {
      capitais: rescale(Number(pen.capitais)),
      cidades_medias: rescale(Number(pen.cidades_medias)),
      interior: rescale(Number(pen.interior)),
      rural_profundo: rescale(Number(pen.rural_profundo)),
    },
    fragilidade: { titulo: String(fr.titulo || "").trim(), descricao: String(fr.descricao || "").trim() },
    crescimento: { titulo: String(cr.titulo || "").trim(), descricao: String(cr.descricao || "").trim() },
    riscos: Array.isArray(parsed.riscos) ? parsed.riscos.slice(0, 4).map((r: any) => ({
      titulo: String(r.titulo || "").trim(),
      severidade: String(r.severidade || "média").toLowerCase(),
    })).filter((r: any) => r.titulo) : [],
    oportunidades: Array.isArray(parsed.oportunidades)
      ? parsed.oportunidades.slice(0, 5).map((s: any) => String(s).trim()).filter(Boolean) : [],
    temas_dominantes: Array.isArray(parsed.temas_dominantes)
      ? parsed.temas_dominantes.slice(0, 5).map((s: any) => String(s).trim()).filter(Boolean) : [],
  };
}

// =========================================================
// ALGORITMO ESTADUAL
// =========================================================
function computeStateScore(uf: string, cand: any, regions: { region: Region; regional_strength_score: number; rejection_score: number }[]) {
  const region = UF_TO_REGION[uf];
  const reg = regions.find((r) => r.region === region)!;
  const prof = UF_PROFILE[uf];
  const candIdeo = ideologyOf(cand.party);
  const candRegion = String(cand.region || "").trim();

  // 1) afinidade regional (0-100)
  const region_affinity = reg.regional_strength_score;

  // 2) ideológica: quanto menor a distância, melhor
  const ideoDist = Math.abs(prof.leaning - candIdeo); // 0..2
  const ideological_fit = clamp(100 - ideoDist * 45);

  // 3) econômica: agro+agro casa bem; etc.
  const candProfile = profileOf(cand.party);
  const economic_fit = prof.profile === candProfile ? 80 : (prof.profile === "misto" ? 60 : 50);

  // 4) digital — depende do peso/urbanização da UF
  const digital_presence = clamp(40 + prof.weight * 40);

  // 5) força local — bônus se UF estiver na região-base do candidato
  const sameRegion = candRegion && (candRegion.toLowerCase().includes(region.toLowerCase()) || candRegion.toUpperCase() === uf);
  const local_strength = sameRegion ? 85 : 45;

  const electoral_strength = clamp(
    0.30 * region_affinity +
    0.25 * ideological_fit +
    0.20 * economic_fit +
    0.15 * digital_presence +
    0.10 * local_strength
  );

  // rejeição: regional + atrito ideológico
  const rejection_score = clamp(
    0.55 * reg.rejection_score +
    0.30 * (ideoDist * 50) +
    0.15 * (100 - digital_presence)
  );

  const temperatura =
    electoral_strength >= 65 ? "Favorável" :
    electoral_strength >= 40 ? "Competitiva" : "Desfavorável";

  return { uf, region, electoral_strength, rejection_score, temperatura };
}

function ideologyOf(party?: string | null): number {
  const k = String(party || "").toUpperCase().trim().replace(/[^A-ZÀ-Ú]/g, "");
  if (PARTY_IDEOLOGY[k] !== undefined) return PARTY_IDEOLOGY[k];
  return 0;
}
function profileOf(_party?: string | null): "agro"|"urbano"|"industrial"|"servicos"|"misto" {
  return "misto";
}

// =========================================================
// HELPERS
// =========================================================
function differentiateRegions(regions: { region: Region; regional_strength_score: number; rejection_score: number; temperatura: string; percepcao: string }[]) {
  // Se todas iguais ou todas "Competitiva", força diferenciação por strength/rejection
  return regions.map((r) => {
    const s = r.regional_strength_score;
    const rej = r.rejection_score;
    let temp = r.temperatura;
    if (!temp || temp.toLowerCase() === "competitiva") {
      if (s >= 60 && rej < 45) temp = "Favorável";
      else if (rej >= 55) temp = "Hostil";
      else if (s < 35) temp = "Hostil";
      else temp = "Competitiva";
    }
    return { ...r, temperatura: temp };
  });
}

function rescale(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Se IA respondeu em escala 0-10, multiplica por 10
  if (n > 0 && n <= 10) n = n * 10;
  return clamp(n);
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function callAIJson(userPrompt: string, tag: string, maxTokens: number): Promise<any> {
  const aiRes = await callAICerebrasFirst({
    systemMsg: "Você é estrategista político brasileiro sênior. Responda APENAS JSON válido em português brasileiro. Não invente estatísticas ou resultados eleitorais; use linguagem contextual.",
    userPrompt,
    jsonMode: true,
    maxTokens,
    temperature: 0.45,
    cerebrasModels: ["llama-3.3-70b", "qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"],
    tag: `regional-ai-analysis:${tag}`,
  });
  try {
    return parseAIJson(aiRes.content || "{}");
  } catch (e) {
    console.error(`[regional-ai-analysis] JSON parse failed in ${tag}:`, (e as Error).message);
    throw e;
  }
}

function parseAIJson(raw: string): any {
  const source = String(raw || "").trim();
  if (!source) throw new Error("AI_EMPTY_JSON");
  const cleaned = source
    .replace(/^```(?:json|jsonc|javascript|js)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  const candidate = extractJsonBlock(cleaned);
  for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, "$1")]) {
    try { return JSON.parse(attempt); } catch { /* try repair */ }
  }
  return JSON.parse(jsonrepair(candidate));
}

function extractJsonBlock(text: string): string {
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  const starts = [firstObject, firstArray].filter((n) => n >= 0);
  if (!starts.length) throw new Error("AI_NO_JSON_BLOCK");
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) throw new Error("AI_JSON_BLOCK_INCOMPLETE");
  return text.slice(start, end + 1).trim();
}

function processingResponse(detail: string) {
  return json({ success: false, fallback: true, message: "A análise está sendo processada. Tente novamente em instantes.", detail });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
