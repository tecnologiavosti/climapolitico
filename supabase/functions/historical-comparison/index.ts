// Comparação Histórica IA — agrega dois períodos arbitrários para um candidato
// e gera análise narrativa com Lovable AI Gateway.
// Body: { candidateId, periodA: { start, end }, periodB: { start, end } }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";

interface Article { url: string; title: string; seendate: string; domain?: string; tone?: number }

const MIN_VOLUME_FULL = 30;
const MIN_VOLUME_PARTIAL = 5;

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

function detectThemes(text: string): string[] {
  const t = text.toLowerCase();
  const themes: string[] = [];
  const map: Record<string, RegExp> = {
    "Economia": /(economia|emprego|inflação|preço|renda|salário|juros|pib|custo de vida)/,
    "Segurança pública": /(segurança|crime|violência|polícia|tráfico|assalto|homicídio)/,
    "Saúde": /(saúde|hospital|sus|médico|vacina|remédio)/,
    "Educação": /(educação|escola|professor|aluno|ensino|universidade|enem)/,
    "Corrupção": /(corrupção|propina|desvio|fraude|rachadinha|lava jato)/,
    "Impostos": /(imposto|tributo|taxa|arrecadação)/,
    "Meio ambiente": /(meio ambiente|amazônia|clima|desmatamento|queimada|enchente)/,
    "Programas sociais": /(bolsa família|auxílio|benefício|pobreza|fome|cadúnico)/,
  };
  for (const [k, re] of Object.entries(map)) if (re.test(t)) themes.push(k);
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

async function collectHistorical(supabase: any, userId: string, candidateId: string, fullName: string, start: Date, end: Date) {
  // Coleta GDELT no intervalo e persiste agregado diário em historical_mentions
  const articles = await fetchGdeltRange(`"${fullName}"`, start, end);
  const buckets: Record<string, { mentions: number; tone: number; toneN: number; themes: Set<string> }> = {};
  for (const a of articles) {
    if (!a.title || !nameMatches(a.title, fullName)) continue;
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
      user_id: userId,
      candidate_id: candidateId,
      date,
      platform: "gdelt_news",
      mentions: b.mentions,
      engagement: 0,
      sentiment_positive: pos,
      sentiment_negative: neg,
      sentiment_neutral: neu,
      themes: Array.from(b.themes),
      source: "historical_fetch",
    };
  });
  if (rows.length > 0) {
    await supabase.from("historical_mentions").upsert(rows, { onConflict: "candidate_id,date,platform,source", ignoreDuplicates: false });
  }
  return rows.length;
}

function completeness(total: number): "full" | "partial" | "insufficient" {
  if (total >= MIN_VOLUME_FULL) return "full";
  if (total >= MIN_VOLUME_PARTIAL) return "partial";
  return "insufficient";
}

async function generateAiAnalysis(candidateName: string, periodA: any, periodB: any, aggA: any, aggB: any): Promise<any> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  const prompt = `Você é analista político brasileiro. Compare dois períodos para o candidato ${candidateName}.

PERÍODO A (${periodA.start} a ${periodA.end}):
${JSON.stringify(aggA, null, 0)}

PERÍODO B (${periodB.start} a ${periodB.end}):
${JSON.stringify(aggB, null, 0)}

Responda APENAS com JSON válido (sem markdown), no formato:
{
  "summary": "parágrafo narrativo em português comparando os dois períodos (volume, sentimento, temas, regiões)",
  "insights": ["insight 1", "insight 2", "insight 3"],
  "themeShift": "como os temas dominantes mudaram",
  "regionalShift": "como a distribuição regional mudou",
  "sentimentShift": "como o sentimento mudou",
  "alerts": ["alerta 1 (opcional)"]
}
Nunca invente dados — baseie-se apenas nos números fornecidos. Se um período tiver volume muito baixo, diga isso.`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { error: `IA respondeu ${res.status}` };
    const json = await res.json();
    const txt = json?.choices?.[0]?.message?.content ?? "";
    try { return JSON.parse(txt); } catch { return { summary: txt }; }
  } catch (e) {
    return { error: String(e) };
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
    const periodA = body.periodA;
    const periodB = body.periodB;
    if (!candidateId || !periodA?.start || !periodA?.end || !periodB?.start || !periodB?.end) {
      return new Response(JSON.stringify({ error: "candidateId, periodA, periodB são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: cand, error: candErr } = await supabase
      .from("candidates")
      .select("id, full_name, user_id, created_at")
      .eq("id", candidateId)
      .maybeSingle();
    if (candErr || !cand) return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const candCreated = new Date(cand.created_at);

    // Para cada período, se houver janela anterior ao cadastro, dispara coleta histórica
    async function ensureHistorical(period: { start: string; end: string }) {
      const start = new Date(period.start);
      const end = new Date(period.end);
      if (end < candCreated) {
        // intervalo totalmente histórico — coleta a janela inteira
        return await collectHistorical(supabase, cand.user_id, cand.id, cand.full_name, start, end);
      }
      if (start < candCreated) {
        // intervalo parcialmente histórico — coleta a parte anterior
        const partialEnd = new Date(Math.min(end.getTime(), candCreated.getTime()));
        return await collectHistorical(supabase, cand.user_id, cand.id, cand.full_name, start, partialEnd);
      }
      return 0;
    }

    const [, , aggARes, aggBRes] = await Promise.all([
      ensureHistorical(periodA),
      ensureHistorical(periodB),
      supabase.rpc("get_historical_period_aggregate", {
        _user_id: cand.user_id,
        _candidate_id: cand.id,
        _period_start: periodA.start,
        _period_end: periodA.end,
      }),
      supabase.rpc("get_historical_period_aggregate", {
        _user_id: cand.user_id,
        _candidate_id: cand.id,
        _period_start: periodB.start,
        _period_end: periodB.end,
      }),
    ]);

    const aggA = aggARes.data || {};
    const aggB = aggBRes.data || {};

    const totalA = Number(aggA.totalMentions || 0);
    const totalB = Number(aggB.totalMentions || 0);

    const completenessA = completeness(totalA);
    const completenessB = completeness(totalB);

    const deltaMentionsPct = totalA > 0 ? Math.round(((totalB - totalA) / totalA) * 100) : (totalB > 0 ? 100 : 0);

    const aiAnalysis = (completenessA !== "insufficient" && completenessB !== "insufficient")
      ? await generateAiAnalysis(cand.full_name, periodA, periodB, aggA, aggB)
      : { summary: "Dados históricos insuficientes para análise completa em pelo menos um dos períodos selecionados." };

    return new Response(JSON.stringify({
      candidate: { id: cand.id, name: cand.full_name, createdAt: cand.created_at },
      periodA: { ...periodA, ...aggA, completeness: completenessA },
      periodB: { ...periodB, ...aggB, completeness: completenessB },
      deltas: { mentionsPct: deltaMentionsPct, mentionsAbs: totalB - totalA },
      aiAnalysis,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[historical-comparison] error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
