// Aggregates social_interactions for a single event, filtering comments via
// per-event semantic scoring (keywords + title tokens + temporal proximity).
// Returns per-region sentiment, engagement, top themes/words, timeline, and
// a debug payload with traceability info.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UF_TO_REGION: Record<string, string> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

const UFS = Object.keys(UF_TO_REGION);
const UF_NAME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará",
  PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima",
  SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

const CITY_TO_UF: Record<string, string> = {
  "rio branco":"AC","maceio":"AL","macapa":"AP","manaus":"AM","salvador":"BA",
  "fortaleza":"CE","brasilia":"DF","vitoria":"ES","goiania":"GO","sao luis":"MA",
  "cuiaba":"MT","campo grande":"MS","belo horizonte":"MG","belem":"PA",
  "joao pessoa":"PB","curitiba":"PR","recife":"PE","teresina":"PI",
  "rio de janeiro":"RJ","natal":"RN","porto alegre":"RS","porto velho":"RO",
  "boa vista":"RR","florianopolis":"SC","sao paulo":"SP","aracaju":"SE","palmas":"TO",
  "campinas":"SP","guarulhos":"SP","santos":"SP","sorocaba":"SP","ribeirao preto":"SP",
  "niteroi":"RJ","duque de caxias":"RJ","nova iguacu":"RJ","sao goncalo":"RJ",
  "uberlandia":"MG","contagem":"MG","juiz de fora":"MG","betim":"MG",
  "londrina":"PR","maringa":"PR","foz do iguacu":"PR",
  "caxias do sul":"RS","pelotas":"RS","canoas":"RS",
  "joinville":"SC","blumenau":"SC","chapeco":"SC",
  "feira de santana":"BA","caruaru":"PE","olinda":"PE","petrolina":"PE",
  "anapolis":"GO",
};

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
type Region = typeof REGIONS[number];

const STOP = new Set([
  "para","como","mais","muito","pela","pelo","isso","essa","esse","esta","este","entre","sobre","quando","onde","tambem","também","presidente","candidato","candidata","brasil","politica","política","governo","partido","povo","gente","tudo","todos","todas","agora","hoje","ontem","sempre","nunca","assim","porque","mesmo","quem","vou","tem","tinha","foi","sao","são","dos","das","com","sem","por","seu","sua","meu","minha","nos","nas","que","dele","dela","aqui","ali","ainda","depois","antes","tao","tão","pouco","bom","boa","ruim","https","http","class","href","target","blank","nbsp","anos","ano","mes","mês","dia","dias","vez","vezes","ver","sera","será",
]);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function normRegion(raw: string | null | undefined): Region | null {
  if (!raw) return null;
  const n = norm(raw).trim();
  if (n.startsWith("nort") && !n.includes("este")) return "Norte";
  if (n.startsWith("nordest")) return "Nordeste";
  if (n.startsWith("centro")) return "Centro-Oeste";
  if (n.startsWith("sudest")) return "Sudeste";
  if (n.startsWith("sul")) return "Sul";
  return null;
}

function inferUFFromText(text: string): string | null {
  const t = norm(text);
  for (const [city, uf] of Object.entries(CITY_TO_UF)) {
    if (t.includes(city)) return uf;
  }
  for (const uf of UFS) {
    const re = new RegExp(`(^|[^a-z0-9])${uf.toLowerCase()}([^a-z0-9]|$)`);
    if (re.test(t)) return uf;
  }
  return null;
}

