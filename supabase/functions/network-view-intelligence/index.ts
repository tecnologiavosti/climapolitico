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
  const { shares: weights, labels, topics: fallbackTopics, terms: fallbackTerms } = profileFromCandidate(name, party, position, state);
  const by_network = labels.map((n, i) => {
    const m = weights[i];
    const posRate = [44, 37, 49, 41, 52, 38, 57, 34][i];
    const negRate = [29, 36, 24, 31, 21, 33, 18, 41][i];
    const neuRate = 100 - posRate - negRate;
    return {
      network: n,
      mentions: m,
      engagement: m * 120,
      likes: m * 80, replies: m * 25, shares: m * 15,
      pos: posRate, neg: negRate, neu: neuRate,
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
  const topicWeights = [31, 24, 18, 13, 8, 6, 5, 4];
  const topics = fallbackTopics.map((label, i) => {
    const mentions = topicWeights[i] ?? Math.max(4, 12 - i);
    const positive = [48, 55, 42, 51, 37, 46, 33, 44][i] ?? 45;
    const pos = Math.max(1, Math.round(mentions * positive / 100));
    const neg = Math.max(1, Math.round(mentions * (100 - positive) / 180));
    const neu = Math.max(1, mentions - pos - neg);
    return { label, topic: label, theme: label, mentions, relevance: mentions, positive, pos, neg, neu };
  });
  const terms = fallbackTerms.filter((term) => !isInvalidLabel(term) && !TERM_BLACKLIST.has(norm(term))).map((term, i) => ({ term, count: 90 - i * 7, kind: "entity" }));
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
  "networks": [
    {"name":"X|News|YouTube|Facebook|Instagram|TikTok|Telegram|Reddit","share":<int 1-45>,"positive":<int 0-100>,"negative":<int 0-100>,"neutral":<int 0-100>}
  ],
  "series": [
    {"day":"YYYY-MM-DD","p":<int>,"n":<int>,"u":<int>}
  ],
  "topics": [
    {"label":"<tema específico>","relevance":<int 1-45>,"positive":<int 0-100>}
  ],
  "terms": [
    "<termo específico>"
  ]
}

Regras OBRIGATÓRIAS:
- networks: 6-8 redes, soma aproximada 100, distribuição NÃO uniforme; diferença mínima de 8 pontos entre a maior e a 3ª rede; reflita o perfil real (ex.: governador tradicional tem News/X altos, TikTok/Reddit baixos). Proibido sequência template 19/17/14/14/14.
- series: ${Math.min(days, 30)} dias terminando hoje (${new Date().toISOString().slice(0,10)}). DEVE ter picos e vales claros associados a eventos plausíveis (entrevistas, declarações, crises). PROIBIDO curva suave/uniforme.
- sentiment: cada rede precisa ter positivo/negativo/neutro claramente diferente; proibido repetir 44/31/25 ou variações de 1 ponto.
- topics: usar OBRIGATORIAMENTE o campo label. 6-8 temas ESPECÍFICOS do candidato — bandeiras, pautas, palcos políticos, região. Exemplo p/ Ronaldo Caiado: "Segurança Pública", "Agronegócio", "Goiás", "Presidência 2026", "União Brasil", "Centro-Oeste". PROIBIDO: "Político", "Política", "Brasil", "Cenário", "Contexto", "Governo" (sozinho), "Notícia", "Notícias", "Candidato", "Eleição/Eleições" (sozinho), "Geral", "—", "-", "", null.
- terms: 10-15 termos REAIS (nomes próprios, entidades, lugares, partidos, aliados/adversários). PROIBIDO: "cenário", "política", "brasil" sozinho, "governo" sozinho, "#—", "#-".

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

    const hasContext = (s: string) => s.trim().split(/\s+/).length >= 2;
    const profile = profileFromCandidate(name, party, position, state);

    const rawNetworks = Array.isArray(parsed.networks) ? parsed.networks : (Array.isArray(parsed.by_network) ? parsed.by_network : []);
    let by_network = rawNetworks
      .map((n: any) => {
        const network = toNetworkKey(n?.name ?? n?.network);
        const share = Number(n?.share ?? n?.mentions ?? 0);
        const pos = Number(n?.positive ?? n?.pos ?? 0);
        const neg = Number(n?.negative ?? n?.neg ?? 0);
        const neu = Number(n?.neutral ?? n?.neu ?? Math.max(0, 100 - pos - neg));
        return { network, mentions: Math.max(1, Math.round(share)), engagement: Math.round(Math.max(1, share) * 137), likes: Math.round(Math.max(1, share) * 83), replies: Math.round(Math.max(1, share) * 31), shares: Math.round(Math.max(1, share) * 23), pos, neg, neu };
      })
      .filter((n: any) => profile.labels.includes(n.network));

    const topShares = [...by_network].sort((a, b) => b.mentions - a.mentions).map((n) => n.mentions);
    const uniform = topShares.length < 6 || (topShares[0] - (topShares[2] ?? topShares[0]) < 8) || (Math.max(...topShares) - Math.min(...topShares) < 14);
    if (uniform) by_network = deterministicFallback(name, party, position, state, days).by_network;

    const rawTopics = Array.isArray(parsed.topics) ? parsed.topics : [];
    const topics = rawTopics
      .map((t: any) => {
        const label = t?.label ?? t?.topic ?? t?.theme ?? null;
        const relevance = Number(t?.relevance ?? t?.mentions ?? 0);
        const positive = Number(t?.positive ?? (t?.pos && relevance ? Math.round((t.pos / relevance) * 100) : 45));
        const pos = Math.max(1, Math.round((relevance || 10) * positive / 100));
        const neg = Math.max(1, Math.round((relevance || 10) * (100 - positive) / 180));
        const neu = Math.max(1, Math.round((relevance || 10) - pos - neg));
        return { label, topic: label, theme: label, mentions: Math.max(1, Math.round(relevance || 10)), pos, neg, neu };
      })
      .filter((t: any) => {
        if (!t || isInvalidLabel(t.label)) return false;
        const n = norm(t.label);
        if (TOPIC_BLACKLIST.has(n)) return false;
        if ((n === "eleicao" || n === "governo") && !hasContext(t.label)) return false;
        return true;
      });

    const rawTerms = Array.isArray(parsed.terms) ? parsed.terms : [];
    const terms = rawTerms.map((t: any, i: number) => typeof t === "string" ? { term: t, count: 100 - i * 6, kind: "entity" } : t).filter((t: any) => {
      if (!t || isInvalidLabel(t.term)) return false;
      const n = norm(t.term);
      if (TERM_BLACKLIST.has(n)) return false;
      if ((n === "eleicao" || n === "governo") && !hasContext(t.term)) return false;
      return true;
    });

    return {
      by_network,
      series: Array.isArray(parsed.series) ? parsed.series : [],
      topics: topics.length ? topics : deterministicFallback(name, party, position, state, days).topics,
      terms: terms.length ? terms : deterministicFallback(name, party, position, state, days).terms,
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
