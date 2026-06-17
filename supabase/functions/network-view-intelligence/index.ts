import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CEREBRAS_MODELS = ["llama-3.3-70b", "qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"];
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE = new Map<string, { ts: number; payload: any }>();

const PERIOD_LABEL = (d: number) =>
  d <= 7 ? "últimos 7 dias" :
  d <= 30 ? "últimos 30 dias" :
  d <= 90 ? "últimos 90 dias" :
  d <= 365 ? "último ano" : "histórico completo";

const TOPIC_BLACKLIST = new Set([
  "", "-", "—", "politico", "politica", "brasil", "noticia", "noticias",
  "candidato", "candidatos", "governo", "eleicao", "eleicoes", "geral",
  "outros", "diversos", "cenario", "contexto", "atuacao politica", "atuacao", "partido",
]);
const TERM_BLACKLIST = new Set([
  "", "-", "—", "politico", "politica", "brasil", "noticia", "noticias",
  "candidato", "governo", "cenario", "contexto", "eleicoes2026",
]);

const norm = (s: string) =>
  String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/^#/, "");
const isInvalidLabel = (s: any) => {
  if (s == null) return true;
  const t = String(s).trim();
  return t === "" || t === "-" || t === "—" || t === "–" || t === "n/a" || /^#?[-—–\s]+$/.test(t);
};

const NETWORK_KEY: Record<string, string> = {
  x: "twitter", twitter: "twitter", "x / twitter": "twitter", news: "google_news", noticias: "google_news",
  notícias: "google_news", google_news: "google_news", "google news": "google_news", youtube: "youtube",
  facebook: "facebook", instagram: "instagram", tiktok: "tiktok", telegram: "telegram", reddit: "reddit",
};

function toNetworkKey(value: any) {
  const k = norm(String(value || "").replace(/_/g, " "));
  return NETWORK_KEY[k] || String(value || "").toLowerCase().trim();
}

function profileFromCandidate(name: string, party: string, position: string, state: string) {
  const full = norm(`${name} ${party} ${position} ${state}`);
  const labels = ["google_news", "twitter", "facebook", "youtube", "instagram", "telegram", "tiktok", "reddit"];
  let shares = [24, 22, 15, 14, 11, 6, 5, 3];
  let topics = [
    `Atuação em ${state && norm(state) !== "brasil" ? state : "âmbito estadual"}`,
    `${party && party !== "—" ? party : "Partido"} e alianças`,
    "Segurança Pública", "Economia e Emprego", "Presidência 2026", "Oposição ao PT",
  ];
  let terms = [name.split(" ")[0], state, party, "Lula", "Bolsonaro"];

  if (full.includes("ronaldo caiado") || full.includes("goias") || full.includes("goias")) {
    shares = [28, 24, 14, 13, 9, 5, 5, 2];
    topics = ["Segurança Pública", "Agronegócio", "Goiás", "Presidência 2026", "União Brasil", "Centro-Oeste", "Oposição ao PT", "Governo de Goiás"];
    terms = ["Caiado", "Goiás", "Agronegócio", "União Brasil", "Centro-Oeste", "Segurança Pública", "Presidência 2026", "Lula", "Bolsonaro"];
  } else if (/governador|prefeito|senador/.test(norm(position))) {
    shares = [27, 23, 15, 13, 10, 5, 5, 2];
  } else if (/presiden/.test(norm(position))) {
    shares = [25, 26, 11, 16, 13, 4, 8, 3];
  } else if (/deputad/.test(norm(position))) {
    shares = [18, 25, 17, 13, 15, 5, 9, 3];
  }
  return { labels, shares, topics, terms };
}

function profileFromPosition(position: string): { weights: number[]; labels: string[] } {
  const p = (position || "").toLowerCase();
  const labels = ["youtube","facebook","tiktok","telegram","twitter","google_news","instagram","reddit"];
  let weights: number[];
  if (/(governador|prefeito|senador)/.test(p)) {
    // tradicional: news/X fortes, TikTok/Reddit baixos
    weights = [18, 22, 6, 4, 24, 28, 14, 2];
  } else if (/(deputad)/.test(p)) {
    weights = [16, 18, 10, 6, 22, 18, 16, 3];
  } else if (/(presiden)/.test(p)) {
    weights = [20, 16, 14, 8, 26, 24, 18, 4];
  } else {
    weights = [15, 15, 12, 6, 20, 18, 15, 3];
  }
  return { weights, labels };
}