function tokenize(text: string): string[] {
  return norm(text).match(/[a-z0-9#@]{4,}/g) || [];
}

function topWords(texts: string[], excluded: Set<string>, n = 8): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const w of tokenize(t)) {
      if (STOP.has(w) || excluded.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w.replace(/^#/, ""));
}

function sentKey(s: string | null | undefined): "pos" | "neg" | "neu" | null {
  if (!s) return null;
  const k = s.toLowerCase();
  if (k === "positivo" || k === "positive") return "pos";
  if (k === "negativo" || k === "negative") return "neg";
  if (k === "neutro" || k === "neutral") return "neu";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const { eventId, rangeDays = 7 } = body || {};
    if (!eventId) return new Response(JSON.stringify({ error: "eventId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: event } = await admin.from("political_events").select("*").eq("id", eventId).eq("user_id", user.id).maybeSingle();
    if (!event) return new Response(JSON.stringify({ error: "Evento não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load candidate name to exclude from keyword/word-cloud noise
    const { data: candidate } = await admin.from("candidates").select("full_name").eq("id", event.candidate_id).maybeSingle();
    const candidateName = candidate?.full_name || "";
    const candidateTokens = new Set(tokenize(candidateName));

    // Cache check (v2 namespace because filtering logic changed)
    const cacheKey = `event_regional_v2:${eventId}:${rangeDays}`;
    const { data: cached } = await admin.from("analysis_cache").select("result, expires_at").eq("cache_key", cacheKey).maybeSingle();
    if (cached && new Date(cached.expires_at) > new Date()) {
      return new Response(JSON.stringify({ ...cached.result, cached: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const eventDate = new Date(event.event_date);
    const start = new Date(eventDate.getTime() - 3 * 86400_000);
    const end = new Date(eventDate.getTime() + Math.max(3, rangeDays) * 86400_000);

    // Build keyword + title-token corpus
    const rawKeywords: string[] = Array.isArray(event.keywords)
      ? event.keywords.map((k: string) => norm(String(k)).trim()).filter(Boolean)
      : [];
    const titleTokens = tokenize(event.event_name || "")
      .filter(t => !STOP.has(t) && !candidateTokens.has(t) && t.length >= 4);
    const keywordPhrases = rawKeywords.filter(k => k.length >= 3 && !candidateTokens.has(k));
    const keywordTokens = Array.from(new Set(
      rawKeywords.flatMap(k => k.split(/[\s\-_/]+/))
        .map(t => norm(t))
        .filter(t => t.length >= 4 && !STOP.has(t) && !candidateTokens.has(t))
    ));
    const allMatchTokens = Array.from(new Set([...titleTokens, ...keywordTokens]));

    // Pull comments paginated within the temporal window
    const all: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await admin
        .from("social_interactions")
        .select("id, comment_text, sentiment_label, likes_count, replies_count, shares_count, region, social_network, comment_author, created_at, original_posted_at")
        .eq("candidate_id", event.candidate_id)
        .or(`and(original_posted_at.gte.${start.toISOString()},original_posted_at.lte.${end.toISOString()}),and(original_posted_at.is.null,created_at.gte.${start.toISOString()},created_at.lte.${end.toISOString()})`)
        .order("original_posted_at", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);
      if (error || !data || !data.length) break;
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
      if (all.length >= 30000) break;
    }

    // ============= EVENT-MENTION SCORING =============
    // For each candidate comment, compute association score against THIS event.
    // Include only those above threshold.
    const eventDayMs = eventDate.getTime();
    type Scored = { c: any; score: number; matchedKeywords: string[]; matchedTokens: string[]; ufInferred: string | null };
    const scored: Scored[] = [];
    let kwTotal = 0, kwHits = 0;

    for (const c of all) {
      const text = norm(`${c.comment_text || ""} ${c.comment_author || ""}`);
      if (!text.trim()) continue;

      const matchedKeywords: string[] = [];
      for (const k of keywordPhrases) {
        if (k.length >= 3 && text.includes(k)) matchedKeywords.push(k);
      }
      const matchedTokens: string[] = [];
      for (const t of allMatchTokens) {
        if (text.includes(t)) matchedTokens.push(t);
      }

      let score = 0;
      score += matchedKeywords.length * 3;
      score += matchedTokens.length * 1;

      // Temporal proximity boost
      const ts = c.original_posted_at || c.created_at;
      if (ts) {
        const dt = Math.abs(new Date(ts).getTime() - eventDayMs) / 86400_000;
        if (dt <= 1) score += 2;
        else if (dt <= 3) score += 1;
        else if (dt <= 7) score += 0.5;
      }

      // Require at least one explicit keyword OR title-token match
      const hasExplicitMatch = matchedKeywords.length > 0 || matchedTokens.length > 0;
      if (!hasExplicitMatch) continue;
      if (score < 2) continue;

      kwTotal += score;
      kwHits++;
      scored.push({
        c,
        score,
        matchedKeywords,
        matchedTokens,
        ufInferred: inferUFFromText(`${c.comment_text || ""} ${c.comment_author || ""}`),
      });
    }

    const comments = scored;
    const usedFallback = false; // No more last-resort "use all candidate comments"
    const avgScore = kwHits ? kwTotal / kwHits : 0;

    // ============= REGION + UF BUCKETS =============
    type Bucket = { mentions: number; pos: number; neg: number; neu: number; engagement: number; texts: string[]; samples: any[] };
    const mkBucket = (): Bucket => ({ mentions: 0, pos: 0, neg: 0, neu: 0, engagement: 0, texts: [], samples: [] });
    const buckets: Record<Region, Bucket> = {
      Norte: mkBucket(), Nordeste: mkBucket(), "Centro-Oeste": mkBucket(),
      Sudeste: mkBucket(), Sul: mkBucket(),
    };
    const ufBuckets: Record<string, Bucket> = {};
    for (const uf of UFS) ufBuckets[uf] = mkBucket();
    let unmapped = 0;
    const matchedKwSet = new Set<string>();
    const matchedTokenSet = new Set<string>();
    const regionsFound = new Set<string>();

    for (const sc of comments) {
      const c = sc.c;
      sc.matchedKeywords.forEach(k => matchedKwSet.add(k));
      sc.matchedTokens.forEach(t => matchedTokenSet.add(t));

      const uf = sc.ufInferred;
      const region: Region | null = uf ? (UF_TO_REGION[uf] as Region) : normRegion(c.region);
      if (!region) { unmapped++; continue; }
      regionsFound.add(region);

      const b = buckets[region];
      const s = sentKey(c.sentiment_label);
      const eng = (c.likes_count || 0) + (c.replies_count || 0) + (c.shares_count || 0);
      b.mentions++;
      if (s === "pos") b.pos++; else if (s === "neg") b.neg++; else if (s === "neu") b.neu++;
      b.engagement += eng;
      if (c.comment_text && b.texts.length < 200) b.texts.push(String(c.comment_text).slice(0, 300));
      if (c.comment_text && b.samples.length < 8) b.samples.push({
        text: String(c.comment_text).slice(0, 280),
        sentiment: c.sentiment_label,
        network: c.social_network,
        likes: c.likes_count || 0,
        date: c.original_posted_at || c.created_at,
        score: sc.score,
      });

      if (uf) {
        const ub = ufBuckets[uf];
        ub.mentions++;
        if (s === "pos") ub.pos++; else if (s === "neg") ub.neg++; else if (s === "neu") ub.neu++;
        ub.engagement += eng;
        if (c.comment_text && ub.texts.length < 60) ub.texts.push(String(c.comment_text).slice(0, 220));
      }
    }

    const classify = (mentions: number, acceptance: number, opin: number) => {
      if (mentions < 3) return "insufficient";
      if (opin < 2) return "mixed";
      if (acceptance >= 75) return "very_positive";
      if (acceptance >= 55) return "positive";
      if (acceptance >= 40) return "mixed";
      if (acceptance >= 25) return "negative";
      return "very_negative";
    };

    const excludedWords = new Set<string>([...candidateTokens, ...STOP]);
    const regions: Record<string, any> = {};
    for (const r of REGIONS) {
      const b = buckets[r];
      const opin = b.pos + b.neg;
      const acceptance = opin > 0 ? Math.round((b.pos / opin) * 100) : 0;
      const sc = classify(b.mentions, acceptance, opin);
      regions[r] = {
        region: r,
        mentions: b.mentions,
        positive: b.pos,
        negative: b.neg,
        neutral: b.neu,
        engagement: b.engagement,
        acceptance,
        sentiment_class: sc === "insufficient" ? "insufficient"
          : sc === "very_positive" || sc === "positive" ? "positive"
          : sc === "very_negative" || sc === "negative" ? "negative" : "mixed",
        topWords: topWords(b.texts, excludedWords, 8),
        topComments: b.samples.sort((x, y) => (y.likes - x.likes) || (y.score - x.score)).slice(0, 5),
      };
    }

    const states: Record<string, any> = {};
    for (const uf of UFS) {
      const b = ufBuckets[uf];
      const opin = b.pos + b.neg;
      const acceptance = opin > 0 ? Math.round((b.pos / opin) * 100) : 0;
      states[uf] = {
        uf,
        name: UF_NAME[uf],
        region: UF_TO_REGION[uf],
        mentions: b.mentions,
        positive: b.pos,
        negative: b.neg,
        neutral: b.neu,
        engagement: b.engagement,
        acceptance,
        sentiment_class: classify(b.mentions, acceptance, opin),
        topWords: topWords(b.texts, excludedWords, 6),
      };
    }

    // ============= TIMELINE: event_date -3 → +3 only =============
    const tStart = new Date(eventDate.getTime() - 3 * 86400_000);
    const tEnd = new Date(eventDate.getTime() + 3 * 86400_000);
    const dayMap = new Map<string, { date: string; total: number; pos: number; neg: number; neu: number }>();
    // Pre-seed all 7 days so timeline is always continuous
    for (let i = -3; i <= 3; i++) {
      const d = new Date(eventDate.getTime() + i * 86400_000).toISOString().slice(0, 10);
      dayMap.set(d, { date: d, total: 0, pos: 0, neg: 0, neu: 0 });
    }
    for (const sc of comments) {
      const c = sc.c;
      const ts = c.original_posted_at || c.created_at;
      if (!ts) continue;
      const tsDate = new Date(ts);
      if (tsDate < tStart || tsDate > tEnd) continue;
      const day = String(ts).slice(0, 10);
      if (!dayMap.has(day)) continue;
      const d = dayMap.get(day)!;
      d.total++;
      const s = sentKey(c.sentiment_label);
      if (s === "pos") d.pos++;
      else if (s === "neg") d.neg++;
      else if (s === "neu") d.neu++;
    }
    const eventDayStr = eventDate.toISOString().slice(0, 10);
    const timeline = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
      ...d,
      phase: d.date < eventDayStr ? "antes" : d.date === eventDayStr ? "durante" : "depois",
    }));

    // ============= TOTALS + INSIGHTS WITH STRICT THRESHOLDS =============
    const totalMentions = comments.length;
    const totalPos = REGIONS.reduce((s, r) => s + regions[r].positive, 0);
    const totalNeg = REGIONS.reduce((s, r) => s + regions[r].negative, 0);
    const overallAcceptance = totalPos + totalNeg > 0 ? Math.round((totalPos / (totalPos + totalNeg)) * 100) : 0;

    // Mentions threshold for confident region-level insights
    const STRONG_THRESHOLD = 30;
    const ROBUST_THRESHOLD = 100;
    const canShowRegionInsights = totalMentions >= STRONG_THRESHOLD;

    const opinionRanked = REGIONS
      .map((r) => regions[r])
      .filter((r) => (r.positive + r.negative) >= 3);

    // Most critical: max negative ratio. Most favorable: max positive ratio. Force distinct.
    const withRatios = opinionRanked.map((r) => {
      const opin = r.positive + r.negative;
      return {
        region: r.region,
        engagement: r.engagement,
        acceptance: r.acceptance,
        negRatio: opin > 0 ? r.negative / opin : 0,
        posRatio: opin > 0 ? r.positive / opin : 0,
        opin,
      };
    });

    let mostCritical: { region: string; acceptance: number } | null = null;
    let mostFavorable: { region: string; acceptance: number } | null = null;
    if (canShowRegionInsights && withRatios.length > 0) {
      const byNeg = [...withRatios].sort((a, b) => b.negRatio - a.negRatio || a.posRatio - b.posRatio);
      const byPos = [...withRatios].sort((a, b) => b.posRatio - a.posRatio || a.negRatio - b.negRatio);
      const crit = byNeg[0];
      let fav = byPos[0];
      if (fav && crit && fav.region === crit.region) {
        // Avoid same-region tie: pick the next favorable
        fav = byPos.find((x) => x.region !== crit.region) || null as any;
      }
      mostCritical = crit ? { region: crit.region, acceptance: crit.acceptance } : null;
      mostFavorable = fav ? { region: fav.region, acceptance: fav.acceptance } : null;
    }

    const mostEngaged = canShowRegionInsights
      ? [...withRatios].sort((a, b) => b.engagement - a.engagement)[0] || null
      : null;

    const topGrowingTheme = canShowRegionInsights
      ? (mostEngaged?.region && regions[mostEngaged.region]?.topWords?.[0]) || null
      : null;

    // ============= CONFIDENCE =============
    const regionsWith10 = REGIONS.filter((r) => regions[r].mentions >= 10).length;
    const daysWithData = timeline.filter((d) => d.total > 0).length;
    let volScore = totalMentions >= 200 ? 2 : totalMentions >= 50 ? 1 : 0;
    let regScore = regionsWith10 >= 3 ? 2 : regionsWith10 >= 2 ? 1 : 0;
    let tempScore = daysWithData >= 5 ? 2 : daysWithData >= 3 ? 1 : 0;
    const confTotal = volScore + regScore + tempScore;
    const confidence: "Alta" | "Média" | "Baixa" = confTotal >= 5 ? "Alta" : confTotal >= 3 ? "Média" : "Baixa";

    // ============= AI SUMMARY (constrained) =============
    let aiSummary = "";
    let aiAvailable = false;
    if (totalMentions >= STRONG_THRESHOLD) {
      try {
        const regionalLines = REGIONS
          .filter((r) => regions[r].mentions >= 3)
          .map((r) => `${r}: ${regions[r].mentions} menções, ${regions[r].acceptance}% aceitação, temas: ${regions[r].topWords.slice(0, 4).join(", ")}`)
          .join("\n");
        const sampleNote = totalMentions < ROBUST_THRESHOLD ? "\n[Aviso: amostra pequena — registre limitação estatística no texto.]" : "";
        const ai = await callAICerebrasFirst({
          systemMsg: "Você é analista político brasileiro. Analise APENAS os comentários relacionados ao evento fornecido. NÃO faça inferências sem evidência explícita nos dados estatísticos abaixo. Se a amostra for pequena, informe a limitação. Escreva em prosa natural, português do Brasil, sem JSON, listas ou bullets. Máximo 5 frases.",
          userPrompt: `Evento: "${event.event_name}" (${event.event_type}) em ${eventDayStr}.
Total de menções associadas ao evento: ${totalMentions}. Aceitação geral: ${overallAcceptance}%.
Repercussão por região:
${regionalLines}${sampleNote}

Escreva um resumo analítico em texto corrido baseado SOMENTE nos números acima.`,
          maxTokens: 500,
          temperature: 0.3,
          tag: "event-regional",
        });
        let raw = (ai.content || "").trim();
        raw = raw.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
        const jsonMatch = raw.match(/^\s*\{[\s\S]*"([^"]+)"\s*:\s*"([^]*?)"\s*\}\s*$/);
        if (jsonMatch) raw = jsonMatch[2];
        aiSummary = raw;
        aiAvailable = !!aiSummary;
      } catch (e) {
        console.warn("[analyze-event-regional] AI failed:", (e as Error).message);
      }
    } else {
      aiSummary = "Dados insuficientes para análise IA confiável (mínimo de 30 menções associadas ao evento).";
    }

    const result = {
      event: {
        id: event.id,
        name: event.event_name,
        type: event.event_type,
        date: event.event_date,
        description: event.description,
        keywords: event.keywords,
      },
      totals: {
        mentions: totalMentions,
        acceptance: overallAcceptance,
        positive: totalPos,
        negative: totalNeg,
        unmapped,
        coverage: totalMentions > 0 ? Math.round(((totalMentions - unmapped) / totalMentions) * 100) : 0,
        usedSemanticFallback: usedFallback,
        candidatePoolSize: all.length,
      },
      regions,
      states,
      timeline,
      insights: {
        mostEngaged: mostEngaged ? { region: mostEngaged.region, value: mostEngaged.engagement } : null,
        mostCritical,
        mostFavorable,
        topGrowingTheme,
        aiSummary,
        aiAvailable,
      },
      thresholds: {
        strong: STRONG_THRESHOLD,
        robust: ROBUST_THRESHOLD,
        canShowRegionInsights,
        isRobust: totalMentions >= ROBUST_THRESHOLD,
      },
      confidence: {
        level: confidence,
        score: confTotal,
        breakdown: {
          volume: { score: volScore, value: totalMentions },
          regionalDiversity: { score: regScore, value: regionsWith10 },
          temporalSpread: { score: tempScore, value: daysWithData },
        },
      },
      debug: {
        candidatePoolSize: all.length,
        associatedMentions: totalMentions,
        avgAssociationScore: Number(avgScore.toFixed(2)),
        matchedKeywords: [...matchedKwSet].slice(0, 30),
        matchedTokens: [...matchedTokenSet].slice(0, 30),
        regionsFound: [...regionsFound],
        eventWindow: { start: start.toISOString(), end: end.toISOString() },
      },
      cached: false,
    };

    try {
      await admin.from("analysis_cache").upsert({
        cache_key: cacheKey,
        analysis_type: "event_regional",
        result,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        last_hit_at: new Date().toISOString(),
        hit_count: 0,
      }, { onConflict: "cache_key" });
    } catch (e) { console.warn("cache upsert failed", (e as Error).message); }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[analyze-event-regional] error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
