// Comparação Histórica IA — análise narrativa de evolução temporal usando Cerebras.
// Body: { candidateId, startDate, endDate }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";

interface Article { url: string; title: string; seendate: string; domain?: string; tone?: number }

function ymd(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

function parseGdeltDate(s: string): Date | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

function nameMatches(text: string, fullName: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  if (parts.length >= 2) return t.includes(`${parts[0]} ${parts[parts.length - 1]}`);
  return t.includes(parts[0]);
}

const THEME_MAP: Record<string, RegExp> = {
  "Economia": /(economia|emprego|inflação|preço|renda|salário|juros|pib|custo de vida)/,
  "Segurança pública": /(segurança|crime|violência|polícia|tráfico|assalto|homicídio)/,
  "Saúde": /(saúde|hospital|sus|médico|vacina|remédio)/,
  "Educação": /(educação|escola|professor|aluno|ensino|universidade|enem)/,
  "Corrupção": /(corrupção|propina|desvio|fraude|rachadinha|lava jato)/,
  "Impostos": /(imposto|tributo|taxa|arrecadação)/,
  "Meio ambiente": /(meio ambiente|amazônia|clima|desmatamento|queimada|enchente)/,
  "Programas sociais": /(bolsa família|auxílio|benefício|pobreza|fome|cadúnico)/,
  "Eleições": /(eleição|eleições|campanha|urna|tse|voto)/,
};

function detectThemes(text: string): string[] {
  const t = text.toLowerCase();
  const themes: string[] = [];
  for (const [k, re] of Object.entries(THEME_MAP)) if (re.test(t)) themes.push(k);
  return themes;
}

async function fetchGdeltRange(query: string, start: Date, end: Date): Promise<Article[]> {
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}${String(d.getUTCSeconds()).padStart(2, "0")}`;
  const q = `${query} sourcelang:Portuguese sourcecountry:BR`;
  const url = `${GDELT}?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=250&format=JSON&startdatetime=${fmt(start)}&enddatetime=${fmt(end)}&sort=DateDesc`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "ClimaPolitico/1.0" } });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.articles) ? json.articles : [];
  } catch { return []; }
}

async function collectHistorical(supabase: any, userId: string, candidateId: string, fullName: string, start: Date, end: Date): Promise<Article[]> {
  const articles = await fetchGdeltRange(`"${fullName}"`, start, end);
  const matched: Article[] = [];
  const buckets: Record<string, { mentions: number; tone: number; toneN: number; themes: Set<string> }> = {};
  for (const a of articles) {
    if (!a.title || !nameMatches(a.title, fullName)) continue;
    matched.push(a);
    const d = parseGdeltDate(a.seendate);
    if (!d) continue;
    const key = ymd(d);
    const b = buckets[key] || { mentions: 0, tone: 0, toneN: 0, themes: new Set<string>() };
    b.mentions++;
    if (typeof a.tone === "number") { b.tone += a.tone; b.toneN++; }
    for (const th of detectThemes(a.title)) b.themes.add(th);
    buckets[key] = b;
  }
  const rows = Object.entries(buckets).map(([date, b]) => {
    const avg = b.toneN > 0 ? b.tone / b.toneN : 0;
    const pos = avg > 1 ? b.mentions : 0;
    const neg = avg < -1 ? b.mentions : 0;
    const neu = b.mentions - pos - neg;
    return {
      user_id: userId, candidate_id: candidateId, date, platform: "gdelt_news",
      mentions: b.mentions, engagement: 0,
      sentiment_positive: pos, sentiment_negative: neg, sentiment_neutral: neu,
      themes: Array.from(b.themes), source: "historical_fetch",
    };
  });
  if (rows.length > 0) {
    await supabase.from("historical_mentions").upsert(rows, { onConflict: "candidate_id,date,platform,source", ignoreDuplicates: false });
  }
  return matched;
}

function splitMid(start: Date, end: Date): Date {
  return new Date(Math.round((start.getTime() + end.getTime()) / 2));
}

function bucketThemes(items: Array<{ themes?: string[] | null }>): Array<{ theme: string; count: number }> {
  const m: Record<string, number> = {};
  for (const it of items) for (const t of (it.themes || [])) m[t] = (m[t] || 0) + 1;
  return Object.entries(m).map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function topEntries(map: Record<string, number>, limit = 8) {
  return Object.entries(map)
    .filter(([k]) => Boolean(k && k.trim()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function detectHashtags(text: string): string[] {
  return Array.from(new Set((text.match(/#[\p{L}\p{N}_-]+/giu) || []).map((h) => h.toLowerCase()).slice(0, 8)));
}

function detectNarratives(text: string): string[] {
  const t = text.toLowerCase();
  const checks: Array<[string, RegExp]> = [
    ["gestão econômica", /(economia|inflação|emprego|renda|preço|juros|custo de vida)/],
    ["segurança e ordem pública", /(segurança|crime|violência|polícia|tráfico|facção|assalto)/],
    ["proteção social", /(bolsa família|auxílio|benefício|pobreza|fome|programa social|cadúnico)/],
    ["integridade pública", /(corrupção|propina|fraude|desvio|rachadinha|lava jato)/],
    ["disputa eleitoral", /(eleição|campanha|voto|urna|pesquisa|debate|mandato)/],
    ["serviços públicos", /(saúde|hospital|sus|educação|escola|transporte|saneamento)/],
  ];
  return checks.filter(([, re]) => re.test(t)).map(([label]) => label);
}

function sentimentTrend(first: any, second: any): string {
  const fNeg = Number(first.sentimentNegativePct ?? 0);
  const sNeg = Number(second.sentimentNegativePct ?? 0);
  const fPos = Number(first.sentimentPositivePct ?? 0);
  const sPos = Number(second.sentimentPositivePct ?? 0);
  if (sNeg - fNeg >= 10 && sPos - fPos >= 5) return "polarização crescente";
  if (sNeg - fNeg >= 10) return "aumento de pressão negativa";
  if (sPos - fPos >= 10) return "ganho de percepção favorável";
  if (Math.abs(sNeg - fNeg) < 6 && Math.abs(sPos - fPos) < 6) return "percepção relativamente estável";
  return "mudança moderada de percepção";
}

function buildLocalAnalysis(summary: any, reason: string) {
  const first = summary.first_half || {};
  const second = summary.second_half || {};
  const earlyThemes = first.topThemes || [];
  const lateThemes = second.topThemes || [];
  const trend = sentimentTrend(first, second);
  const earlyMain = earlyThemes[0] || "temas institucionais";
  const lateMain = lateThemes[0] || earlyMain;
  const signals = summary.totals?.signals ?? 0;
  const volumeMove = Number(second.mentions || 0) > Number(first.mentions || 0) ? "aumento" : Number(second.mentions || 0) < Number(first.mentions || 0) ? "redução" : "estabilidade";
  const regions = [...(first.topRegions || []), ...(second.topRegions || [])].map((r: any) => r.region).filter(Boolean);
  const uniqueRegions = Array.from(new Set(regions)).slice(0, 3);
  const regionText = uniqueRegions.length ? ` com maior presença em ${uniqueRegions.join(", ")}` : " sem concentração regional clara";

  return {
    summary: `Entre ${summary.period?.start} e ${summary.period?.end}, a percepção pública sobre ${summary.candidate} apresentou ${trend}, com ${volumeMove} do volume relativo de sinais na segunda metade do período. No início, a conversa se concentrou em ${earlyMain}; ao final, o eixo mais visível passou a envolver ${lateMain}, indicando deslocamento de pauta ou reforço da narrativa dominante. A leitura regional aparece${regionText}. Eventos registrados no período foram considerados como possíveis pontos de inflexão, sem inventar fatos além dos dados coletados.`,
    detectedChanges: [
      { type: "narrative_shift", title: "Reorganização de narrativa", description: `A pauta saiu de ${earlyMain} e passou a enfatizar ${lateMain}, conforme os sinais agregados disponíveis.` },
      { type: trend.includes("polarização") ? "polarization" : trend.includes("negativa") ? "rejection_increase" : "thematic_shift", title: "Mudança de percepção", description: `A trajetória agregada aponta ${trend}, com análise baseada em dados consolidados, não em registros brutos.` },
    ],
    narratives: {
      early: { label: earlyMain, evidence: `Tema recorrente no início do período (${first.label || "primeira metade"}).` },
      late: { label: lateMain, evidence: `Tema recorrente no fim do período (${second.label || "segunda metade"}).` },
    },
    perceptionShifts: [
      { group: "Opinião pública monitorada", shift: `Sinais agregados indicam ${trend} e mudança de foco temático ao longo do intervalo.` },
    ],
    associatedEvents: (second.events || first.events || []).slice(0, 3).map((e: any) => ({
      name: e.name || "Evento político registrado",
      date: e.date,
      type: e.type || "outro",
      impact: "Incluído como contexto temporal da análise local.",
    })),
    dominantThemesByPeriod: { early: earlyThemes.slice(0, 3), late: lateThemes.slice(0, 3) },
    dataNote: reason || `Dados limitados para este período; análise baseada nas informações disponíveis (${signals} sinais agregados).`,
  };
}

type AiResult =
  | { ok: true; data: any; provider: string; latencyMs: number; tokens?: number }
  | { ok: false; errorType: "QUOTA_EXCEEDED" | "TIMEOUT" | "RATE_LIMIT" | "AUTH" | "MODEL_UNAVAILABLE" | "INTERNAL" | "PARSE" | "MISSING_KEY"; message: string; status?: number; provider: string };

type AiErrorType = Extract<AiResult, { ok: false }>["errorType"];

type ProviderName = "gateway-pro" | "gateway-flash" | "cerebras";

async function callAi(provider: ProviderName, prompt: string, signal: AbortSignal): Promise<AiResult> {
  const started = Date.now();
  const isCerebras = provider === "cerebras";
  const key = Deno.env.get(isCerebras ? "CEREBRAS_API_KEY" : "LOVABLE_API_KEY");
  if (!key) return { ok: false, errorType: "MISSING_KEY", message: `${provider} key não configurada`, provider };

  const url = isCerebras
    ? "https://api.cerebras.ai/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";

  const gatewayModel = provider === "gateway-pro" ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";

  const body = isCerebras
    ? {
        model: "llama3.1-8b",
        messages: [
          { role: "system", content: "Você é um analista político brasileiro experiente. Responda SEMPRE em português do Brasil. Retorne APENAS JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2500,
      }
    : {
        model: gatewayModel,
        messages: [
          { role: "system", content: "Você é um analista político brasileiro sênior, especialista em análise histórica de percepção pública. Responda em PT-BR. Retorne APENAS JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: isCerebras
        ? { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }
        : { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "clima-politico-edge-historical" },
      body: JSON.stringify(body),
      signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[ai:${provider}] HTTP ${res.status} (${latencyMs}ms)`, txt.slice(0, 400));
      let errorType: AiErrorType;
      if (res.status === 402) errorType = "QUOTA_EXCEEDED";
      else if (res.status === 429) errorType = "RATE_LIMIT";
      else if (res.status === 401 || res.status === 403) errorType = "AUTH";
      else if (res.status === 404 && /model|not_found/i.test(txt)) errorType = "MODEL_UNAVAILABLE";
      else errorType = "INTERNAL";
      return { ok: false, errorType, message: `${provider} HTTP ${res.status}`, status: res.status, provider };
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    const tokens = json?.usage?.total_tokens;
    console.log(`[ai:${provider}] ok ${latencyMs}ms tokens=${tokens ?? "?"} chars=${content.length}`);
    try {
      const parsed = JSON.parse(content);
      return { ok: true, data: parsed, provider, latencyMs, tokens };
    } catch {
      return { ok: false, errorType: "PARSE", message: `${provider} retornou JSON inválido`, provider };
    }
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    const isTimeout = e?.name === "AbortError" || /abort|timeout/i.test(String(e));
    console.error(`[ai:${provider}] exception ${latencyMs}ms`, e);
    return {
      ok: false,
      errorType: isTimeout ? "TIMEOUT" : "INTERNAL",
      message: String(e?.message || e),
      provider,
    };
  }
}