function deterministicFallback(name: string, party: string, position: string, state: string, days: number) {
  const { weights, labels } = profileFromPosition(position);
  const by_network = labels.map((n, i) => {
    const m = weights[i];
    return {
      network: n,
      mentions: m,
      engagement: m * 120,
      likes: m * 80, replies: m * 25, shares: m * 15,
      pos: Math.round(m * 0.45), neg: Math.round(m * 0.30), neu: Math.round(m * 0.25),
    };
  });
  const series: any[] = [];
  const today = new Date();
  const pts = Math.min(days, 30);
  for (let i = pts - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    // picos/vales em vez de curva suave
    const peak = (i % 7 === 0) ? 8 : (i % 5 === 0 ? 5 : 0);
    series.push({
      day: d.toISOString().slice(0, 10),
      p: 3 + (i % 4) + peak,
      n: 1 + (i % 3) + Math.round(peak / 2),
      u: 2 + (i % 2),
    });
  }
  const first = (name.split(" ")[0] || "candidato");
  const topics = [
    { topic: `Atuação em ${state || "âmbito estadual"}`, mentions: 35, pos: 16, neg: 12, neu: 7 },
    { topic: `${party || "Partido"} e alianças`, mentions: 28, pos: 14, neg: 8, neu: 6 },
    { topic: "Segurança Pública", mentions: 22, pos: 10, neg: 7, neu: 5 },
    { topic: "Economia e Emprego", mentions: 18, pos: 9, neg: 5, neu: 4 },
    { topic: "Presidência 2026", mentions: 16, pos: 7, neg: 6, neu: 3 },
    { topic: "Oposição ao PT", mentions: 14, pos: 6, neg: 5, neu: 3 },
  ];
  const terms = [
    { term: first, count: 80, kind: "entity" },
    { term: state || "Brasília", count: 45, kind: "entity" },
    { term: party || "Partido", count: 35, kind: "entity" },
    { term: "#" + first.toLowerCase(), count: 30, kind: "hashtag" },
    { term: "Lula", count: 22, kind: "entity" },
    { term: "Bolsonaro", count: 20, kind: "entity" },
  ];
  return { by_network, series, topics, terms, model_used: "deterministic", period: PERIOD_LABEL(days) };
}


