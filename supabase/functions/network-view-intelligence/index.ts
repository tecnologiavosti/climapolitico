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

function deterministicFallback(name: string, party: string, position: string, state: string, days: number) {
  const nets = ["youtube","facebook","tiktok","telegram","twitter","google_news","instagram","reddit"];
  const base = [22, 18, 14, 8, 16, 12, 7, 3];
  const by_network = nets.map((n, i) => {
    const m = base[i];
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
    series.push({ day: d.toISOString().slice(0, 10), p: 3 + (i % 4), n: 1 + (i % 3), u: 2 + (i % 2) });
  }
  const topics = [
    { theme: "Eleições 2026", mentions: 35, pos: 16, neg: 12, neu: 7 },
    { theme: position || "Atuação política", mentions: 28, pos: 14, neg: 8, neu: 6 },
    { theme: party || "Partido", mentions: 22, pos: 10, neg: 7, neu: 5 },
    { theme: state || "Atuação regional", mentions: 18, pos: 9, neg: 5, neu: 4 },
  ];
  const terms = [
    { term: name.split(" ")[0] || "candidato", count: 80, kind: "entity" },
    { term: "#" + (party || "politica").toLowerCase().replace(/\s+/g, ""), count: 45, kind: "hashtag" },
    { term: state || "brasil", count: 30, kind: "entity" },
    { term: "eleicoes2026", count: 25, kind: "entity" },
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

  const userPrompt = `Gere análise de presença em redes sociais para:
- Nome: ${name}
- Cargo: ${position}
- Partido: ${party}
- Estado/Região: ${state}
- Período: ${periodLabel}

Use seu conhecimento do contexto político brasileiro (histórico de campanha, alianças, base eleitoral, eventos públicos, cobertura de imprensa, perfil digital). Mesmo com dados escassos, infira a distribuição plausível.

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

Regras:
- by_network: 6-8 redes, valores proporcionais à força real do candidato em cada plataforma.
- series: ${Math.min(days, 30)} dias terminando hoje (${new Date().toISOString().slice(0,10)}), com variação realista.
- topics: 6-8 temas ESPECÍFICOS ao candidato (ex.: "Segurança Pública", "Agronegócio", "Oposição ao PT", "Presidência 2026", o estado dele). PROIBIDO: "Político", "Brasil", "Notícia", "Candidato", "Governo", "Eleição", "-", "—", vazio.
- terms: 10-15 termos específicos (hashtags e entidades). Evite genéricos como "político", "brasil", "notícia", "candidato".
- pos+neg+neu deve refletir sentimento plausível (não sempre balanceado).`;

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
      "geral", "outros", "diversos",
    ]);
    const TERM_BLACKLIST = new Set([
      "politico", "politica", "brasil", "noticia", "noticias",
      "candidato", "governo",
    ]);
    const norm = (s: string) =>
      String(s || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().trim().replace(/^#/, "");
    const isInvalid = (s: any) => {
      if (s == null) return true;
      const t = String(s).trim();
      return t === "" || t === "-" || t === "—" || t === "–" || t === "n/a";
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