async function tryProvider(name: ProviderName, prompt: string, timeoutMs: number): Promise<AiResult> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await callAi(name, prompt, ctrl.signal);
  } finally {
    clearTimeout(to);
  }
}

function userFacingError(errorType: string): string {
  switch (errorType) {
    case "QUOTA_EXCEEDED": return "Limite temporário da IA atingido. Exibindo análise baseada nos dados já coletados.";
    case "TIMEOUT": return "Tempo limite da IA atingido. Exibindo análise baseada nos dados já coletados.";
    case "RATE_LIMIT": return "Limite temporário da IA atingido. Exibindo análise baseada nos dados já coletados.";
    case "AUTH": return "Falha de autenticação com o provedor de IA.";
    case "MODEL_UNAVAILABLE": return "Modelo de IA indisponível no momento. Exibindo análise baseada nos dados já coletados.";
    case "PARSE": return "A IA retornou um formato inesperado.";
    case "MISSING_KEY": return "Provedor de IA não configurado.";
    default: return "Erro ao processar análise.";
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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

    const { data: cand, error: candErr } = await supabase
      .from("candidates")
      .select("id, full_name, user_id, created_at, party, region")
      .eq("id", candidateId)
      .maybeSingle();
    if (candErr || !cand) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const candCreated = new Date(cand.created_at);

    // Coleta histórica se intervalo anterior ao cadastro
    if (start < candCreated) {
      const partialEnd = new Date(Math.min(end.getTime(), candCreated.getTime()));
      await collectHistorical(supabase, cand.user_id, cand.id, cand.full_name, start, partialEnd);
    }

    // Carrega tudo do período
    const [histRes, eventsRes, interactionsRes] = await Promise.all([
      supabase.from("historical_mentions")
        .select("date, platform, mentions, engagement, sentiment_positive, sentiment_negative, sentiment_neutral, themes, region, source")
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
      supabase.from("social_interactions")
        .select("created_at, social_network, interaction_type, comment_text, sentiment_label, sentiment_score, region, state")
        .eq("candidate_id", candidateId)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at")
        .limit(2000),
    ]);

    const hist = histRes.data || [];
    const events = eventsRes.data || [];
    const interactions = interactionsRes.data || [];

    // Divide em dois sub-períodos para detectar evolução
    const mid = splitMid(start, end);
    const inFirst = <T extends { date?: string; created_at?: string; event_date?: string }>(it: T) => {
      const d = new Date((it.date || it.created_at || it.event_date) as string);
      return d < mid;
    };

    const histFirst = hist.filter(inFirst);
    const histSecond = hist.filter((h) => !inFirst(h));
    // Enriquece interações com temas detectados a partir do texto
    const enrichedInt = interactions.map((i: any) => ({ ...i, themes: detectThemes(i.comment_text || "") }));
    const intFirst = enrichedInt.filter(inFirst);
    const intSecond = enrichedInt.filter((h: any) => !inFirst(h));
    const evtFirst = events.filter(inFirst);
    const evtSecond = events.filter((h) => !inFirst(h));

    const themesFirst = bucketThemes([...histFirst, ...intFirst]);
    const themesSecond = bucketThemes([...histSecond, ...intSecond]);

    const sumOf = (arr: any[], key: string) => arr.reduce((s, x) => s + Number(x[key] || 0), 0);

    // Resumo COMPACTO — sem dados brutos enviados à IA
    const pct = (a: number, b: number) => (a + b) > 0 ? Math.round((a / (a + b)) * 100) : 0;
    const intSentLabel = (lbl: any) => (lbl || "").toString().toLowerCase();
    const countSent = (arr: any[], target: string) => arr.filter(i => intSentLabel(i.sentiment_label).includes(target)).length;

    const buildHalf = (label: string, h: any[], i: any[], e: any[]) => {
      const pos = sumOf(h, "sentiment_positive") + countSent(i, "positive") + countSent(i, "positivo");
      const neg = sumOf(h, "sentiment_negative") + countSent(i, "negative") + countSent(i, "negativo");
      const neu = sumOf(h, "sentiment_neutral") + countSent(i, "neutral") + countSent(i, "neutro");
      const total = pos + neg + neu;
      const regions: Record<string, number> = {};
      const hashtags: Record<string, number> = {};
      const narratives: Record<string, number> = {};
      for (const it of i) if (it.region) regions[it.region] = (regions[it.region] || 0) + 1;
      for (const it of i) {
        const text = String(it.comment_text || "");
        for (const tag of detectHashtags(text)) hashtags[tag] = (hashtags[tag] || 0) + 1;
        for (const n of detectNarratives(text)) narratives[n] = (narratives[n] || 0) + 1;
      }
      for (const ev of e) for (const kw of (ev.keywords || [])) narratives[String(kw).toLowerCase()] = (narratives[String(kw).toLowerCase()] || 0) + 1;
      const topRegions = Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, c]) => ({ region: r, count: c }));
      return {
        label,
        mentions: sumOf(h, "mentions") + i.length,
        sentimentPositivePct: total > 0 ? Math.round((pos / total) * 100) : null,
        sentimentNegativePct: total > 0 ? Math.round((neg / total) * 100) : null,
        sentimentNeutralPct: total > 0 ? Math.round((neu / total) * 100) : null,
        topThemes: bucketThemes([...h, ...i]).slice(0, 5).map(t => t.theme),
        topRegions,
        topHashtags: topEntries(hashtags, 6),
        detectedNarratives: topEntries(narratives, 6),
        events: e.slice(0, 5).map(ev => ({ name: ev.event_name, type: ev.event_type, date: (ev.event_date || "").slice(0, 10) })),
      };
    };

    const summary = {
      candidate: cand.full_name + (cand.party ? ` (${cand.party})` : ""),
      registeredAt: ymd(candCreated),
      period: { start: ymd(start), end: ymd(end) },
      totals: {
        signals: hist.length + interactions.length + events.length,
        historicalRecords: hist.length,
        realtimeInteractions: interactions.length,
        events: events.length,
      },
      first_half: buildHalf(`${ymd(start)} → ${ymd(mid)}`, histFirst, intFirst, evtFirst),
      second_half: buildHalf(`${ymd(mid)} → ${ymd(end)}`, histSecond, intSecond, evtSecond),
    };
    (summary as any).temporalChanges = {
      mentionDelta: (summary.second_half.mentions || 0) - (summary.first_half.mentions || 0),
      sentimentDirection: sentimentTrend(summary.first_half, summary.second_half),
      themesAdded: (summary.second_half.topThemes || []).filter((t: string) => !(summary.first_half.topThemes || []).includes(t)).slice(0, 5),
      themesReduced: (summary.first_half.topThemes || []).filter((t: string) => !(summary.second_half.topThemes || []).includes(t)).slice(0, 5),
    };

    // ----- Agregações avançadas para análise histórica profunda -----
    const weekKey = (d: Date) => {
      const onejan = new Date(d.getUTCFullYear(), 0, 1);
      const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getUTCDay() + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    };
    const sentBuckets: Record<string, { week: string; pos: number; neg: number; neu: number }> = {};
    for (const h of hist) {
      const k = weekKey(new Date(h.date));
      const b = sentBuckets[k] || { week: k, pos: 0, neg: 0, neu: 0 };
      b.pos += Number(h.sentiment_positive || 0);
      b.neg += Number(h.sentiment_negative || 0);
      b.neu += Number(h.sentiment_neutral || 0);
      sentBuckets[k] = b;
    }
    for (const i of enrichedInt) {
      if (!i.created_at) continue;
      const k = weekKey(new Date(i.created_at));
      const b = sentBuckets[k] || { week: k, pos: 0, neg: 0, neu: 0 };
      const lbl = intSentLabel(i.sentiment_label);
      if (lbl.includes("positiv")) b.pos++;
      else if (lbl.includes("negativ")) b.neg++;
      else if (lbl.includes("neutr")) b.neu++;
      sentBuckets[k] = b;
    }
    const sentimentTimeline = Object.values(sentBuckets).sort((a, b) => a.week.localeCompare(b.week));

    const regionAgg = (arr: any[]) => {
      const m: Record<string, { mentions: number; pos: number; neg: number; neu: number }> = {};
      for (const it of arr) {
        const r = it.region || it.state;
        if (!r) continue;
        const b = m[r] || { mentions: 0, pos: 0, neg: 0, neu: 0 };
        b.mentions += 1;
        const lbl = intSentLabel(it.sentiment_label);
        if (lbl.includes("positiv")) b.pos++;
        else if (lbl.includes("negativ")) b.neg++;
        else if (lbl.includes("neutr")) b.neu++;
        m[r] = b;
      }
      return m;
    };
    const regFirst = regionAgg(intFirst);
    const regSecond = regionAgg(intSecond);
    const allRegions = Array.from(new Set([...Object.keys(regFirst), ...Object.keys(regSecond)]));
    const regionalShift = allRegions.map((r) => {
      const a = regFirst[r] || { mentions: 0, pos: 0, neg: 0, neu: 0 };
      const b = regSecond[r] || { mentions: 0, pos: 0, neg: 0, neu: 0 };
      const sentA = a.pos - a.neg;
      const sentB = b.pos - b.neg;
      return {
        region: r,
        mentionsEarly: a.mentions,
        mentionsLate: b.mentions,
        mentionsDelta: b.mentions - a.mentions,
        sentimentDelta: sentB - sentA,
        direction: b.mentions > a.mentions * 1.3 ? "alta" : b.mentions < a.mentions * 0.7 ? "queda" : "estável",
      };
    }).sort((a, b) => Math.abs(b.mentionsDelta) - Math.abs(a.mentionsDelta)).slice(0, 8);

    const emotionRegex: Record<string, RegExp> = {
      indignação: /(absurdo|vergonha|revoltante|inaceitável|nojo)/i,
      aprovação: /(parabéns|excelente|ótimo|incrível|maravilhoso)/i,
      apoio: /(apoio|junto|com você|força)/i,
      rejeição: /(fora|nunca|jamais|não voto|repúdio)/i,
      polarização: /(sempre|nunca|todos|ninguém|verdade absoluta)/i,
      confiança: /(confio|acredito|honesto|sério|comprometido)/i,
    };
    const countEmotions = (arr: any[]) => {
      const m: Record<string, number> = {};
      for (const it of arr) {
        const t = String(it.comment_text || "");
        for (const [emo, re] of Object.entries(emotionRegex)) if (re.test(t)) m[emo] = (m[emo] || 0) + 1;
      }
      return m;
    };
    const emoEarly = countEmotions(intFirst);
    const emoLate = countEmotions(intSecond);
    const allEmotions = Array.from(new Set([...Object.keys(emoEarly), ...Object.keys(emoLate)]));
    const emotionalShift = allEmotions.map((e) => ({
      emotion: e,
      early: emoEarly[e] || 0,
      late: emoLate[e] || 0,
      delta: (emoLate[e] || 0) - (emoEarly[e] || 0),
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const dailyMentions: Record<string, number> = {};
    for (const h of hist) dailyMentions[h.date] = (dailyMentions[h.date] || 0) + Number(h.mentions || 0);
    for (const i of enrichedInt) {
      if (!i.created_at) continue;
      const d = ymd(new Date(i.created_at));
      dailyMentions[d] = (dailyMentions[d] || 0) + 1;
    }
    const dailyValues = Object.values(dailyMentions);
    const avgDaily = dailyValues.length ? dailyValues.reduce((s, n) => s + n, 0) / dailyValues.length : 0;
    const peaks = Object.entries(dailyMentions)
      .filter(([, v]) => v > avgDaily * 2 && v >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([date, v]) => ({ date, type: "spike", label: `Pico de menções (${v})`, mentions: v }));
    const eventTimeline = [
      ...events.map((e: any) => ({
        date: (e.event_date || "").slice(0, 10),
        type: e.event_type || "evento",
        label: e.event_name,
        description: e.description || null,
        location: e.location || [e.city, e.state].filter(Boolean).join(", ") || null,
      })),
      ...peaks,
    ].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    (summary as any).advanced = {
      sentimentTimeline,
      regionalShift,
      emotionalShift,
      eventTimeline,
    };

    const hasMinimumData = summary.totals.signals >= 1;
    const summaryJson = JSON.stringify(summary);
    const cacheKey = `historical_comparison:v6:${await sha256(`${candidateId}:${ymd(start)}:${ymd(end)}:${summaryJson}`)}`;
    console.log(`[historical-comparison] sinais=${summary.totals.signals}; resumo=${summaryJson.length} chars; cache=${cacheKey.slice(0, 40)}`);

    const { data: cached } = await supabase
      .from("analysis_cache")
      .select("result, provider, hit_count")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached?.result) {
      await supabase.from("analysis_cache").update({ last_hit_at: new Date().toISOString(), hit_count: Number(cached.hit_count || 0) + 1 }).eq("cache_key", cacheKey);
      console.log(`[historical-comparison] cache hit provider=${cached.provider || "cache"}`);
      return new Response(JSON.stringify({
        ...(cached.result as Record<string, unknown>),
        fromCache: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const prompt = `Analise a evolução da percepção pública do candidato político brasileiro a seguir.

DADOS AGREGADOS (já resumidos, NÃO há texto bruto):
${summaryJson}

Produza análise política PROFUNDA em PT-BR como um analista experiente. Explique o QUE aconteceu e COMO isso afetou a percepção pública. Mesmo com poucos dados, gere narrativa. NUNCA diga "insuficiente"; se o volume for baixo, registre em dataNote.

Retorne ESTRITAMENTE JSON neste formato (sem markdown):
{
  "summary": "parágrafo narrativo de 4 a 8 frases.",
  "narrativeShift": { "from": "tema/narrativa dominante no início", "to": "tema/narrativa dominante no fim", "explanation": "1-2 frases explicando a migração de discurso" },
  "detectedChanges": [
    { "type": "growth_support|rejection_increase|polarization|regional_shift|thematic_shift|narrative_shift|event_impact", "title": "título curto", "description": "1-2 frases" }
  ],
  "narratives": {
    "early": { "label": "narrativa predominante no início", "evidence": "evidência curta" },
    "late": { "label": "narrativa predominante no fim", "evidence": "evidência curta" }
  },
  "perceptionShifts": [ { "group": "grupo afetado", "shift": "descrição" } ],
  "associatedEvents": [ { "name": "evento", "date": "AAAA-MM-DD", "type": "debate|entrevista|discurso|notícia|outro", "impact": "como afetou" } ],
  "timelineInsights": [ { "date": "AAAA-MM", "title": "marco do período", "description": "o que aconteceu e impacto" } ],
  "regionalInsights": [ { "region": "UF/região", "movement": "alta|queda|estável", "explanation": "1 frase" } ],
  "demographicInsights": [ { "group": "jovens|adultos|homens|mulheres|...", "trend": "descrição curta" } ],
  "emotionalInsights": [ { "emotion": "indignação|aprovação|apoio|rejeição|polarização|confiança", "movement": "alta|queda|estável", "explanation": "1 frase" } ],
  "dominantThemesByPeriod": { "early": ["t1","t2","t3"], "late": ["t1","t2","t3"] },
  "dataNote": "frase curta sobre completude."
}`;

    const buildResponse = (analysis: any, provider: string, aiNotice: any = null, fromCache = false) => ({
      candidate: { id: cand.id, name: cand.full_name, createdAt: cand.created_at, party: cand.party, region: cand.region },
      period: { start: startDate, end: endDate, mid: mid.toISOString() },
      summary,
      hasMinimumData,
      analysis,
      aiError: null,
      aiNotice,
      provider,
      fromCache,
    });




    // Cascata dedicada à Comparação Histórica IA:
    // 1) Gateway Pro (Gemini 2.5 Pro)  2) Gateway Flash  3) Cerebras  4) Análise local (regras)
    let aiPayload: any = null;
    let provider = "local_fallback";
    let aiNotice: { errorType: string; message: string; provider: string; userMessage: string } | null = null;
    const attempts: Array<{ provider: string; status: string; errorType?: string; latencyMs?: number; tokens?: number | null }> = [];

    const cascade: Array<{ name: ProviderName; timeoutMs: number }> = [
      { name: "gateway-pro", timeoutMs: 45000 },
      { name: "gateway-flash", timeoutMs: 30000 },
      { name: "cerebras", timeoutMs: 30000 },
    ];

    for (const step of cascade) {
      const r = await tryProvider(step.name, prompt, step.timeoutMs);
      if (r.ok) {
        aiPayload = r.data;
        provider = r.provider;
        attempts.push({ provider: step.name, status: "ok", latencyMs: r.latencyMs, tokens: r.tokens ?? null });
        console.log(`[historical-comparison] cascata OK em ${step.name} (${r.latencyMs}ms)`);
        break;
      }
      attempts.push({ provider: step.name, status: "fail", errorType: r.errorType });
      console.warn(`[historical-comparison] cascata falhou em ${step.name}: ${r.errorType}`);
      // Em erros não recuperáveis de auth, encerra a cascata.
      if (r.errorType === "AUTH" || r.errorType === "MISSING_KEY") {
        aiNotice = { errorType: r.errorType, message: r.message, provider: r.provider, userMessage: userFacingError(r.errorType) };
        if (r.errorType === "AUTH") break;
      }
    }

    if (!aiPayload) {
      const lastFail = attempts.filter(a => a.status === "fail").pop();
      const reason = lastFail ? userFacingError(lastFail.errorType || "INTERNAL") : "Dados limitados para este período; análise baseada nas informações disponíveis.";
      aiNotice = aiNotice || { errorType: lastFail?.errorType || "INTERNAL", message: "Todos provedores indisponíveis", provider: "cascade", userMessage: reason };
      aiPayload = buildLocalAnalysis(summary, reason);
      provider = "local_fallback";
      console.warn(`[historical-comparison] cascata esgotada, usando análise local`);
    }

    const responsePayload = { ...buildResponse(aiPayload, provider, aiNotice), attempts };
    await supabase.from("analysis_cache").upsert({
      cache_key: cacheKey,
      analysis_type: "historical_comparison",
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
