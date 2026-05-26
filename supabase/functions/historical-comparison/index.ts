// Análise Histórica Narrativa IA — período atual vs equivalente anterior.
// Body: { candidateId, startDate, endDate }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  "Economia": /(economia|emprego|inflação|inflacao|preço|preco|renda|salário|salario|juros|pib|custo de vida|dólar|dolar|mercado)/i,
  "Segurança": /(segurança|seguranca|crime|violência|violencia|polícia|policia|tráfico|trafico|assalto|homicídio|homicidio|bandido)/i,
  "Saúde": /(saúde|saude|hospital|sus|médico|medico|vacina|remédio|remedio|enfermaria)/i,
  "Educação": /(educação|educacao|escola|professor|aluno|ensino|universidade|enem|creche)/i,
  "Corrupção": /(corrupção|corrupcao|propina|desvio|fraude|rachadinha|lava jato|lavajato)/i,
  "Tributação": /(imposto|tributo|taxa|arrecadação|arrecadacao|reforma tributária|tributaria)/i,
  "Meio ambiente": /(meio ambiente|amazônia|amazonia|clima|desmatamento|queimada|enchente|sustentabilidade)/i,
  "Programas sociais": /(bolsa família|bolsa familia|auxílio|auxilio|benefício|beneficio|pobreza|fome|cadúnico|cadunico|minha casa)/i,
  "Eleições": /(eleição|eleicao|eleições|eleicoes|campanha|urna|tse|voto|candidatura)/i,
  "Infraestrutura": /(estrada|asfalto|obra|saneamento|transporte|metrô|metro|ônibus|onibus|aeroporto)/i,
  "Política externa": /(eua|china|mercosul|otan|política externa|politica externa|argentina|venezuela)/i,
  "Direitos sociais": /(direitos|minoria|lgbt|negros|indígena|indigena|mulher|feminismo|racismo)/i,
  "Justiça": /(stf|justiça|justica|supremo|judiciário|judiciario|moraes|operação|operacao)/i,
};

function detectThemes(text: string): string[] {
  const t = (text || "").toLowerCase();
  const themes: string[] = [];
  for (const [k, re] of Object.entries(THEME_MAP)) if (re.test(t)) themes.push(k);
  return themes;
}

