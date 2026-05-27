// Aggregates social_interactions for a single event broken down by Brazilian region.
// Returns per-region sentiment, engagement, top themes/words, timeline (before/during/after).
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

// Cities → UF (capitals + main metros) for text-based inference
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
  "para","como","mais","muito","pela","pelo","isso","essa","esse","esta","este","entre","sobre","quando","onde","tambem","também","presidente","candidato","candidata","brasil","politica","política","governo","partido","povo","gente","tudo","todos","todas","agora","hoje","ontem","sempre","nunca","assim","porque","mesmo","quem","vou","tem","tinha","foi","sao","são","dos","das","com","sem","por","seu","sua","meu","minha","nos","nas","que","dele","dela","aqui","ali","ainda","depois","antes","tao","tão","pouco","bom","boa","ruim","https","http","class","href","target","blank","nbsp",
]);

function normRegion(raw: string | null | undefined): Region | null {
  if (!raw) return null;
  const n = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (n.startsWith("nort") && !n.includes("este")) return "Norte";
  if (n.startsWith("nordest")) return "Nordeste";
  if (n.startsWith("centro")) return "Centro-Oeste";
  if (n.startsWith("sudest")) return "Sudeste";
  if (n.startsWith("sul")) return "Sul";
  return null;
}

function inferUFFromText(text: string): string | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Try city names first (more specific)
  for (const [city, uf] of Object.entries(CITY_TO_UF)) {
    if (t.includes(city)) return uf;
  }
  // Then UF codes as standalone tokens
  for (const uf of UFS) {
    const re = new RegExp(`(^|[^a-z0-9])${uf.toLowerCase()}([^a-z0-9]|$)`);
    if (re.test(t)) return uf;
  }
  return null;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9#@]{4,}/g) || [];
}

