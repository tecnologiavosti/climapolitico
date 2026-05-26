// Análise Histórica Narrativa IA — período atual vs equivalente anterior.
// Enriquecimento automático com GDELT (histórico) quando não há dados internos.
// Body: { candidateId, startDate, endDate }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ymd(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const THEME_MAP: Record<string, RegExp> = {
  "Economia": /(economia|emprego|inflação|inflacao|preço|preco|renda|salário|salario|juros|pib|custo de vida|dólar|dolar|mercado|desemprego|recessão|recessao)/i,
  "Segurança": /(segurança|seguranca|crime|violência|violencia|polícia|policia|tráfico|trafico|assalto|homicídio|homicidio|bandido|milícia|milicia)/i,
  "Saúde": /(saúde|saude|hospital|sus|médico|medico|vacina|remédio|remedio|enfermaria|pandemia|covid)/i,
  "Educação": /(educação|educacao|escola|professor|aluno|ensino|universidade|enem|creche)/i,
  "Corrupção": /(corrupção|corrupcao|propina|desvio|fraude|rachadinha|lava jato|lavajato|mensalão|mensalao|petrolão|petrolao)/i,
  "Impeachment": /(impeachment|impedimento|afastamento|cassação|cassacao)/i,
  "Tributação": /(imposto|tributo|taxa|arrecadação|arrecadacao|reforma tributária|tributaria)/i,
  "Meio ambiente": /(meio ambiente|amazônia|amazonia|clima|desmatamento|queimada|enchente|sustentabilidade)/i,
  "Programas sociais": /(bolsa família|bolsa familia|auxílio|auxilio|benefício|beneficio|pobreza|fome|cadúnico|cadunico|minha casa)/i,
  "Eleições": /(eleição|eleicao|eleições|eleicoes|campanha|urna|tse|voto|candidatura|debate eleitoral)/i,
  "Infraestrutura": /(estrada|asfalto|obra|saneamento|transporte|metrô|metro|ônibus|onibus|aeroporto)/i,
  "Política externa": /(eua|china|mercosul|otan|política externa|politica externa|argentina|venezuela)/i,
  "Direitos sociais": /(direitos|minoria|lgbt|negros|indígena|indigena|mulher|feminismo|racismo)/i,
  "Justiça": /(stf|justiça|justica|supremo|judiciário|judiciario|moraes|operação|operacao)/i,
  "Manifestações": /(manifestação|manifestacao|protesto|passeata|ato público|ato publico|panelaço|panelaco|paralisação|paralisacao|greve)/i,
  "Crise política": /(crise política|crise politica|governo enfraquecido|instabilidade|escândalo|escandalo)/i,
  "Petrobras": /(petrobras|petrolão|petrolao|combustível|combustivel|gasolina|diesel)/i,
};

// Lexicons para sentimento heurístico em títulos/textos (quando o registro não vem rotulado)
const POS_LEX = /(elogiad|aprovad|cresce|vitória|vitoria|conquista|melhora|positiv|sucesso|recorde positivo|avanço|avanco|apoio|popularidade em alta)/i;
const NEG_LEX = /(critica|negativ|piora|cai|crise|escândalo|escandalo|denunci|investigad|prisão|prisao|impeachment|recessão|recessao|protesto|rejeição|rejeicao|reprovação|reprovacao|polêmica|polemica|fraude|corrupção|corrupcao|derrota|fracasso|polarização|polarizacao)/i;

function detectThemes(text: string): string[] {
  const t = (text || "").toLowerCase();
  const themes: string[] = [];
  for (const [k, re] of Object.entries(THEME_MAP)) if (re.test(t)) themes.push(k);
  return themes;
}

function inferSentiment(text: string): "pos" | "neg" | "neu" | null {
  const t = (text || "").toLowerCase();
  const pos = POS_LEX.test(t);
  const neg = NEG_LEX.test(t);
  if (pos && !neg) return "pos";
  if (neg && !pos) return "neg";
  if (pos && neg) return "neu";
  return null; // desconhecido — não inventar
}

