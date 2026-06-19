// ai-candidate-comparison
// Returns AI-driven strategic comparison for the authenticated user's candidates.
// Always returns HTTP 200; errors are encoded as { success: false, message }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonrepair } from "https://esm.sh/jsonrepair@3.8.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Cand {
  id: string;
  name: string;
  party: string | null;
  region: string | null;
  mentions: number;
  authors: number;
  engagement: number;
  positive: number;
  negative: number;
  neutral: number;
  avgSentiment: number | null;
  recent7: number;
  prev7: number;
}

function normalizeMax(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function statusFromScore(score: number): "Dominante" | "Forte" | "Competitivo" | "Fraco" {
  if (score >= 75) return "Dominante";
  if (score >= 55) return "Forte";
  if (score >= 35) return "Competitivo";
  return "Fraco";
}

function momentumLabel(growth: number): "up" | "down" | "stable" {
  if (growth >= 15) return "up";
  if (growth <= -15) return "down";
  return "stable";
}

function safeParseJson(raw: string): any | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(jsonrepair(cleaned));
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(jsonrepair(m[0]));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

function safeScore(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fallbackThemes(candidate: Cand & { scores: any; momentum: string }): string[] {
  const themes = new Set<string>();
  if (candidate.scores.regionalForce >= 65) themes.add("força regional");
  if (candidate.scores.approval >= 55) themes.add("aprovação");
  if (candidate.scores.rejection >= 45) themes.add("rejeição");
  if (candidate.scores.virality >= 60) themes.add("tração digital");
  if (candidate.scores.growth > 15) themes.add("crescimento");
  if (candidate.region) themes.add(candidate.region);
  return Array.from(themes).slice(0, 4).length ? Array.from(themes).slice(0, 4) : ["presença digital", "competitividade", "sentimento", "base eleitoral"];
}

function fallbackArchetype(candidate: Cand & { scores: any }): string {
  if (candidate.scores.rejection >= 55) return "Polarizador de alta rejeição";
  if (candidate.scores.regionalForce >= 70) return "Liderança regional consolidada";
  if (candidate.scores.virality >= 65) return "Competidor digital";
  if (candidate.scores.approval >= 60) return "Perfil de aprovação ampla";
  return "Competidor em consolidação";
}

function buildStrategicFallback(enriched: Array<Cand & { scores: any; status: string; momentum: string }>) {
  const ordered = [...enriched].sort((a, b) => b.scores.strength - a.scores.strength);
  const leader = ordered[0];
  const fastest = [...enriched].sort((a, b) => b.scores.growth - a.scores.growth)[0] ?? leader;
  const stagnant = [...enriched].sort((a, b) => Math.abs(a.scores.growth) - Math.abs(b.scores.growth))[0] ?? leader;
  const rejection = [...enriched].sort((a, b) => b.scores.rejection - a.scores.rejection)[0] ?? leader;

  return {
    narrativas: enriched.map((c) => ({
      id: c.name,
      temas: fallbackThemes(c),
      tom: c.scores.rejection >= 50 ? "polarizado" : c.scores.growth > 15 ? "ascendente" : "competitivo",
      arquetipo: fallbackArchetype(c),
    })),
    melhor_centro_oeste:
      ordered.find((c) => /centro|go|mt|ms|df/i.test(`${c.region ?? ""} ${c.name}`))
        ? {
            nome: ordered.find((c) => /centro|go|mt|ms|df/i.test(`${c.region ?? ""} ${c.name}`))!.name,
            justificativa: "Melhor combinação local entre força regional, presença digital e baixa vulnerabilidade relativa.",
          }
        : { nome: leader?.name ?? "—", justificativa: "Melhor score estratégico entre os candidatos disponíveis." },
    resumo: {
      lidera: leader ? `${leader.name} lidera pelo maior Political Strength Score (${leader.scores.strength}/100).` : "Sem liderança definida.",
      cresce: fastest ? `${fastest.name} apresenta o maior vetor recente de crescimento (${fastest.scores.growth >= 0 ? "+" : ""}${fastest.scores.growth}%).` : "Sem crescimento relevante detectado.",
      estagnou: stagnant ? `${stagnant.name} mostra menor oscilação recente e tende à estabilidade.` : "Sem estagnação clara.",
      preocupa: rejection ? `${rejection.name} exige atenção pela maior rejeição relativa (${rejection.scores.rejection}/100).` : "Sem risco dominante mapeado.",
    },
    momentum_notas: Object.fromEntries(
      enriched.map((c) => [
        c.name,
        c.momentum === "up"
          ? "Tração recente acima da base anterior."
          : c.momentum === "down"
            ? "Perda relativa de intensidade nas menções recentes."
            : "Movimento estável sem ruptura temporal relevante.",
      ]),
    ),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!token) return ok({ success: false, message: "Não autenticado." });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return ok({ success: false, message: "Sessão inválida." });

    // Fetch candidates
    const { data: cands, error: candErr } = await supabase
      .from("candidates")
      .select("id, full_name, party, state")
      .order("full_name");
    if (candErr) throw candErr;
    if (!cands || cands.length === 0) {
      return ok({ success: true, empty: true, message: "Nenhum candidato cadastrado." });
    }

    const ids = cands.map((c: any) => c.id);

    const { data: metrics } = await supabase
      .from("candidate_metrics_cache")
      .select(
        "candidate_id, total_mentions, unique_authors, total_engagement, average_sentiment, positive_count, negative_count, neutral_count",
      )
      .in("candidate_id", ids);

    const mMap = new Map<string, any>((metrics ?? []).map((m: any) => [m.candidate_id, m]));

    const now = Date.now();
    const d7 = new Date(now - 7 * 86400000).toISOString();
    const d14 = new Date(now - 14 * 86400000).toISOString();

    // Compute growth per candidate (parallel)
    const growthRows = await Promise.all(
      cands.map(async (c: any) => {
        try {
          const [r7, r14] = await Promise.all([
            supabase
              .from("social_interactions")
              .select("id", { head: true, count: "exact" })
              .eq("candidate_id", c.id)
              .gte("created_at", d7),
            supabase
              .from("social_interactions")
              .select("id", { head: true, count: "exact" })
              .eq("candidate_id", c.id)
              .gte("created_at", d14)
              .lt("created_at", d7),
          ]);
          return { id: c.id, recent7: r7.count ?? 0, prev7: r14.count ?? 0 };
        } catch {
          return { id: c.id, recent7: 0, prev7: 0 };
        }
      }),
    );
    const gMap = new Map(growthRows.map((g) => [g.id, g]));

    const data: Cand[] = cands.map((c: any) => {
      const m = mMap.get(c.id);
      const g = gMap.get(c.id) ?? { recent7: 0, prev7: 0 };
      const positive = m?.positive_count ?? 0;
      const negative = m?.negative_count ?? 0;
      const neutral = m?.neutral_count ?? 0;
      return {
        id: c.id,
        name: c.full_name,
        party: c.party,
        state: c.state,
        mentions: m?.total_mentions ?? 0,
        authors: m?.unique_authors ?? 0,
        engagement: m?.total_engagement ?? 0,
        positive,
        negative,
        neutral,
        avgSentiment: m?.average_sentiment != null ? Number(m.average_sentiment) : null,
        recent7: g.recent7,
        prev7: g.prev7,
      };
    });

    // Maxes for normalization
    const maxMentions = Math.max(1, ...data.map((d) => d.mentions));
    const maxAuthors = Math.max(1, ...data.map((d) => d.authors));
    const maxEngagement = Math.max(1, ...data.map((d) => d.engagement));

    const enriched = data.map((c) => {
      const total = c.positive + c.negative + c.neutral;
      const approval = total > 0 ? (c.positive / total) * 100 : 50;
      const rejection = total > 0 ? (c.negative / total) * 100 : 30;
      const rejectionInverse = 100 - rejection;
      const recall = normalizeMax(c.mentions, maxMentions);
      const virality =
        c.mentions > 0 ? normalizeMax(c.engagement / Math.max(1, c.mentions), maxEngagement / Math.max(1, maxMentions)) : 0;
      const dominance = normalizeMax(c.authors, maxAuthors);
      const growth =
        c.prev7 === 0
          ? c.recent7 > 0
            ? 100
            : 0
          : Math.max(-100, Math.min(100, ((c.recent7 - c.prev7) / c.prev7) * 100));
      const growthNorm = (growth + 100) / 2; // 0-100
      const regionalForce = (recall * 0.6 + dominance * 0.4); // proxy

      const strength =
        regionalForce * 0.25 +
        approval * 0.2 +
        rejectionInverse * 0.2 +
        virality * 0.15 +
        growthNorm * 0.1 +
        dominance * 0.1;

      return {
        ...c,
        scores: {
          strength: Math.round(strength),
          recall: Math.round(recall),
          approval: Math.round(approval),
          rejection: Math.round(rejection),
          virality: Math.round(virality),
          regionalForce: Math.round(regionalForce),
          growth: Math.round(growth),
          dominance: Math.round(dominance),
        },
        status: statusFromScore(strength),
        momentum: momentumLabel(growth),
      };
    });

    enriched.sort((a, b) => b.scores.strength - a.scores.strength);

    // Best-in-class
    const best = {
      traction: [...enriched].sort((a, b) => b.scores.virality - a.scores.virality)[0],
      lowestRejection: [...enriched].sort((a, b) => a.scores.rejection - b.scores.rejection)[0],
      growth: [...enriched].sort((a, b) => b.scores.growth - a.scores.growth)[0],
      overall: enriched[0],
    };

    // AI qualitative: narratives + momentum reasoning + strategic summary + regional notes
    let ai: any = {};
    try {
      const compact = enriched.map((c) => ({
        nome: c.name,
        partido: c.party,
        estado: c.state,
        score: c.scores.strength,
        status: c.status,
        aprovacao: c.scores.approval,
        rejeicao: c.scores.rejection,
        crescimento: c.scores.growth,
        viralidade: c.scores.virality,
      }));
      const sys =
        "Você é analista político sênior brasileiro. Produza análise estratégica em PT-BR, evitando inventar dados. Use linguagem qualitativa ('historicamente', 'tende a'). Responda APENAS JSON válido.";
      const prompt = `Candidatos:\n${JSON.stringify(compact)}\n\nGere JSON exato:\n{
  "narrativas": [ { "id": "<nome>", "temas": ["t1","t2","t3","t4"], "tom": "<tom emocional curto>", "arquetipo": "<arquetipo politico curto>" } ],
  "melhor_centro_oeste": { "nome": "<nome>", "justificativa": "<1 frase>" },
  "resumo": { "lidera": "<nome + 1 frase>", "cresce": "<nome + 1 frase>", "estagnou": "<nome + 1 frase>", "preocupa": "<nome + 1 frase>" },
  "momentum_notas": { "<nome>": "<1 frase sobre tendência>" }
}\nNão use markdown. Não invente percentuais.`;

      const r = await callAICerebrasFirst({
        systemMsg: sys,
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 2200,
        temperature: 0.5,
        tag: "candidate-comparison",
      });
      ai = safeParseJson(r.content) ?? {};
    } catch (e) {
      console.warn("[ai-candidate-comparison] AI fallback:", (e as Error).message);
      ai = {};
    }

    // Map narratives by candidate name
    const narrativasMap = new Map<string, any>();
    (ai?.narrativas ?? []).forEach((n: any) => {
      if (n?.id) narrativasMap.set(String(n.id).toLowerCase(), n);
    });

    const candidatesOut = enriched.map((c) => {
      const n = narrativasMap.get(c.name.toLowerCase());
      return {
        ...c,
        narrativas: n
          ? {
              temas: Array.isArray(n.temas) ? n.temas.slice(0, 4) : [],
              tom: n.tom ?? null,
              arquetipo: n.arquetipo ?? null,
            }
          : { temas: [], tom: null, arquetipo: null },
        momentumNota: ai?.momentum_notas?.[c.name] ?? null,
      };
    });

    return ok({
      success: true,
      generatedAt: new Date().toISOString(),
      candidates: candidatesOut,
      bestInClass: {
        traction: best.traction ? { id: best.traction.id, name: best.traction.name, value: best.traction.scores.virality } : null,
        lowestRejection: best.lowestRejection ? { id: best.lowestRejection.id, name: best.lowestRejection.name, value: best.lowestRejection.scores.rejection } : null,
        growth: best.growth ? { id: best.growth.id, name: best.growth.name, value: best.growth.scores.growth } : null,
        centroOeste: ai?.melhor_centro_oeste ?? null,
        overall: best.overall ? { id: best.overall.id, name: best.overall.name, value: best.overall.scores.strength } : null,
      },
      summary: ai?.resumo ?? null,
    });
  } catch (e) {
    console.error("[ai-candidate-comparison] fatal:", (e as Error).message);
    return ok({
      success: false,
      message: "A análise está sendo processada. Tente novamente em instantes.",
    });
  }
});