const STOPWORDS = new Set([
  "a","o","as","os","um","uma","de","do","da","dos","das","e","ou","mas","que","se","no","na","nos","nas",
  "em","por","para","com","sem","ao","aos","à","às","é","são","ser","ter","tem","têm","tinha","foi","ser",
  "como","mais","menos","muito","muita","pouco","ja","já","não","nao","sim","quando","onde","quem","qual",
  "isso","isto","aquilo","esse","essa","este","esta","aquele","aquela","ele","ela","eles","elas","eu","tu",
  "você","voce","vocês","voces","nós","nos","seu","sua","seus","suas","meu","minha","teu","tua","pelo","pela",
  "vai","vou","vamos","ir","fazer","ficar","ficou","tá","ta","pra","pro","aí","ai","lá","la","aqui","então","entao",
  "só","so","tudo","nada","todos","todas","alguém","alguem","ninguém","ninguem","cada","outro","outra","mesmo",
  "também","tambem","sobre","entre","após","apos","antes","depois","contra","https","http","www","com","br",
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
  if (l.includes("positiv")) return "pos";
  if (l.includes("negativ")) return "neg";
  if (l.includes("neutr")) return "neu";
  return null;
}

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
    const bucket = sentimentBucket(i.sentiment_label);
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
  const sentimentScore = total > 0 ? (pos - neg) / total : 0; // -1..1

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

function climateLevel(score: number): { level: string; emoji: string } {
  if (score >= 0.35) return { level: "Muito favorável", emoji: "😀" };
  if (score >= 0.1) return { level: "Favorável", emoji: "🙂" };
  if (score >= -0.1) return { level: "Neutro", emoji: "😐" };
  if (score >= -0.35) return { level: "Desfavorável", emoji: "🙁" };
  return { level: "Muito desfavorável", emoji: "😡" };
}

function deltaPct(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

function detectGroups(interactions: InteractionRow[]) {
  // Heurísticas simples para "bolhas/grupos"
  const groups: { group: string; mentions: number; theme: string; sentiment: number; evidence?: string }[] = [];
  const supporters = interactions.filter((i) => sentimentBucket(i.sentiment_label) === "pos");
  const critics = interactions.filter((i) => sentimentBucket(i.sentiment_label) === "neg");
  const neutrals = interactions.filter((i) => sentimentBucket(i.sentiment_label) === "neu");

  const dominantTheme = (arr: InteractionRow[]) => {
    const c: Record<string, number> = {};
    for (const i of arr) for (const t of detectThemes(i.comment_text || "")) c[t] = (c[t] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "Temas variados";
  };
  if (supporters.length) groups.push({ group: "Apoiadores", mentions: supporters.length, theme: dominantTheme(supporters), sentiment: 1 });
  if (critics.length) groups.push({ group: "Críticos", mentions: critics.length, theme: dominantTheme(critics), sentiment: -1 });
  if (neutrals.length) groups.push({ group: "Neutros", mentions: neutrals.length, theme: dominantTheme(neutrals), sentiment: 0 });

  // Grupos por região (top 3)
  const regCount: Record<string, InteractionRow[]> = {};
  for (const i of interactions) {
    const r = i.region || i.state;
    if (!r) continue;
    regCount[r] = regCount[r] || [];
    regCount[r].push(i);
  }
  const topReg = Object.entries(regCount).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  for (const [r, arr] of topReg) {
    const p = arr.filter((i) => sentimentBucket(i.sentiment_label) === "pos").length;
    const n = arr.filter((i) => sentimentBucket(i.sentiment_label) === "neg").length;
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
  // Para cada evento, comparar menções/sentimento ±7 dias
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
        const b = sentimentBucket(i.sentiment_label);
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
  // Picos
  const values = Object.values(dailyMentions);
  const avg = values.length ? values.reduce((s, n) => s + n, 0) / values.length : 0;
  const peaks = Object.entries(dailyMentions)
    .filter(([, v]) => v > avg * 1.8 && v >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([date, v]) => ({ date, type: "spike" as const, label: `Pico de menções (${v})`, mentions: v }));

  // Sentimento diário para detectar mudanças bruscas
  const dailySent: Record<string, { p: number; n: number }> = {};
  for (const i of interactions) {
    const d = ymd(new Date(i.created_at));
    const b = sentimentBucket(i.sentiment_label);
    const s = dailySent[d] || { p: 0, n: 0 };
    if (b === "pos") s.p++; else if (b === "neg") s.n++;
    dailySent[d] = s;
  }

  const evtItems = events.map((e: any) => ({
    date: (e.event_date || "").slice(0, 10),
    type: "event" as const,
    label: e.event_name,
    description: e.description || null,
  }));

  return [...evtItems, ...peaks].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// ---------- AI cascade ----------
type ProviderName = "gateway-pro" | "gateway-flash" | "cerebras";
type AiResult = { ok: true; data: any; provider: string; latencyMs: number } | { ok: false; errorType: string; message: string; provider: string };

async function callAi(provider: ProviderName, prompt: string, signal: AbortSignal): Promise<AiResult> {
  const started = Date.now();
  const isCerebras = provider === "cerebras";
  const key = Deno.env.get(isCerebras ? "CEREBRAS_API_KEY" : "LOVABLE_API_KEY");
  if (!key) return { ok: false, errorType: "MISSING_KEY", message: `${provider} key não configurada`, provider };
  const url = isCerebras ? "https://api.cerebras.ai/v1/chat/completions" : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const gatewayModel = provider === "gateway-pro" ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";
  const body = isCerebras
    ? { model: "llama3.1-8b", messages: [{ role: "system", content: "Você é um analista político brasileiro sênior. Responda SEMPRE em PT-BR. Retorne APENAS JSON válido." }, { role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.5, max_tokens: 3000 }
    : { model: gatewayModel, messages: [{ role: "system", content: "Você é um analista político brasileiro sênior, especialista em percepção pública. Responda em PT-BR. Retorne APENAS JSON válido." }, { role: "user", content: prompt }], response_format: { type: "json_object" } };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: isCerebras ? { "Content-Type": "application/json", "Authorization": `Bearer ${key}` } : { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify(body), signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      let errorType = "INTERNAL";
      if (res.status === 402) errorType = "QUOTA_EXCEEDED";
      else if (res.status === 429) errorType = "RATE_LIMIT";
      else if (res.status === 401 || res.status === 403) errorType = "AUTH";
      console.error(`[ai:${provider}] HTTP ${res.status}: ${txt.slice(0, 200)}`);
      return { ok: false, errorType, message: `${provider} HTTP ${res.status}`, provider };
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    try { return { ok: true, data: JSON.parse(content), provider, latencyMs }; }
    catch { return { ok: false, errorType: "PARSE", message: "JSON inválido", provider }; }
  } catch (e: any) {
    return { ok: false, errorType: /abort/i.test(String(e)) ? "TIMEOUT" : "INTERNAL", message: String(e?.message || e), provider };
  }
}

async function tryProvider(name: ProviderName, prompt: string, timeoutMs: number): Promise<AiResult> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await callAi(name, prompt, ctrl.signal); } finally { clearTimeout(to); }
}

function buildLocalAnalysis(curr: any, prev: any, candidate: string): any {
  const earlyMain = prev.themes[0]?.theme || "temas gerais";
  const lateMain = curr.themes[0]?.theme || earlyMain;
  const climate = climateLevel(curr.sentimentScore);
  const delta = curr.totalMentions - prev.totalMentions;
  const direction = delta > 0 ? `aumento de ${delta} menções` : delta < 0 ? `queda de ${Math.abs(delta)} menções` : "volume estável";
  return {
    popularClimate: {
      level: climate.level,
      narrative: `Durante o período analisado a população discutia ${candidate} principalmente em relação a ${lateMain.toLowerCase()}. O tom predominante foi ${climate.level.toLowerCase()} (${curr.sentNegPct}% negativo, ${curr.sentPosPct}% positivo).`,
    },
    perceptionShift: {
      from: earlyMain,
      to: lateMain,
      explanation: earlyMain === lateMain
        ? `O debate manteve-se centrado em ${earlyMain}, com ${direction} no período atual.`
        : `O debate migrou de ${earlyMain} para ${lateMain}, com ${direction} comparado ao período equivalente anterior.`,
    },
    aiFinal: `Entre os dois períodos comparados, ${candidate} apresentou ${direction}, com tom predominante ${climate.level.toLowerCase()}. O tema mais discutido passou de ${earlyMain} para ${lateMain}. Os indicadores agregados sugerem que a percepção pública tem reagido principalmente aos debates relacionados a ${lateMain.toLowerCase()}, em um cenário ${climate.level.toLowerCase()}. As variações regionais e os eventos detectados ajudam a explicar parte das mudanças observadas.`,
    dataNote: "Análise local baseada nos dados agregados disponíveis.",
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
    // Período equivalente anterior: mesmos N dias, 1 ano atrás
    let prevStart = new Date(currStart); prevStart.setFullYear(prevStart.getFullYear() - 1);
    let prevEnd = new Date(currEnd); prevEnd.setFullYear(prevEnd.getFullYear() - 1);
    let prevLabel = "Mesmo período do ano anterior";

    // Se não há dados no período do ano anterior, usar o período imediatamente anterior (N dias antes do atual)
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

    const currAgg = aggregatePeriod("atual", current.interactions, current.hist, current.events);
    const prevAgg = aggregatePeriod("anterior", previous.interactions, previous.hist, previous.events);

    // Evolução das narrativas (temas com variação)
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

    // Como o povo falava
    const texts = current.interactions.map((i) => i.comment_text || "").filter(Boolean);
    const phrases = extractPhrases(texts);
    const words = extractWords(texts);

    // Grupos
    const groups = detectGroups(current.interactions);

    // Eventos com impacto
    const eventsImpact = detectEventsImpact(current.events, current.interactions);

    // Linha do tempo inteligente
    const smartTimeline = buildSmartTimeline(currAgg.dailyMentions, current.events, current.interactions);

    // Clima popular
    const climate = climateLevel(currAgg.sentimentScore);

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
      // Compact data sent to AI
    };

    // ---- Cache ----
    const cacheKey = `hist_narrative:v1:${await sha256(`${candidateId}:${ymd(currStart)}:${ymd(currEnd)}:${ymd(prevStart)}:${ymd(prevEnd)}:${currAgg.totalMentions}:${prevAgg.totalMentions}`)}`;
    const { data: cached } = await supabase.from("analysis_cache")
      .select("result, provider, hit_count").eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cached?.result) {
      await supabase.from("analysis_cache").update({ last_hit_at: new Date().toISOString(), hit_count: Number(cached.hit_count || 0) + 1 }).eq("cache_key", cacheKey);
      return new Response(JSON.stringify({ ...(cached.result as any), fromCache: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- IA ----
    const aiInput = {
      candidate: cand.full_name,
      currentPeriod: summary.currentPeriod,
      previousPeriod: summary.previousPeriod,
      kpi: summary.kpi,
      topThemesCurrent: currAgg.themes.slice(0, 6),
      topThemesPrevious: prevAgg.themes.slice(0, 6),
      themesEvolution: themesEvolution.slice(0, 8),
      topPhrases: phrases.slice(0, 12),
      topRegionsCurrent: currAgg.topRegions.slice(0, 5),
      groups: groups.slice(0, 6),
      eventsImpact: eventsImpact.slice(0, 5),
    };

    const prompt = `Você é um analista político brasileiro sênior. Analise a evolução narrativa da percepção pública sobre o candidato abaixo, comparando o período ATUAL com o período EQUIVALENTE ANTERIOR.

DADOS AGREGADOS (sem texto bruto):
${JSON.stringify(aiInput)}

Foque em NARRATIVA, CONTEXTO e PERCEPÇÃO PÚBLICA — não apenas números. Use PT-BR.

Retorne ESTRITAMENTE JSON neste formato:
{
  "popularClimate": {
    "level": "Muito favorável|Favorável|Neutro|Desfavorável|Muito desfavorável",
    "narrative": "2-4 frases descrevendo como o povo falava do candidato no período atual, mencionando temas e tom."
  },
  "perceptionShift": {
    "from": "como o povo via no período anterior (tema/narrativa)",
    "to": "como o povo via no período atual (tema/narrativa)",
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
  "dataNote": "frase curta sobre completude dos dados"
}`;

    let aiPayload: any = null;
    let provider = "local_fallback";
    let aiNotice: any = null;

    const cascade: { name: ProviderName; timeoutMs: number }[] = [
      { name: "gateway-pro", timeoutMs: 45000 },
      { name: "gateway-flash", timeoutMs: 30000 },
      { name: "cerebras", timeoutMs: 25000 },
    ];
    for (const step of cascade) {
      const r = await tryProvider(step.name, prompt, step.timeoutMs);
      if (r.ok) { aiPayload = r.data; provider = r.provider; break; }
      console.warn(`[hist-narrative] ${step.name} falhou: ${r.errorType}`);
      if (r.errorType === "AUTH") { aiNotice = { errorType: r.errorType, userMessage: "Falha de autenticação com IA." }; break; }
    }

    if (!aiPayload) {
      aiPayload = buildLocalAnalysis(currAgg, prevAgg, cand.full_name);
      aiNotice = aiNotice || { errorType: "AI_UNAVAILABLE", userMessage: "Análise local aplicada — provedores de IA indisponíveis." };
    }

    const responsePayload = {
      candidate: { id: cand.id, name: cand.full_name, party: cand.party, region: cand.region },
      summary,
      analysis: aiPayload,
      aiNotice,
      provider,
      fromCache: false,
    };

    await supabase.from("analysis_cache").upsert({
      cache_key: cacheKey,
      analysis_type: "historical_narrative",
      result: responsePayload,
      provider,
      expires_at: new Date(Date.now() + (provider === "local_fallback" ? 6 : 30) * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "cache_key" });

    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[historical-comparison] fatal", e);
    return new Response(JSON.stringify({
      analysis: null,
      aiError: { errorType: "EDGE_FUNCTION_ERROR", message: String(e), userMessage: "Erro interno na função de análise." },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