const STOPWORDS = new Set([
  "a","o","as","os","um","uma","de","do","da","dos","das","e","ou","mas","que","se","no","na","nos","nas",
  "em","por","para","com","sem","ao","aos","à","às","é","são","ser","ter","tem","têm","tinha","foi",
  "como","mais","menos","muito","muita","pouco","ja","já","não","nao","sim","quando","onde","quem","qual",
  "isso","isto","aquilo","esse","essa","este","esta","aquele","aquela","ele","ela","eles","elas","eu","tu",
  "você","voce","vocês","voces","nós","nos","seu","sua","seus","suas","meu","minha","teu","tua","pelo","pela",
  "vai","vou","vamos","ir","fazer","ficar","ficou","tá","ta","pra","pro","aí","ai","lá","la","aqui","então","entao",
  "só","so","tudo","nada","todos","todas","alguém","alguem","ninguém","ninguem","cada","outro","outra","mesmo",
  "também","tambem","sobre","entre","após","apos","antes","depois","contra","https","http","www","com","br",
  "diz","disse","afirma","afirmou","segundo","afirmar","ainda","agora","hoje","ontem","amanhã","amanha",
]);

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9áàâãéèêíïóôõöúçñ\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function extractPhrases(texts: string[], maxPhrases = 20): { phrase: string; count: number }[] {
  const bi: Record<string, number> = {};
  const tri: Record<string, number> = {};
  for (const t of texts) {
    const tokens = tokenize(t);
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i], b = tokens[i + 1];
      if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
      bi[`${a} ${b}`] = (bi[`${a} ${b}`] || 0) + 1;
      if (i < tokens.length - 2) {
        const c = tokens[i + 2];
        if (!STOPWORDS.has(c)) tri[`${a} ${b} ${c}`] = (tri[`${a} ${b} ${c}`] || 0) + 1;
      }
    }
  }
  const all = [
    ...Object.entries(tri).map(([phrase, count]) => ({ phrase, count, w: count * 1.5 })),
    ...Object.entries(bi).map(([phrase, count]) => ({ phrase, count, w: count })),
  ];
  return all.filter((p) => p.count >= 2).sort((a, b) => b.w - a.w).slice(0, maxPhrases).map(({ phrase, count }) => ({ phrase, count }));
}

function extractWords(texts: string[], maxWords = 20): { word: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const t of texts) for (const w of tokenize(t)) counts[w] = (counts[w] || 0) + 1;
  return Object.entries(counts).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, maxWords).map(([word, count]) => ({ word, count }));
}

interface InteractionRow {
  created_at: string;
  social_network?: string | null;
  interaction_type?: string | null;
  comment_text?: string | null;
  sentiment_label?: string | null;
  sentiment_score?: number | null;
  region?: string | null;
  state?: string | null;
  author_username?: string | null;
}

interface HistRow {
  date: string; mentions: number; sentiment_positive: number; sentiment_negative: number; sentiment_neutral: number;
  themes?: string[] | null; region?: string | null;
}

function sentimentBucket(label?: string | null): "pos" | "neg" | "neu" | null {
  const l = (label || "").toLowerCase();
  if (l.includes("positiv") || l === "pos") return "pos";
  if (l.includes("negativ") || l === "neg") return "neg";
  if (l.includes("neutr") || l === "neu") return "neu";
  return null;
}