function topWords(texts: string[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const w of tokenize(t)) {
      if (STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
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

    // Load event
    const { data: event } = await admin.from("political_events").select("*").eq("id", eventId).eq("user_id", user.id).maybeSingle();
    if (!event) return new Response(JSON.stringify({ error: "Evento não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Cache check
    const cacheKey = `event_regional:${eventId}:${rangeDays}`;
    const { data: cached } = await admin.from("analysis_cache").select("result, expires_at").eq("cache_key", cacheKey).maybeSingle();
    if (cached && new Date(cached.expires_at) > new Date()) {
      return new Response(JSON.stringify({ ...cached.result, cached: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const eventDate = new Date(event.event_date);
    const start = new Date(eventDate.getTime() - 1 * 86400_000);
    const end = new Date(eventDate.getTime() + rangeDays * 86400_000);
    const keywords: string[] = Array.isArray(event.keywords) ? event.keywords.map((k: string) => String(k).toLowerCase().trim()).filter(Boolean) : [];

    // Pull comments paginated
    const all: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await admin
        .from("social_interactions")
        .select("comment_text, sentiment_label, likes_count, replies_count, shares_count, region, social_network, comment_author, created_at, original_posted_at")
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

    // Filter by event keywords (semantic match). Falls back to broader matching if too few.
    let comments = all;
    let usedFallback = false;
    if (keywords.length > 0) {
      const strict = all.filter((c) => {
        const t = (c.comment_text || "").toLowerCase();
        return keywords.some((k) => k.length >= 3 && t.includes(k));
      });
      if (strict.length >= 20) {
        comments = strict;
      } else {
        // Semantic fallback: split keywords into tokens and accept ANY token match
        const tokens = Array.from(new Set(keywords.flatMap(k => k.split(/[\s\-_/]+/)).filter(t => t.length >= 4)));
        const loose = all.filter((c) => {
          const t = (c.comment_text || "").toLowerCase();
          return tokens.some((k) => t.includes(k));
        });
        if (loose.length >= 10) {
          comments = loose;
          usedFallback = true;
        } else {
          // Last resort: use all candidate comments in window so map/insights are not empty
          comments = all;
          usedFallback = true;
        }
      }
    }

    // Build region + per-UF buckets
    type Bucket = { mentions: number; pos: number; neg: number; neu: number; engagement: number; texts: string[]; samples: any[] };
    const mkBucket = (): Bucket => ({ mentions: 0, pos: 0, neg: 0, neu: 0, engagement: 0, texts: [], samples: [] });
    const buckets: Record<Region, Bucket> = {
      Norte: mkBucket(), Nordeste: mkBucket(), "Centro-Oeste": mkBucket(),
      Sudeste: mkBucket(), Sul: mkBucket(),
    };
    const ufBuckets: Record<string, Bucket> = {};
    for (const uf of UFS) ufBuckets[uf] = mkBucket();
    let unmapped = 0;

    for (const c of comments) {
      const text = `${c.comment_text || ""} ${c.comment_author || ""}`;
      const uf = inferUFFromText(text);
      let region: Region | null = uf ? (UF_TO_REGION[uf] as Region) : normRegion(c.region);

      if (!region) { unmapped++; continue; }

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
        topWords: topWords(b.texts, 8),
        topComments: b.samples.sort((x, y) => y.likes - x.likes).slice(0, 5),
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
        topWords: topWords(b.texts, 6),
      };
    }


    // Timeline buckets per day
    const dayMap = new Map<string, { date: string; total: number; pos: number; neg: number; neu: number }>();
    for (const c of comments) {
      const ts = c.original_posted_at || c.created_at;
      if (!ts) continue;
      const day = String(ts).slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, { date: day, total: 0, pos: 0, neg: 0, neu: 0 });
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

    // Insights — populated whenever there's *any* data, using staggered thresholds
    const totalMentions = comments.length;
    const totalPos = REGIONS.reduce((s, r) => s + regions[r].positive, 0);
    const totalNeg = REGIONS.reduce((s, r) => s + regions[r].negative, 0);
    const overallAcceptance = totalPos + totalNeg > 0 ? Math.round((totalPos / (totalPos + totalNeg)) * 100) : 0;

    const rankedStrict = REGIONS.map((r) => regions[r]).filter((r) => r.mentions >= 5);
    const rankedLoose = REGIONS.map((r) => regions[r]).filter((r) => r.mentions >= 1);
    const ranked = rankedStrict.length ? rankedStrict : rankedLoose;
    const opinionRanked = ranked.filter(r => (r.positive + r.negative) >= 2);
    const mostEngaged = [...ranked].sort((a, b) => b.engagement - a.engagement)[0];
    const mostCritical = [...(opinionRanked.length ? opinionRanked : ranked)].sort((a, b) => a.acceptance - b.acceptance)[0];
    const mostFavorable = [...(opinionRanked.length ? opinionRanked : ranked)].sort((a, b) => b.acceptance - a.acceptance)[0];

    // Top growing theme = top word from the most engaged region (or all regions combined)
    const topThemePool = mostEngaged?.topWords?.length ? mostEngaged.topWords : ranked.flatMap(r => r.topWords);
    const topGrowingTheme = topThemePool[0] || null;

    // AI summary (best-effort, doesn't block response)
    let aiSummary = "";
    let aiAvailable = false;
    if (totalMentions >= 5) {
      try {
        const regionalLines = REGIONS
          .filter((r) => regions[r].mentions >= 3)
          .map((r) => `${r}: ${regions[r].mentions} menções, ${regions[r].acceptance}% aceitação, temas: ${regions[r].topWords.slice(0, 4).join(", ")}`)
          .join("\n");
        const ai = await callAICerebrasFirst({
          systemMsg: "Você é analista político brasileiro. Escreva SEMPRE em prosa natural, em português do Brasil, fluida e clara. NUNCA retorne JSON, chaves, colchetes, listas com bullet ou objetos — apenas parágrafos corridos. Máximo 5 frases.",
          userPrompt: `Evento: "${event.event_name}" (${event.event_type}) em ${eventDayStr}.
Total: ${totalMentions} menções. Aceitação geral: ${overallAcceptance}%.
Repercussão por região:
${regionalLines}

Escreva um resumo analítico em texto corrido (sem JSON, sem listas) sobre como o evento repercutiu nas diferentes regiões do Brasil. Destaque contrastes regionais reais, temas predominantes e onde houve mais aceitação ou rejeição. Máximo 5 frases. Não invente dados que não estão nas estatísticas acima.`,
          maxTokens: 500,
          temperature: 0.5,
          tag: "event-regional",
        });
        let raw = (ai.content || "").trim();
        // Strip accidental JSON wrappers like {"resumo":"..."} or ```json blocks
        raw = raw.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
        const jsonMatch = raw.match(/^\s*\{[\s\S]*"([^"]+)"\s*:\s*"([^]*?)"\s*\}\s*$/);
        if (jsonMatch) raw = jsonMatch[2];
        aiSummary = raw;
        aiAvailable = !!aiSummary;
      } catch (e) {
        console.warn("[analyze-event-regional] AI failed:", (e as Error).message);
      }
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
      },
      regions,
      states,
      timeline,
      insights: {
        mostEngaged: mostEngaged ? { region: mostEngaged.region, value: mostEngaged.engagement } : null,
        mostCritical: mostCritical ? { region: mostCritical.region, acceptance: mostCritical.acceptance } : null,
        mostFavorable: mostFavorable ? { region: mostFavorable.region, acceptance: mostFavorable.acceptance } : null,
        topGrowingTheme,
        aiSummary,
        aiAvailable,
      },
      cached: false,
    };

    // Cache 10 minutes
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
