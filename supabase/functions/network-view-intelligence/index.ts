// network-view-intelligence
// Analisa textos coletados do período e devolve tópicos + termos.
// NÃO inventa distribuição por rede, séries temporais, persona ou cenário histórico.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TopicRow = { label: string; theme: string; mentions: number; pos: number; neg: number; neu: number; relevance: number };
type TermRow = { term: string; count: number; kind: "hashtag" | "entity" };

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STOPWORDS = new Set([
  "de","da","do","das","dos","a","o","e","é","em","um","uma","para","com","no","na","nos","nas","que","se","por","ao","aos","como","mais","mas","ou","já","foi","ser","sobre","ele","ela","eles","elas","isso","esse","essa","este","esta","quando","onde","sim","não","nao","sua","seu","suas","seus","vai","tem","teve","ter","só","so","muito","pelo","pela","entre","até","ate","você","voce","vocês","voces","disse","afirmou","falou","após","apos","ainda","também","tambem","sobre","após","quem","qual","quais","todos","todas","cada","mesmo","mesma","cenário","cenario","contexto","notícia","noticia","política","politica","político","politico","brasil",
  "https","http","com","br","www","amp","href","html","span","div","class","src","img","google","news","facebook","youtube","instagram","telegram","twitter","reddit","linkedin","tiktok","whatsapp","threads","kwai",
]);

function normalize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function cleanText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localExtractTerms(samples: string[]): TermRow[] {
  const hash: Record<string, number> = {};
  const ent: Record<string, number> = {};
  const hashRe = /#([\p{L}\p{N}_]{2,})/gu;
  for (const raw of samples) {
    const t = cleanText(raw);
    if (!t) continue;
    let m: RegExpExecArray | null;
    while ((m = hashRe.exec(t)) !== null) {
      const k = "#" + normalize(m[1]);
      if (k.length < 3) continue;
      hash[k] = (hash[k] ?? 0) + 1;
    }
    // entidades: palavras capitalizadas consecutivas
    const entRe = /\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]+){0,3})\b/gu;
    while ((m = entRe.exec(t)) !== null) {
      const phrase = m[1].trim();
      const norm = normalize(phrase);
      if (norm.length < 4) continue;
      if (STOPWORDS.has(norm)) continue;
      if (norm.split(" ").every((w) => STOPWORDS.has(w))) continue;
      ent[phrase] = (ent[phrase] ?? 0) + 1;
    }
  }
  const top = (obj: Record<string, number>, n: number, kind: "hashtag" | "entity"): TermRow[] =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([term, count]) => ({ term, count, kind }));
  return [...top(hash, 10, "hashtag"), ...top(ent, 20, "entity")].slice(0, 25);
}

async function aiExtractTopicsAndTerms(samples: string[], candidateName: string | null) {
  if (!LOVABLE_API_KEY) return null;
  const corpus = samples.map((s, i) => `${i + 1}. ${cleanText(s).slice(0, 280)}`).join("\n").slice(0, 12000);
  const sys = `Você é analista político brasileiro. Recebe trechos REAIS coletados de redes sociais e notícias num período específico.
Extraia ESTRITAMENTE o que aparece nos textos. NÃO invente temas. NÃO use placeholders genéricos como "Economia", "Congresso", "Oposição" se não estiverem nos trechos.
Devolva JSON com:
- topics: até 8 temas detectados no período (label curto e específico ao conteúdo, mentions inteiro, pos/neg/neu inteiros somando ~mentions, relevance 0-100)
- terms: até 20 entidades/hashtags reais (term, count inteiro, kind "hashtag" se começa com #, senão "entity")
Preserve nomes próprios completos ("Mato Grosso", "Jayme Campos", "BR-163"). Português brasileiro.`;
  const usr = `Candidato: ${candidateName ?? "(não informado)"}
Trechos coletados:
${corpus}

Responda SOMENTE com JSON válido no formato:
{"topics":[{"label":"...","mentions":N,"pos":N,"neg":N,"neu":N,"relevance":N}], "terms":[{"term":"...","count":N,"kind":"hashtag|entity"}]}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    console.error("AI gateway error", resp.status, await resp.text());
    return null;
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    const topics: TopicRow[] = (parsed.topics ?? []).map((t: any) => ({
      label: String(t.label ?? t.theme ?? t.topic ?? "").trim(),
      theme: String(t.label ?? t.theme ?? t.topic ?? "").trim(),
      mentions: Number(t.mentions ?? 0),
      pos: Number(t.pos ?? 0),
      neg: Number(t.neg ?? 0),
      neu: Number(t.neu ?? 0),
      relevance: Number(t.relevance ?? 0),
    })).filter((t: TopicRow) => t.label.length > 1);
    const terms: TermRow[] = (parsed.terms ?? []).map((t: any) => ({
      term: String(t.term ?? "").trim(),
      count: Number(t.count ?? 1),
      kind: (String(t.kind ?? "entity") === "hashtag" ? "hashtag" : "entity") as "hashtag" | "entity",
    })).filter((t: TermRow) => t.term.length > 1);
    return { topics, terms };
  } catch (e) {
    console.error("Failed to parse AI JSON:", e, content.slice(0, 300));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const candidateId: string | null = body.candidate_id ?? null;
    const network: string | null = body.network ?? null;
    const startDate: string | null = body.start_date ?? null;
    const endDate: string | null = body.end_date ?? null;
    let samples: string[] = Array.isArray(body.samples) ? body.samples.filter((s: unknown) => typeof s === "string") : [];

    // Se cliente não enviou samples, busca no banco dentro do período
    if (samples.length === 0 && startDate && endDate) {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      let q = sb
        .from("social_interactions")
        .select("post_title, comment_text")
        .is("invalidated_at", null)
        .gte("collected_at", startDate)
        .lte("collected_at", endDate)
        .limit(2000);
      if (candidateId) q = q.eq("candidate_id", candidateId);
      if (network) q = q.eq("social_network", network);
      const { data, error } = await q;
      if (error) throw error;
      samples = (data ?? [])
        .map((r: any) => `${r.post_title ?? ""} ${r.comment_text ?? ""}`.trim())
        .filter((t: string) => t.length >= 8)
        .slice(0, 150);
    }

    // Nome do candidato (opcional)
    let candidateName: string | null = null;
    if (candidateId) {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data } = await sb.from("candidates").select("full_name").eq("id", candidateId).maybeSingle();
      candidateName = (data?.full_name as string | undefined) ?? null;
    }

    if (samples.length === 0) {
      return new Response(JSON.stringify({ topics: [], terms: [], period: { start_date: startDate, end_date: endDate } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ai = await aiExtractTopicsAndTerms(samples, candidateName);
    const terms = ai?.terms?.length ? ai.terms : localExtractTerms(samples);
    const topics = ai?.topics ?? [];

    return new Response(
      JSON.stringify({ topics, terms, period: { start_date: startDate, end_date: endDate } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("network-view-intelligence error:", e);
    return new Response(JSON.stringify({ topics: [], terms: [], error: String((e as Error)?.message ?? e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
