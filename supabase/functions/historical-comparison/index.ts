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

async function callCerebras(prompt: string): Promise<any | null> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b",
        messages: [
          { role: "system", content: "Você é um analista político brasileiro experiente. Responda SEMPRE em português do Brasil, com profundidade analítica. Retorne APENAS JSON válido, sem markdown." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 4000,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[cerebras] error", res.status, txt);
      return { error: `Cerebras ${res.status}` };
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    try { return JSON.parse(content); } catch { return { summary: content }; }
  } catch (e) {
    console.error("[cerebras] exception", e);
    return { error: String(e) };
  }
}

async function callCerebrasFallback(prompt: string): Promise<any | null> {
  // fallback para Lovable AI Gateway
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um analista político brasileiro. Responda em português do Brasil, retorne APENAS JSON válido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { error: `Gateway ${res.status}` };
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    try { return JSON.parse(content); } catch { return { summary: content }; }
  } catch (e) { return { error: String(e) }; }
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

    const stats = {
      total_signals: hist.length + interactions.length + events.length,
      historical_records: hist.length,
      realtime_records: interactions.length,
      events: events.length,
      first_half: {
        label: `${ymd(start)} → ${ymd(mid)}`,
        mentions: sumOf(histFirst, "mentions") + intFirst.length,
        positive: sumOf(histFirst, "sentiment_positive") + intFirst.filter(i => i.sentiment_label === "positive").length,
        negative: sumOf(histFirst, "sentiment_negative") + intFirst.filter(i => i.sentiment_label === "negative").length,
        neutral: sumOf(histFirst, "sentiment_neutral") + intFirst.filter(i => i.sentiment_label === "neutral").length,
        top_themes: themesFirst.slice(0, 6),
        events: evtFirst.slice(0, 10).map(e => ({ name: e.event_name, date: e.event_date, type: e.event_type, location: e.location })),
      },
      second_half: {
        label: `${ymd(mid)} → ${ymd(end)}`,
        mentions: sumOf(histSecond, "mentions") + intSecond.length,
        positive: sumOf(histSecond, "sentiment_positive") + intSecond.filter(i => i.sentiment_label === "positive").length,
        negative: sumOf(histSecond, "sentiment_negative") + intSecond.filter(i => i.sentiment_label === "negative").length,
        neutral: sumOf(histSecond, "sentiment_neutral") + intSecond.filter(i => i.sentiment_label === "neutral").length,
        top_themes: themesSecond.slice(0, 6),
        events: evtSecond.slice(0, 10).map(e => ({ name: e.event_name, date: e.event_date, type: e.event_type, location: e.location })),
      },
      sample_titles: hist.slice(0, 25).map(() => null), // placeholder
      sample_comments: enrichedInt.slice(0, 30).map((i: any) => ({ text: (i.comment_text || "").slice(0, 200), sentiment: i.sentiment_label, themes: i.themes, region: i.region })),
    };

    const hasMinimumData = stats.total_signals >= 5;

    const prompt = `Analise a evolução da percepção pública do candidato político brasileiro a seguir entre ${ymd(start)} e ${ymd(end)}.

CANDIDATO: ${cand.full_name}${cand.party ? ` (${cand.party})` : ""}${cand.region ? ` — ${cand.region}` : ""}
CADASTRADO NA PLATAFORMA EM: ${ymd(candCreated)}
DADOS DISPONÍVEIS NO PERÍODO:
${JSON.stringify(stats, null, 0)}

Sintetize o contexto, identifique mudanças e padrões. Mesmo com poucos dados, produza análise útil baseada no que existe (nunca diga "insuficiente", "—" ou "0"; se houver pouco volume, diga: "dados limitados; análise baseada nas informações disponíveis").

Retorne JSON ESTRITAMENTE neste formato:
{
  "summary": "parágrafo narrativo de 4-8 frases descrevendo a evolução da percepção pública ao longo do período (volume, sentimento, narrativas, regiões, eventos). Cite fatos concretos quando possível.",
  "detectedChanges": [
    { "type": "growth_support | rejection_increase | polarization | regional_shift | thematic_shift | narrative_shift | event_impact", "title": "título curto", "description": "explicação em 1-2 frases" }
  ],
  "narratives": {
    "early": { "label": "narrativa predominante no início do período", "evidence": "evidência curta" },
    "late": { "label": "narrativa predominante no fim do período", "evidence": "evidência curta" }
  },
  "perceptionShifts": [
    { "group": "grupo afetado (jovens, eleitorado X, região Y)", "shift": "descrição da mudança" }
  ],
  "associatedEvents": [
    { "name": "nome do evento", "date": "AAAA-MM-DD", "type": "debate|entrevista|discurso|notícia|outro", "impact": "como afetou a percepção" }
  ],
  "dominantThemesByPeriod": {
    "early": ["tema1", "tema2", "tema3"],
    "late": ["tema1", "tema2", "tema3"]
  },
  "dataNote": "frase curta sobre completude (ex: 'Análise baseada em X menções e Y eventos' ou 'Dados limitados para este período; análise baseada nas informações disponíveis.')"
}`;

    let ai = await callCerebras(prompt);
    if (!ai || ai.error) {
      console.warn("[historical-comparison] cerebras falhou, fallback gateway", ai?.error);
      ai = await callCerebrasFallback(prompt);
    }
    if (!ai) ai = { summary: "Não foi possível gerar a análise no momento. Tente novamente.", dataNote: "Análise indisponível." };

    return new Response(JSON.stringify({
      candidate: { id: cand.id, name: cand.full_name, createdAt: cand.created_at, party: cand.party, region: cand.region },
      period: { start: startDate, end: endDate, mid: mid.toISOString() },
      stats,
      hasMinimumData,
      analysis: ai,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[historical-comparison] error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