// ---------- GDELT histórico ----------
function gdeltStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function parseGdeltDate(s: string): string {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function fetchGdeltHistorical(fullName: string, start: Date, end: Date, maxRecords = 250): Promise<InteractionRow[]> {
  try {
    const q = `"${fullName}" sourcelang:Portuguese sourcecountry:BR`;
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${maxRecords}&format=JSON&startdatetime=${gdeltStamp(start)}&enddatetime=${gdeltStamp(end)}&sort=DateDesc`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`[GDELT-hist] HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    const articles = Array.isArray(json?.articles) ? json.articles : [];
    return articles
      .filter((a: any) => a?.title && a?.url)
      .map((a: any) => {
        const text = String(a.title);
        const sb = inferSentiment(text);
        return {
          created_at: parseGdeltDate(a.seendate),
          social_network: "GDELT",
          interaction_type: "news",
          comment_text: text,
          sentiment_label: sb === "pos" ? "Positivo" : sb === "neg" ? "Negativo" : sb === "neu" ? "Neutro" : null,
          sentiment_score: null,
          region: null,
          state: null,
          author_username: a.domain || null,
        } as InteractionRow;
      });
  } catch (e) {
    console.warn(`[GDELT-hist] erro: ${(e as Error).message}`);
    return [];
  }
}

// ---------- Agregação ----------
function aggregatePeriod(label: string, interactions: InteractionRow[], hist: HistRow[], events: any[]) {
  let pos = 0, neg = 0, neu = 0;
  const themeMentions: Record<string, number> = {};
  const themeSent: Record<string, { pos: number; neg: number; neu: number }> = {};
  const regions: Record<string, { mentions: number; pos: number; neg: number }> = {};
  const dailyMentions: Record<string, number> = {};

  for (const h of hist) {
    pos += Number(h.sentiment_positive || 0);
    neg += Number(h.sentiment_negative || 0);
    neu += Number(h.sentiment_neutral || 0);
    dailyMentions[h.date] = (dailyMentions[h.date] || 0) + Number(h.mentions || 0);
    for (const t of (h.themes || [])) themeMentions[t] = (themeMentions[t] || 0) + Number(h.mentions || 0);
  }

  for (const i of interactions) {
    // Tenta label explícito; se ausente, inferir via lexicon do texto
    let bucket = sentimentBucket(i.sentiment_label);
    if (!bucket) bucket = inferSentiment(i.comment_text || "");
    if (bucket === "pos") pos++;
    else if (bucket === "neg") neg++;
    else if (bucket === "neu") neu++;
    const d = ymd(new Date(i.created_at));
    dailyMentions[d] = (dailyMentions[d] || 0) + 1;
    const themes = detectThemes(i.comment_text || "");
    for (const t of themes) {
      themeMentions[t] = (themeMentions[t] || 0) + 1;
      const ts = themeSent[t] || { pos: 0, neg: 0, neu: 0 };
      if (bucket) ts[bucket]++;
      themeSent[t] = ts;
    }
    const r = i.region || i.state;
    if (r) {
      const rb = regions[r] || { mentions: 0, pos: 0, neg: 0 };
      rb.mentions++;
      if (bucket === "pos") rb.pos++;
      else if (bucket === "neg") rb.neg++;
      regions[r] = rb;
    }
  }

  const total = pos + neg + neu;
  const totalMentions = interactions.length + hist.reduce((s, h) => s + Number(h.mentions || 0), 0);
  const sentimentScore = total > 0 ? (pos - neg) / total : 0;

  const themes = Object.entries(themeMentions).map(([theme, mentions]) => {
    const s = themeSent[theme] || { pos: 0, neg: 0, neu: 0 };
    const tot = s.pos + s.neg + s.neu;
    return {
      theme, mentions,
      sentPosPct: tot ? Math.round((s.pos / tot) * 100) : 0,
      sentNegPct: tot ? Math.round((s.neg / tot) * 100) : 0,
      sentNeuPct: tot ? Math.round((s.neu / tot) * 100) : 0,
    };
  }).sort((a, b) => b.mentions - a.mentions);

  const topRegions = Object.entries(regions).map(([region, b]) => ({
    region, mentions: b.mentions,
    sentiment: b.mentions ? Math.round(((b.pos - b.neg) / b.mentions) * 100) : 0,
  })).sort((a, b) => b.mentions - a.mentions).slice(0, 8);

  return {
    label,
    totalMentions,
    pos, neg, neu,
    sentimentScore,
    sentPosPct: total ? Math.round((pos / total) * 100) : 0,
    sentNegPct: total ? Math.round((neg / total) * 100) : 0,
    sentNeuPct: total ? Math.round((neu / total) * 100) : 0,
    themes,
    topRegions,
    dailyMentions,
    eventsCount: events.length,
  };
}

function climateLevel(score: number, totalMentions: number): { level: string; emoji: string } {
  if (totalMentions === 0) return { level: "Sem dados suficientes", emoji: "❔" };
  if (score >= 0.35) return { level: "Muito favorável", emoji: "😀" };
  if (score >= 0.1) return { level: "Favorável", emoji: "🙂" };
  if (score >= -0.1) return { level: "Equilibrado", emoji: "😐" };
  if (score >= -0.35) return { level: "Desfavorável", emoji: "🙁" };
  return { level: "Muito desfavorável", emoji: "😡" };
}

function deltaPct(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

function detectGroups(interactions: InteractionRow[]) {
  const groups: { group: string; mentions: number; theme: string | null; sentiment: number }[] = [];
  const bucketOf = (i: InteractionRow) => sentimentBucket(i.sentiment_label) ?? inferSentiment(i.comment_text || "");
  const supporters = interactions.filter((i) => bucketOf(i) === "pos");
  const critics = interactions.filter((i) => bucketOf(i) === "neg");

  const dominantTheme = (arr: InteractionRow[]) => {
    const c: Record<string, number> = {};
    for (const i of arr) for (const t of detectThemes(i.comment_text || "")) c[t] = (c[t] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  if (supporters.length) groups.push({ group: "Apoiadores", mentions: supporters.length, theme: dominantTheme(supporters), sentiment: 1 });
  if (critics.length) groups.push({ group: "Críticos", mentions: critics.length, theme: dominantTheme(critics), sentiment: -1 });

  const regCount: Record<string, InteractionRow[]> = {};
  for (const i of interactions) {
    const r = i.region || i.state;
    if (!r) continue;
    (regCount[r] = regCount[r] || []).push(i);
  }
  const topReg = Object.entries(regCount).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  for (const [r, arr] of topReg) {
    const p = arr.filter((i) => bucketOf(i) === "pos").length;
    const n = arr.filter((i) => bucketOf(i) === "neg").length;
    groups.push({
      group: `Região: ${r}`,
      mentions: arr.length,
      theme: dominantTheme(arr),
      sentiment: arr.length ? (p - n) / arr.length : 0,
    });
  }
  return groups;
}

function detectEventsImpact(events: any[], interactions: InteractionRow[]) {
  return events.slice(0, 8).map((ev) => {
    const t = new Date(ev.event_date).getTime();
    const before: InteractionRow[] = [];
    const after: InteractionRow[] = [];
    for (const i of interactions) {
      const it = new Date(i.created_at).getTime();
      if (it >= t - 7 * 86400000 && it < t) before.push(i);
      else if (it >= t && it <= t + 7 * 86400000) after.push(i);
    }
    const score = (arr: InteractionRow[]) => {
      let p = 0, n = 0;
      for (const i of arr) {
        const b = sentimentBucket(i.sentiment_label) ?? inferSentiment(i.comment_text || "");
        if (b === "pos") p++; else if (b === "neg") n++;
      }
      const tot = arr.length || 1;
      return { mentions: arr.length, sentPct: Math.round(((p - n) / tot) * 100) };
    };
    const b = score(before);
    const a = score(after);
    return {
      name: ev.event_name,
      date: (ev.event_date || "").slice(0, 10),
      type: ev.event_type || "evento",
      description: ev.description || null,
      mentionsBefore: b.mentions,
      mentionsAfter: a.mentions,
      mentionsDelta: a.mentions - b.mentions,
      sentimentBefore: b.sentPct,
      sentimentAfter: a.sentPct,
      sentimentDelta: a.sentPct - b.sentPct,
    };
  });
}

function buildSmartTimeline(dailyMentions: Record<string, number>, events: any[], interactions: InteractionRow[]) {
  const values = Object.values(dailyMentions);
  const avg = values.length ? values.reduce((s, n) => s + n, 0) / values.length : 0;
  const peaks = Object.entries(dailyMentions)
    .filter(([, v]) => v > avg * 1.8 && v >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([date, v]) => ({ date, type: "spike" as const, label: `Pico de menções (${v})`, mentions: v }));

  const evtItems = events.map((e: any) => ({
    date: (e.event_date || "").slice(0, 10),
    type: "event" as const,
    label: e.event_name,
    description: e.description || null,
  }));

  return [...evtItems, ...peaks].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// ---------- Local fallback honesto (sem inventar dados) ----------
function buildLocalAnalysis(curr: any, prev: any, candidate: string, dataNote: string): any {
  const climate = climateLevel(curr.sentimentScore, curr.totalMentions);
  const earlyMain = prev.themes[0]?.theme || null;
  const lateMain = curr.themes[0]?.theme || null;
  const delta = curr.totalMentions - prev.totalMentions;
  const direction = delta > 0 ? `aumento de ${delta} menções` : delta < 0 ? `queda de ${Math.abs(delta)} menções` : "volume estável";

  if (curr.totalMentions === 0) {
    return {
      popularClimate: {
        level: "Sem dados suficientes",
        narrative: `Não foram encontrados registros públicos sobre ${candidate} no período selecionado, mesmo após busca em fontes históricas externas (GDELT, notícias). Selecione um período mais amplo ou colete mais dados desta candidatura.`,
      },
      perceptionShift: null,
      groupsNarrative: [],
      eventsNarrative: [],
      timelineNarrative: [],
      aiFinal: `Sem dados suficientes para construir uma narrativa histórica sobre ${candidate} no período. Recomenda-se ampliar o intervalo ou adicionar fontes adicionais.`,
      dataNote,
    };
  }

  const themesTop = curr.themes.slice(0, 3).map((t: any) => t.theme).join(", ");
  return {
    popularClimate: {
      level: climate.level,
      narrative: lateMain
        ? `No período analisado, o debate público sobre ${candidate} girou principalmente em torno de ${themesTop}. O tom predominante foi ${climate.level.toLowerCase()} (${curr.sentNegPct}% negativo, ${curr.sentPosPct}% positivo) sobre ${curr.totalMentions} menções analisadas.`
        : `Foram analisadas ${curr.totalMentions} menções sobre ${candidate}, com tom ${climate.level.toLowerCase()} (${curr.sentNegPct}% negativo, ${curr.sentPosPct}% positivo). Os temas específicos não puderam ser classificados automaticamente.`,
    },
    perceptionShift: (earlyMain || lateMain) ? {
      from: earlyMain || "Sem tema dominante anterior",
      to: lateMain || "Sem tema dominante atual",
      explanation: earlyMain && lateMain && earlyMain !== lateMain
        ? `O debate migrou de ${earlyMain} para ${lateMain}, acompanhando ${direction}.`
        : `O debate manteve foco em ${lateMain || earlyMain}, com ${direction} em relação ao período equivalente anterior.`,
    } : null,
    groupsNarrative: [],
    eventsNarrative: [],
    timelineNarrative: [],
    aiFinal: `${candidate} foi mencionado ${curr.totalMentions} vezes no período, com tom ${climate.level.toLowerCase()}. ${lateMain ? `O tema dominante foi ${lateMain}. ` : ""}Em relação ao período anterior, houve ${direction}. Análise gerada localmente a partir dos agregados disponíveis.`,
    dataNote,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = userRes?.user;
    if (!user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const candidateId: string = body.candidateId;
    const startDate: string = body.startDate;
    const endDate: string = body.endDate;
    if (!candidateId || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: "candidateId, startDate, endDate são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: cand } = await supabase
      .from("candidates")
      .select("id, full_name, user_id, created_at, party, region")
      .eq("id", candidateId)
      .maybeSingle();
    if (!cand) return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const currStart = new Date(startDate);
    const currEnd = new Date(endDate);
    const days = Math.max(1, Math.ceil((currEnd.getTime() - currStart.getTime()) / 86400000));
    let prevStart = new Date(currStart); prevStart.setFullYear(prevStart.getFullYear() - 1);
    let prevEnd = new Date(currEnd); prevEnd.setFullYear(prevEnd.getFullYear() - 1);
    let prevLabel = "Mesmo período do ano anterior";

    const { count: prevYearCount } = await supabase
      .from("social_interactions")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", candidateId)
      .gte("created_at", prevStart.toISOString())
      .lte("created_at", prevEnd.toISOString());
    if (!prevYearCount || prevYearCount < 5) {
      prevEnd = new Date(currStart.getTime() - 1);
      prevStart = new Date(prevEnd.getTime() - days * 86400000);
      prevLabel = "Período imediatamente anterior";
    }

    const loadData = async (start: Date, end: Date) => {
      const [interactionsRes, histRes, eventsRes] = await Promise.all([
        supabase.from("social_interactions")
          .select("created_at, social_network, interaction_type, comment_text, sentiment_label, sentiment_score, region, state, author_username")
          .eq("candidate_id", candidateId)
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .order("created_at")
          .limit(5000),
        supabase.from("historical_mentions")
          .select("date, mentions, sentiment_positive, sentiment_negative, sentiment_neutral, themes, region")
          .eq("candidate_id", candidateId)
          .gte("date", ymd(start))
          .lte("date", ymd(end))
          .order("date"),
        supabase.from("political_events")
          .select("event_name, event_type, event_date, description, location, state, city, keywords")
          .eq("candidate_id", candidateId)
          .gte("event_date", start.toISOString())
          .lte("event_date", end.toISOString())
          .order("event_date"),
      ]);
      return {
        interactions: (interactionsRes.data || []) as InteractionRow[],
        hist: (histRes.data || []) as HistRow[],
        events: eventsRes.data || [],
      };
    };

    const [current, previous] = await Promise.all([loadData(currStart, currEnd), loadData(prevStart, prevEnd)]);

    // ---- Enriquecimento externo automático ----
    const enrichmentNotes: string[] = [];
    const SPARSE_THRESHOLD = 20;
    const internalCount = (rows: { interactions: InteractionRow[]; hist: HistRow[] }) =>
      rows.interactions.length + rows.hist.reduce((s, h) => s + Number(h.mentions || 0), 0);

    if (internalCount(current) < SPARSE_THRESHOLD) {
      const gdelt = await fetchGdeltHistorical(cand.full_name, currStart, currEnd, 250);
      if (gdelt.length > 0) {
        current.interactions = [...current.interactions, ...gdelt];
        enrichmentNotes.push(`+${gdelt.length} notícias históricas (GDELT) no período atual`);
      }
    }
    if (internalCount(previous) < SPARSE_THRESHOLD) {
      const gdeltPrev = await fetchGdeltHistorical(cand.full_name, prevStart, prevEnd, 250);
      if (gdeltPrev.length > 0) {
        previous.interactions = [...previous.interactions, ...gdeltPrev];
        enrichmentNotes.push(`+${gdeltPrev.length} notícias históricas (GDELT) no período anterior`);
      }
    }

    const currAgg = aggregatePeriod("atual", current.interactions, current.hist, current.events);
    const prevAgg = aggregatePeriod("anterior", previous.interactions, previous.hist, previous.events);

    const themeUnion = Array.from(new Set([...currAgg.themes.map((t) => t.theme), ...prevAgg.themes.map((t) => t.theme)]));
    const themesEvolution = themeUnion.map((theme) => {
      const c = currAgg.themes.find((t) => t.theme === theme);
      const p = prevAgg.themes.find((t) => t.theme === theme);
      const cm = c?.mentions || 0;
      const pm = p?.mentions || 0;
      return {
        theme,
        mentionsCurrent: cm,
        mentionsPrevious: pm,
        deltaPct: deltaPct(cm, pm),
        sentNegPct: c?.sentNegPct ?? 0,
        sentPosPct: c?.sentPosPct ?? 0,
        sentNeuPct: c?.sentNeuPct ?? 0,
      };
    }).sort((a, b) => b.mentionsCurrent - a.mentionsCurrent).slice(0, 12);

    const texts = current.interactions.map((i) => i.comment_text || "").filter(Boolean);
    const phrases = extractPhrases(texts);
    const words = extractWords(texts);
    const groups = detectGroups(current.interactions);
    const eventsImpact = detectEventsImpact(current.events, current.interactions);
    const smartTimeline = buildSmartTimeline(currAgg.dailyMentions, current.events, current.interactions);
    const climate = climateLevel(currAgg.sentimentScore, currAgg.totalMentions);

    const dataNote = enrichmentNotes.length > 0
      ? `Dados internos complementados com fontes históricas externas: ${enrichmentNotes.join("; ")}.`
      : `Análise baseada em ${currAgg.totalMentions} menções internas no período atual.`;

    const summary = {
      candidate: cand.full_name + (cand.party ? ` (${cand.party})` : ""),
      currentPeriod: { start: ymd(currStart), end: ymd(currEnd), days, label: "Período selecionado" },
      previousPeriod: { start: ymd(prevStart), end: ymd(prevEnd), days, label: prevLabel },
      kpi: {
        currentMentions: currAgg.totalMentions,
        previousMentions: prevAgg.totalMentions,
        mentionsDeltaPct: deltaPct(currAgg.totalMentions, prevAgg.totalMentions),
        currentSentimentScore: Number(currAgg.sentimentScore.toFixed(3)),
        previousSentimentScore: Number(prevAgg.sentimentScore.toFixed(3)),
        climateLevel: climate.level,
        climateEmoji: climate.emoji,
        sentPosPct: currAgg.sentPosPct,
        sentNegPct: currAgg.sentNegPct,
        sentNeuPct: currAgg.sentNeuPct,
      },
      themesEvolution,
      voicesOfThePeople: { phrases, words, totalAnalyzed: texts.length },
      groups,
      eventsImpact,
      smartTimeline,
      enrichmentNotes,
    };

    // ---- Cache ----
    const cacheKey = `hist_narrative:v2:${await sha256(`${candidateId}:${ymd(currStart)}:${ymd(currEnd)}:${ymd(prevStart)}:${ymd(prevEnd)}:${currAgg.totalMentions}:${prevAgg.totalMentions}`)}`;
    const { data: cached } = await supabase.from("analysis_cache")
      .select("result, provider, hit_count").eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cached?.result) {
      await supabase.from("analysis_cache").update({ last_hit_at: new Date().toISOString(), hit_count: Number(cached.hit_count || 0) + 1 }).eq("cache_key", cacheKey);
      return new Response(JSON.stringify({ ...(cached.result as any), fromCache: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- IA (sem retornar "temas gerais") ----
    let aiPayload: any = null;
    let provider = "local_fallback";
    let aiNotice: any = null;

    if (currAgg.totalMentions > 0) {
      const aiInput = {
        candidate: cand.full_name,
        currentPeriod: summary.currentPeriod,
        previousPeriod: summary.previousPeriod,
        kpi: summary.kpi,
        topThemesCurrent: currAgg.themes.slice(0, 8),
        topThemesPrevious: prevAgg.themes.slice(0, 8),
        themesEvolution: themesEvolution.slice(0, 10),
        topPhrases: phrases.slice(0, 15),
        topRegionsCurrent: currAgg.topRegions.slice(0, 5),
        groups: groups.slice(0, 6),
        eventsImpact: eventsImpact.slice(0, 5),
        dataSources: enrichmentNotes,
      };

      const prompt = `Você é um analista político brasileiro sênior. Analise a evolução narrativa da percepção pública sobre o candidato abaixo, comparando o período ATUAL com o período EQUIVALENTE ANTERIOR.

DADOS AGREGADOS (sem texto bruto):
${JSON.stringify(aiInput)}

REGRAS CRÍTICAS:
- NUNCA use expressões genéricas como "temas gerais", "tema geral", "neutro padrão" ou textos vagos.
- Use APENAS temas presentes nos dados. Se a lista de temas estiver vazia, diga explicitamente que os temas não puderam ser identificados.
- Foque em NARRATIVA, CONTEXTO e PERCEPÇÃO PÚBLICA — não apenas números. PT-BR.

Retorne ESTRITAMENTE JSON neste formato:
{
  "popularClimate": {
    "level": "Muito favorável|Favorável|Equilibrado|Desfavorável|Muito desfavorável",
    "narrative": "2-4 frases descrevendo como o povo falava do candidato no período atual, mencionando temas REAIS e tom."
  },
  "perceptionShift": {
    "from": "tema/narrativa do período anterior (use um tema real da lista)",
    "to": "tema/narrativa do período atual (use um tema real da lista)",
    "explanation": "2-3 frases explicando o que mudou e por quê."
  },
  "groupsNarrative": [
    { "group": "nome do grupo", "narrative": "1-2 frases sobre o que esse grupo discute" }
  ],
  "eventsNarrative": [
    { "event": "nome do evento", "impact": "como afetou a percepção (1-2 frases)" }
  ],
  "timelineNarrative": [
    { "date": "AAAA-MM-DD", "title": "marco", "narrative": "o que mudou na narrativa" }
  ],
  "aiFinal": "Texto longo (6-10 frases) respondendo: Como o povo via o candidato? Quais temas dominavam? O que mudou em relação ao período anterior? Quais grupos apoiavam e quais criticavam? O que pode ter causado as mudanças? Qual a tendência futura provável?",
  "dataNote": "frase curta sobre completude e origem dos dados"
}`;

      try {
        const r = await callAICerebrasFirst({
          systemMsg: "Você é um analista político brasileiro sênior, especialista em percepção pública. Responda em PT-BR. Retorne APENAS JSON válido. NUNCA invente temas — use apenas o que está nos dados.",
          userPrompt: prompt,
          jsonMode: true,
          maxTokens: 3000,
          temperature: 0.5,
          tag: "hist-narrative",
        });
        try {
          aiPayload = JSON.parse(r.content);
          provider = `${r.provider}:${r.model}`;
        } catch {
          console.warn("[hist-narrative] JSON inválido do provedor", r.provider);
        }
      } catch (e) {
        console.warn(`[hist-narrative] todos provedores falharam: ${(e as Error).message}`);
        aiNotice = { errorType: "AI_UNAVAILABLE", userMessage: "Provedores de IA indisponíveis — análise local aplicada." };
      }
    }

    if (!aiPayload) {
      aiPayload = buildLocalAnalysis(currAgg, prevAgg, cand.full_name, dataNote);
      if (!aiNotice) {
        aiNotice = currAgg.totalMentions === 0
          ? { errorType: "NO_DATA", userMessage: "Nenhum dado encontrado para o período, mesmo após busca em fontes externas." }
          : { errorType: "AI_UNAVAILABLE", userMessage: "Análise local aplicada." };
      }
    }

    const responsePayload = {
      candidate: { id: cand.id, name: cand.full_name, party: cand.party, region: cand.region },
      summary,
      analysis: aiPayload,
      aiNotice,
      provider,
      fromCache: false,
    };

    // Só faz cache se tivermos dados reais
    if (currAgg.totalMentions > 0) {
      await supabase.from("analysis_cache").upsert({
        cache_key: cacheKey,
        analysis_type: "historical_narrative",
        result: responsePayload,
        provider,
        expires_at: new Date(Date.now() + (provider === "local_fallback" ? 6 : 30) * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "cache_key" });
    }

    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[historical-comparison] fatal", e);
    return new Response(JSON.stringify({
      analysis: null,
      aiError: { errorType: "EDGE_FUNCTION_ERROR", message: String(e), userMessage: "Erro interno na função de análise." },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
