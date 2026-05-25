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
  | { ok: false; errorType: "QUOTA_EXCEEDED" | "TIMEOUT" | "RATE_LIMIT" | "AUTH" | "INTERNAL" | "PARSE" | "MISSING_KEY"; message: string; status?: number; provider: string };

async function callAi(provider: "cerebras" | "gateway", prompt: string, signal: AbortSignal): Promise<AiResult> {
  const started = Date.now();
  const isCerebras = provider === "cerebras";
  const key = Deno.env.get(isCerebras ? "CEREBRAS_API_KEY" : "LOVABLE_API_KEY");
  if (!key) return { ok: false, errorType: "MISSING_KEY", message: `${provider} key não configurada`, provider };

  const url = isCerebras
    ? "https://api.cerebras.ai/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";

  const body = isCerebras
    ? {
        model: "llama-3.3-70b",
        messages: [
          { role: "system", content: "Você é um analista político brasileiro experiente. Responda SEMPRE em português do Brasil. Retorne APENAS JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2500,
      }
    : {
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um analista político brasileiro. Retorne APENAS JSON válido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: isCerebras
        ? { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }
        : { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "clima-politico-edge" },
      body: JSON.stringify(body),
      signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[ai:${provider}] HTTP ${res.status} (${latencyMs}ms)`, txt.slice(0, 400));
      let errorType: AiResult extends { ok: false; errorType: infer T } ? T : never;
      if (res.status === 402) errorType = "QUOTA_EXCEEDED";
      else if (res.status === 429) errorType = "RATE_LIMIT";
      else if (res.status === 401 || res.status === 403) errorType = "AUTH";
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

function userFacingError(errorType: string): string {
  switch (errorType) {
    case "QUOTA_EXCEEDED": return "Limite temporário da IA atingido. Exibindo análise baseada nos dados já coletados.";
    case "TIMEOUT": return "Tempo limite da IA atingido. Exibindo análise baseada nos dados já coletados.";
    case "RATE_LIMIT": return "Limite temporário da IA atingido. Exibindo análise baseada nos dados já coletados.";
    case "AUTH": return "Falha de autenticação com o provedor de IA.";
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

    const hasMinimumData = summary.totals.signals >= 1;
    const summaryJson = JSON.stringify(summary);
    const cacheKey = `historical_comparison:v3:${await sha256(`${candidateId}:${ymd(start)}:${ymd(end)}:${summaryJson}`)}`;
    console.log(`[historical-comparison] registros enviados=0 raw; sinais agregados=${summary.totals.signals}; resumo=${summaryJson.length} chars; cache=${cacheKey.slice(0, 40)}`);

    const { data: cached } = await supabase
      .from("analysis_cache")
      .select("result, provider")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached?.result) {
      await supabase.from("analysis_cache").update({ last_hit_at: new Date().toISOString(), hit_count: 1 }).eq("cache_key", cacheKey);
      console.log(`[historical-comparison] cache hit provider=${cached.provider || "cache"}`);
      return new Response(JSON.stringify({
        ...(cached.result as Record<string, unknown>),
        fromCache: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const prompt = `Analise a evolução da percepção pública do candidato político brasileiro a seguir.

DADOS AGREGADOS (já resumidos, NÃO há texto bruto):
${summaryJson}

Produza análise política em PT-BR como um analista experiente. Mesmo com poucos dados, gere narrativa baseada no que existe — NUNCA diga "insuficiente". Se o volume for baixo, registre no campo dataNote.

Retorne ESTRITAMENTE JSON neste formato (sem markdown):
{
  "summary": "parágrafo narrativo de 4 a 8 frases descrevendo a evolução da percepção pública (volume, sentimento, temas, narrativas, regiões, eventos relevantes).",
  "detectedChanges": [
    { "type": "growth_support|rejection_increase|polarization|regional_shift|thematic_shift|narrative_shift|event_impact", "title": "título curto", "description": "1-2 frases" }
  ],
  "narratives": {
    "early": { "label": "narrativa predominante no início", "evidence": "evidência curta" },
    "late": { "label": "narrativa predominante no fim", "evidence": "evidência curta" }
  },
  "perceptionShifts": [ { "group": "grupo afetado", "shift": "descrição" } ],
  "associatedEvents": [ { "name": "evento", "date": "AAAA-MM-DD", "type": "debate|entrevista|discurso|notícia|outro", "impact": "como afetou" } ],
  "dominantThemesByPeriod": { "early": ["t1","t2","t3"], "late": ["t1","t2","t3"] },
  "dataNote": "frase curta sobre completude (ex: 'Análise baseada em N sinais')."
}`;

    // Timeout 35s para Cerebras, depois fallback
    const ctrl1 = new AbortController();
    const to1 = setTimeout(() => ctrl1.abort(), 35000);
    const cerebrasResult = await callAi("cerebras", prompt, ctrl1.signal);
    clearTimeout(to1);

    let aiPayload: any;
    let aiError: { errorType: string; message: string; provider: string } | null = null;

    if (cerebrasResult.ok) {
      aiPayload = cerebrasResult.data;
      console.log(`[historical-comparison] cerebras OK (${cerebrasResult.latencyMs}ms, tokens=${cerebrasResult.tokens ?? "?"})`);
    } else {
      console.warn(`[historical-comparison] cerebras falhou: ${cerebrasResult.errorType} — tentando fallback gateway`);
      // Só usa fallback se NÃO for quota (quota provavelmente afeta ambos)
      if (cerebrasResult.errorType !== "QUOTA_EXCEEDED" && cerebrasResult.errorType !== "MISSING_KEY") {
        const ctrl2 = new AbortController();
        const to2 = setTimeout(() => ctrl2.abort(), 30000);
        const gatewayResult = await callAi("gateway", prompt, ctrl2.signal);
        clearTimeout(to2);
        if (gatewayResult.ok) {
          aiPayload = gatewayResult.data;
          console.log(`[historical-comparison] fallback gateway OK (${gatewayResult.latencyMs}ms)`);
        } else {
          aiError = { errorType: gatewayResult.errorType, message: gatewayResult.message, provider: gatewayResult.provider };
        }
      } else {
        // tenta gateway mesmo assim como última cartada para quota
        const ctrl2 = new AbortController();
        const to2 = setTimeout(() => ctrl2.abort(), 30000);
        const gatewayResult = await callAi("gateway", prompt, ctrl2.signal);
        clearTimeout(to2);
        if (gatewayResult.ok) {
          aiPayload = gatewayResult.data;
        } else {
          aiError = { errorType: cerebrasResult.errorType, message: cerebrasResult.message, provider: "cerebras" };
        }
      }
    }

    return new Response(JSON.stringify({
      candidate: { id: cand.id, name: cand.full_name, createdAt: cand.created_at, party: cand.party, region: cand.region },
      period: { start: startDate, end: endDate, mid: mid.toISOString() },
      summary,
      hasMinimumData,
      analysis: aiPayload || null,
      aiError: aiError ? { ...aiError, userMessage: userFacingError(aiError.errorType) } : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[historical-comparison] fatal", e);
    return new Response(JSON.stringify({
      analysis: null,
      aiError: { errorType: "EDGE_FUNCTION_ERROR", message: String(e), userMessage: "Erro interno na função de análise." },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