async function generateAI(candidate: any, days: number) {
  const periodLabel = PERIOD_LABEL(days);
  const name = candidate?.full_name || "Candidato";
  const party = candidate?.party || "—";
  const position = candidate?.position || "Político";
  const state = candidate?.state || "Brasil";

  const systemMsg = "Você é analista político brasileiro sênior, especialista em mídias sociais e comunicação política. Estime distribuição em redes sociais e temas com base no histórico, posicionamento partidário, perfil eleitoral e contexto político brasileiro real. Responda SEMPRE em JSON válido.";

  const profileHint = (() => {
    const p = (position || "").toLowerCase();
    if (/governador|prefeito|senador/.test(p))
      return "Perfil tradicional: peso alto em google_news e twitter; YouTube/Instagram médios; TikTok/Reddit baixos.";
    if (/presiden/.test(p))
      return "Perfil nacional: twitter e google_news muito fortes; YouTube e Instagram fortes; TikTok médio.";
    if (/deputad/.test(p))
      return "Perfil parlamentar: twitter forte, Instagram e Facebook médios, TikTok crescente.";
    return "Perfil misto, calibrar conforme alcance digital conhecido.";
  })();

  const userPrompt = `Gere análise de presença em redes sociais ESPECÍFICA para este candidato:
- Nome: ${name}
- Cargo: ${position}
- Partido: ${party}
- Estado/Região: ${state}
- Período: ${periodLabel}

Use seu conhecimento real do candidato (base eleitoral, bandeiras, alianças, escândalos, cobertura de imprensa recente, perfil digital, eventos políticos do período). ${profileHint}

Retorne JSON com este schema EXATO:
{
  "by_network": [
    {"network":"youtube|facebook|tiktok|telegram|twitter|google_news|instagram|reddit","mentions":<int>,"engagement":<int>,"likes":<int>,"replies":<int>,"shares":<int>,"pos":<int>,"neg":<int>,"neu":<int>}
  ],
  "series": [
    {"day":"YYYY-MM-DD","p":<int>,"n":<int>,"u":<int>}
  ],
  "topics": [
    {"topic":"<tema específico>","mentions":<int>,"pos":<int>,"neg":<int>,"neu":<int>}
  ],
  "terms": [
    {"term":"<termo ou #hashtag>","count":<int>,"kind":"hashtag|entity"}
  ]
}

Regras OBRIGATÓRIAS:
- by_network: 6-8 redes, distribuição NÃO uniforme; reflita o perfil real (ex.: governador tradicional tem google_news/twitter altos, TikTok/Reddit baixos).
- series: ${Math.min(days, 30)} dias terminando hoje (${new Date().toISOString().slice(0,10)}). DEVE ter picos e vales claros associados a eventos plausíveis (entrevistas, declarações, crises). PROIBIDO curva suave/uniforme.
- topics: 6-8 temas ESPECÍFICOS do candidato — bandeiras, pautas, palcos políticos, região. Exemplo p/ governador de Goiás: "Segurança Pública", "Agronegócio", "Governo de Goiás", "Presidência 2026", "União Brasil", "Centro-Oeste". PROIBIDO: "Político", "Política", "Brasil", "Cenário", "Governo" (sozinho), "Notícia", "Notícias", "Candidato", "Eleição/Eleições" (sozinho), "Geral", "—", "-", "", null.
- terms: 10-15 termos REAIS (nomes próprios, hashtags reais, entidades, lugares, aliados/adversários como "Lula", "Bolsonaro"). PROIBIDO: "cenário", "político", "brasil" sozinho, "#—", "#-", "noticia", "candidato".
- pos+neg+neu: sentimento plausível, NUNCA balanceado.

Se não tiver certeza do tema específico, OMITA — nunca preencha com genérico.`;

  try {
    const res = await callAICerebrasFirst({
      systemMsg,
      userPrompt,
      jsonMode: true,
      maxTokens: 2500,
      temperature: 0.6,
      cerebrasModels: CEREBRAS_MODELS,
      tag: "network-view-ai",
    });
    const parsed = JSON.parse(res.content || "{}");

    // Filter invalid/generic topics and terms
    const TOPIC_BLACKLIST = new Set([
      "politico", "politica", "brasil", "noticia", "noticias",
      "candidato", "candidatos", "governo", "eleicao", "eleicoes",
      "geral", "outros", "diversos", "cenario", "contexto",
      "atuacao politica", "atuacao", "partido",
    ]);
    const TERM_BLACKLIST = new Set([
      "politico", "politica", "brasil", "noticia", "noticias",
      "candidato", "governo", "cenario", "eleicoes2026",
    ]);
    const norm = (s: string) =>
      String(s || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().trim().replace(/^#/, "");
    const isInvalid = (s: any) => {
      if (s == null) return true;
      const t = String(s).trim();
      if (t === "" || t === "-" || t === "—" || t === "–" || t === "n/a") return true;
      if (/^#?[-—–\s]+$/.test(t)) return true;
      return false;
    };
    const hasContext = (s: string) => s.trim().split(/\s+/).length >= 2;

    const rawTopics = Array.isArray(parsed.topics) ? parsed.topics : [];
    const topics = rawTopics
      .map((t: any) => ({ ...t, topic: t?.topic ?? t?.theme ?? null }))
      .filter((t: any) => {
        if (!t || isInvalid(t.topic)) return false;
        const n = norm(t.topic);
        if (TOPIC_BLACKLIST.has(n)) return false;
        if ((n === "eleicao" || n === "governo") && !hasContext(t.topic)) return false;
        return true;
      });

    const rawTerms = Array.isArray(parsed.terms) ? parsed.terms : [];
    const terms = rawTerms.filter((t: any) => {
      if (!t || isInvalid(t.term)) return false;
      const n = norm(t.term);
      if (TERM_BLACKLIST.has(n)) return false;
      if ((n === "eleicao" || n === "governo") && !hasContext(t.term)) return false;
      return true;
    });

    return {
      by_network: Array.isArray(parsed.by_network) ? parsed.by_network : [],
      series: Array.isArray(parsed.series) ? parsed.series : [],
      topics,
      terms,
      model_used: `${res.provider}/${res.model}`,
      period: periodLabel,
    };
  } catch (e) {
    console.error("[network-view-intelligence] AI failed, deterministic fallback:", (e as Error).message);
    return deterministicFallback(name, party, position, state, days);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { candidate_id, network, days = 30 } = await req.json();
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let candidate: any = null;
    if (candidate_id) {
      const { data } = await supa
        .from("candidates")
        .select("id, full_name, party, position, state, region")
        .eq("id", candidate_id)
        .maybeSingle();
      candidate = data;
    }

    const cacheKey = `${candidate_id || "all"}::${network || "all"}::${days}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return new Response(JSON.stringify({ ...cached.payload, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await generateAI(candidate || { full_name: "Cenário agregado" }, days);
    if (payload.model_used !== "deterministic") {
      CACHE.set(cacheKey, { ts: Date.now(), payload });
    }
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[network-view-intelligence] fatal:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
