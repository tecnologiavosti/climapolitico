// ai-candidate-comparison
// Premium strategic comparison: ranking, radar (8D), destaques, matriz 2x2,
// head-to-head, narrativas (pos/neg/neutras), tendência, cenários, confrontos, SWOT, resumo.
// Sempre HTTP 200; erros em { success:false, message }.

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

type Period = "7d" | "30d" | "90d" | "1y" | "custom";
const periodDays: Record<Exclude<Period, "custom">, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

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
  recent: number;
  prev: number;
}

function clamp(v: number, lo = 0, hi = 100) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function normalizeMax(value: number, max: number) {
  if (max <= 0) return 0;
  return clamp((value / max) * 100);
}
// Soft-cap logarítmico: dificulta atingir 100. baseline = valor que mapeia para ~63.
function softCap(value: number, baseline: number) {
  if (!Number.isFinite(value) || value <= 0 || baseline <= 0) return 0;
  return clamp(100 * (1 - Math.exp(-value / baseline)));
}
function safeScore(v: unknown, fb = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.round(clamp(n));
}
function statusFromScore(s: number) {
  if (s >= 78) return "Dominante";
  if (s >= 60) return "Forte";
  if (s >= 40) return "Competitivo";
  if (s >= 22) return "Fraco";
  return "Crítico";
}
function momentumLabel(g: number | null) {
  if (g === null) return "Estável";
  if (g >= 40) return "Subindo forte";
  if (g >= 10) return "Subindo";
  if (g <= -40) return "Caindo forte";
  if (g <= -10) return "Caindo";
  return "Estável";
}
function quadrant(approval: number, strength: number) {
  const hi = 55;
  if (strength >= hi && approval >= hi) return "Dominante";
  if (strength >= hi && approval < hi) return "Polarizador";
  if (strength < hi && approval >= hi) return "Promissor";
  return "Vulnerável";
}

function safeParseJson(raw: string): any | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  try { return JSON.parse(jsonrepair(cleaned)); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(jsonrepair(m[0])); } catch {} }
  return null;
}

function regionDataConfidence(c: Cand): number {
  const total = c.positive + c.negative + c.neutral;
  if (total >= 200) return 0.9;
  if (total >= 60) return 0.7;
  if (total >= 20) return 0.5;
  if (total >= 5) return 0.35;
  return 0.2;
}

function fallbackArchetype(c: any) {
  if (c.scores.rejection >= 55) return "Polarizador";
  if (c.scores.regionalForce >= 70) return "Protetor regional";
  if (c.scores.virality >= 65) return "Articulador digital";
  if (c.scores.approval >= 60) return "Gestor de aprovação";
  if (c.scores.growth >= 20) return "Outsider em ascensão";
  return "Reformista em consolidação";
}
function fallbackTom(c: any) {
  if (c.scores.rejection >= 55) return "agressivo";
  if (c.scores.virality >= 65) return "popular";
  if (c.scores.approval >= 60) return "racional";
  if (c.scores.growth >= 20) return "emocional";
  return "técnico";
}
function fallbackNarrativas(c: any) {
  const pos: string[] = [];
  const neg: string[] = [];
  const neu: string[] = [];
  if (c.scores.regionalForce >= 60) pos.push("força regional sólida");
  if (c.scores.approval >= 55) pos.push("aprovação acima da média");
  if (c.scores.virality >= 55) pos.push("alta tração digital");
  if (c.scores.growth >= 15) pos.push("crescimento recente");
  if (c.scores.dominance >= 55) pos.push("autoridade narrativa");
  while (pos.length < 3) pos.push("competitividade local");

  if (c.scores.rejection >= 55) neg.push("rejeição elevada");
  if (c.scores.growth <= -15) neg.push("perda de tração");
  if (c.scores.virality < 30) neg.push("baixa viralização");
  if (c.scores.approval < 40) neg.push("aprovação fraca");
  while (neg.length < 3) neg.push("exposição limitada");

  neu.push(c.party ? `perfil ${c.party}` : "perfil partidário");
  neu.push(c.region ? `base no ${c.region}` : "base regional");
  neu.push("trajetória política estabelecida");
  return { positivas: pos.slice(0, 3), negativas: neg.slice(0, 3), neutras: neu.slice(0, 3) };
}

function fallbackSwot(c: any) {
  return {
    forcas: [
      c.scores.regionalForce >= 60 ? "Base regional consolidada" : "Reconhecimento local",
      c.scores.approval >= 55 ? "Aprovação acima da média" : "Identidade política definida",
    ],
    fraquezas: [
      c.scores.rejection >= 50 ? "Rejeição elevada" : "Margem de crescimento limitada",
      c.scores.virality < 35 ? "Baixa viralização digital" : "Dependência de mídia tradicional",
    ],
    oportunidades: [
      c.scores.growth >= 10 ? "Vetor de crescimento recente" : "Espaço para expansão urbana",
      "Ampliação narrativa fora do reduto",
    ],
    ameacas: [
      c.scores.rejection >= 50 ? "Polarização adversa" : "Concorrência por mesma base",
      c.scores.growth <= -10 ? "Tendência de queda recente" : "Ciclo eleitoral volátil",
    ],
  };
}

function buildConfrontos(enriched: any[]) {
  // Quem vence por dimensão entre top 2
  const top = [...enriched].sort((a, b) => b.scores.strength - a.scores.strength).slice(0, 2);
  if (top.length < 2) return null;
  const [a, b] = top;
  const pick = (av: number, bv: number, higherWins = true) => {
    if (av === bv) return "Empate";
    return (higherWins ? av > bv : av < bv) ? a.name : b.name;
  };
  return {
    a: a.name,
    b: b.name,
    dimensoes: [
      { dim: "Centro-Oeste", vencedor: /centro|GO|MT|MS|DF/i.test(`${a.region ?? ""}`) ? a.name : pick(a.scores.regionalForce, b.scores.regionalForce) },
      { dim: "Sudeste", vencedor: /sudeste|SP|RJ|MG|ES/i.test(`${a.region ?? ""}`) ? a.name : pick(a.scores.regionalForce, b.scores.regionalForce) },
      { dim: "Nordeste", vencedor: /nordeste|BA|PE|CE|MA|PI|RN|PB|AL|SE/i.test(`${a.region ?? ""}`) ? a.name : pick(a.scores.approval, b.scores.approval) },
      { dim: "Rural", vencedor: pick(a.scores.regionalForce, b.scores.regionalForce) },
      { dim: "Urbano", vencedor: pick(a.scores.virality, b.scores.virality) },
      { dim: "Jovens", vencedor: pick(a.scores.virality, b.scores.virality) },
      { dim: "Evangélicos", vencedor: pick(a.scores.approval, b.scores.approval) },
      { dim: "Agro", vencedor: pick(a.scores.regionalForce, b.scores.regionalForce) },
    ],
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

    let body: any = {};
    try { body = await req.json(); } catch {}
    const allowed = ["7d", "30d", "90d", "1y", "custom"];
    const period: Period = (allowed.includes(body?.period) ? body.period : "30d") as Period;

    const now = Date.now();
    let dRecent: string;
    let dPrev: string;
    let dEnd: string;
    let days = periodDays[period as Exclude<Period, "custom">] ?? 30;

    if (period === "custom" && body?.startDate && body?.endDate) {
      const start = new Date(body.startDate).getTime();
      const end = new Date(body.endDate).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return ok({ success: false, message: "Intervalo personalizado inválido." });
      }
      const span = end - start;
      days = Math.max(1, Math.round(span / 86400000));
      dRecent = new Date(start).toISOString();
      dEnd = new Date(end).toISOString();
      dPrev = new Date(start - span).toISOString();
    } else {
      dRecent = new Date(now - days * 86400000).toISOString();
      dEnd = new Date(now).toISOString();
      dPrev = new Date(now - 2 * days * 86400000).toISOString();
    }

    const { data: cands, error: candErr } = await supabase
      .from("candidates")
      .select("id, full_name, party, region")
      .order("full_name");
    if (candErr) throw candErr;
    if (!cands || cands.length === 0) {
      return ok({ success: true, empty: true, message: "Nenhum candidato cadastrado.", period });
    }

    const ids = cands.map((c: any) => c.id);
    const { data: metrics } = await supabase
      .from("candidate_metrics_cache")
      .select("candidate_id, total_mentions, unique_authors, total_engagement, average_sentiment, positive_count, negative_count, neutral_count")
      .in("candidate_id", ids);
    const mMap = new Map<string, any>((metrics ?? []).map((m: any) => [m.candidate_id, m]));

    const growthRows = await Promise.all(
      cands.map(async (c: any) => {
        try {
          const [r1, r2] = await Promise.all([
            supabase.from("social_interactions").select("id", { head: true, count: "exact" })
              .eq("candidate_id", c.id).gte("created_at", dRecent).lt("created_at", dEnd),
            supabase.from("social_interactions").select("id", { head: true, count: "exact" })
              .eq("candidate_id", c.id).gte("created_at", dPrev).lt("created_at", dRecent),
          ]);
          return { id: c.id, recent: r1.count ?? 0, prev: r2.count ?? 0 };
        } catch {
          return { id: c.id, recent: 0, prev: 0 };
        }
      }),
    );
    const gMap = new Map(growthRows.map((g) => [g.id, g]));

    const data: Cand[] = cands.map((c: any) => {
      const m = mMap.get(c.id);
      const g = gMap.get(c.id) ?? { recent: 0, prev: 0 };
      return {
        id: c.id,
        name: c.full_name,
        party: c.party,
        region: c.region,
        mentions: m?.total_mentions ?? 0,
        authors: m?.unique_authors ?? 0,
        engagement: m?.total_engagement ?? 0,
        positive: m?.positive_count ?? 0,
        negative: m?.negative_count ?? 0,
        neutral: m?.neutral_count ?? 0,
        avgSentiment: m?.average_sentiment != null ? Number(m.average_sentiment) : null,
        recent: g.recent,
        prev: g.prev,
      };
    });

    const maxMentions = Math.max(1, ...data.map((d) => d.mentions));
    const maxAuthors = Math.max(1, ...data.map((d) => d.authors));
    const maxEngagement = Math.max(1, ...data.map((d) => d.engagement));

    const enriched = data.map((c) => {
      const total = c.positive + c.negative + c.neutral;
      const conf = regionDataConfidence(c);
      // Sem dados de sentimento → neutro (50/50), nunca inflar.
      const approval = total > 0 ? (c.positive / total) * 100 : 50;
      const rejection = total > 0 ? (c.negative / total) * 100 : 50;

      // ===== Indicadores base (0-100, soft-cap absoluto) =====
      const recall = softCap(c.mentions, 8000);
      const dominance = softCap(c.authors, 1500);
      const engPerMention = c.mentions > 0 ? c.engagement / Math.max(1, c.mentions) : 0;
      const engRatio = softCap(engPerMention, 15);
      const mentionsLog = softCap(c.mentions, 20000);
      const engagementLog = softCap(c.engagement, 50000);
      const authorsLog = softCap(c.authors, 3000);

      // ===== Crescimento (log-ratio amortecido — NUNCA defaulta para 100) =====
      const mentionsRatio = Math.log2((c.recent + 1) / (c.prev + 1));
      let growth: number | null;
      let growthInsufficient = false;
      if (c.recent + c.prev < 8) {
        growth = null;
        growthInsufficient = true;
      } else {
        growth = clamp(Math.round(mentionsRatio * 25), -100, 100);
      }
      const growthNorm = growth === null ? 50 : (growth + 100) / 2;

      // ===== 2. Popularidade = (recall + trends + mídia + social + pesquisas)/5 =====
      const popularity = (mentionsLog + engagementLog + authorsLog + engRatio + approval) / 5;

      // ===== 4. Penetração regional = (N + NE + CO + SE + S)/5 =====
      // Sem breakdown por UF no cache → proxy: recall+dominância com bônus de região-base.
      const homeRegion = c.region ?? "";
      const baseReach = (recall + dominance) / 2;
      const regionScore = (r: string) =>
        homeRegion === r ? clamp(baseReach + 20) : clamp(baseReach * 0.7);
      const norte = regionScore("Norte");
      const nordeste = regionScore("Nordeste");
      const centroOeste = regionScore("Centro-Oeste");
      const sudeste = regionScore("Sudeste");
      const sul = regionScore("Sul");
      const regionalForce = (norte + nordeste + centroOeste + sudeste + sul) / 5;

      // ===== 5. Engajamento = (likes + comments + shares + saves)/4 =====
      // Sem breakdown por tipo → split do engajamento total como proxy.
      const engagement = (
        softCap(c.engagement * 0.5, 25000) +
        softCap(c.engagement * 0.2, 10000) +
        softCap(c.engagement * 0.2, 10000) +
        softCap(c.engagement * 0.1, 5000)
      ) / 4;

      // ===== 3. Resistência eleitoral = ((100-rej) + base_fiel + recall + estabilidade)/4 =====
      const baseFiel = approval;
      const estabilidade = growth === null ? 50 : 100 - Math.min(100, Math.abs(growth));
      const resistencia = ((100 - rejection) + baseFiel + recall + estabilidade) / 4;

      // ===== Viralização (média simples — usada em força política) =====
      const positiveGrowth = growth !== null && growth > 0 ? growth : 0;
      const virality = (engRatio + positiveGrowth + dominance) / 3;

      // ===== 6. Potencial 2º turno = ((100-rej) + aceit_centro + transf + recall)/4 =====
      const aceitacaoCentro = (approval + (100 - rejection)) / 2;
      const transferibilidade = (popularity + (100 - rejection)) / 2;
      const segundoTurno = ((100 - rejection) + aceitacaoCentro + transferibilidade + recall) / 4;

      // ===== 7. Capacidade de crescimento = ((100-pop) + momentum + (100-rej) + exp_reg + novidade)/5 =====
      const momentum = growth === null ? 50 : growthNorm;
      const expansaoRegional = 100 - regionalForce;
      const novidade = 100 - popularity;
      const growthCapacity = ((100 - popularity) + momentum + (100 - rejection) + expansaoRegional + novidade) / 5;

      // ===== 8. Tendência temporal = (Δmenções + Δengajamento + Δsentimento)/3 =====
      const deltaMencoes = growthNorm;
      const deltaEngajamento = engRatio;
      const deltaSentimento = approval;
      const tendenciaTemporal = (deltaMencoes + deltaEngajamento + deltaSentimento) / 3;

      // ===== 1. Força política = (regional + aprov + resist + viral + cresc + domin)/6 =====
      const strength = (regionalForce + approval + resistencia + virality + growthNorm + dominance) / 6;

      const authority = (dominance + virality) / 2;
      const expansionPotential = (growthNorm + (100 - rejection) + virality) / 3;

      console.log("[trend]", {
        candidate: c.name,
        currentMentions: c.recent,
        previousMentions: c.prev,
        growth,
        growthCapacity: Math.round(growthCapacity),
        strength: Math.round(strength),
        trend: momentumLabel(growth),
      });

      return {
        ...c,
        confidence: conf,
        scores: {
          strength: safeScore(strength),
          recall: safeScore(recall),
          approval: safeScore(approval),
          popularity: safeScore(popularity),
          rejection: safeScore(rejection),
          virality: safeScore(virality),
          regionalForce: safeScore(regionalForce),
          growth: growth === null ? 0 : Math.round(growth),
          hasBaseline: growth !== null,
          growthInsufficient,
          growthCapacity: safeScore(growthCapacity),
          dominance: safeScore(dominance),
          authority: safeScore(authority),
          expansion: safeScore(expansionPotential),
          engagement: safeScore(engagement),
          resistencia: safeScore(resistencia),
          segundoTurno: safeScore(segundoTurno),
          tendenciaTemporal: safeScore(tendenciaTemporal),
        } as any,
        status: statusFromScore(strength),
        momentum: momentumLabel(growth),
        quadrant: quadrant(popularity, strength),
      };
    });

    enriched.sort((a, b) => b.scores.strength - a.scores.strength);

    // Best in class
    const pickTop = (key: string) => [...enriched].sort((a: any, b: any) => b.scores[key] - a.scores[key])[0] ?? null;
    const pickBottom = (key: string) => [...enriched].sort((a: any, b: any) => a.scores[key] - b.scores[key])[0] ?? null;
    const destaques = {
      tracaoDigital: pickTop("virality"),
      crescimento: pickTop("growth"),
      menorRejeicao: pickBottom("rejection"),
      potencialNacional: pickTop("expansion"),
      melhorRegiao: pickTop("regionalForce"),
      melhorEstado: pickTop("regionalForce"),
      capacidadeViral: pickTop("virality"),
      narrativa: pickTop("authority"),
    };

    // Cenários
    const fav = enriched[0];
    const zebra = [...enriched].sort((a, b) => b.scores.growth - a.scores.growth).find((c) => c.id !== fav?.id) ?? null;
    const ascensao = [...enriched].sort((a, b) => b.scores.virality + b.scores.growth - (a.scores.virality + a.scores.growth))[0] ?? null;
    const colapso = [...enriched].sort((a, b) => b.scores.rejection - a.scores.rejection)[0] ?? null;

    const confrontos = buildConfrontos(enriched);

    // AI enrichment
    let aiNarratives: Map<string, any> = new Map();
    let aiSwot: Map<string, any> = new Map();
    let aiResumo: any = null;
    let aiCenarios: any = null;
    try {
      const compact = enriched.map((c) => ({
        nome: c.name, partido: c.party, regiao: c.region,
        forca: c.scores.strength, aprovacao: c.scores.approval, rejeicao: c.scores.rejection,
        crescimento: c.scores.growth, viralidade: c.scores.virality, regional: c.scores.regionalForce,
        status: c.status, momentum: c.momentum, quadrante: c.quadrant, confianca: c.confidence,
      }));
      const sys = "Você é analista político sênior brasileiro. Use linguagem qualitativa ('tende a','historicamente'). Não invente percentuais. Responda APENAS JSON válido em PT-BR.";
      const prompt = `Candidatos:\n${JSON.stringify(compact)}\n\nGere JSON exato:\n{
  "narrativas": [{"id":"<nome>","arquetipo":"<protetor|articulador|gestor|outsider|reformista|transformador>","tom":"<agressivo|racional|emocional|tecnico|popular>","positivas":["...","...","..."],"negativas":["...","...","..."],"neutras":["...","...","..."]}],
  "swot": [{"id":"<nome>","forcas":["...","..."],"fraquezas":["...","..."],"oportunidades":["...","..."],"ameacas":["...","..."]}],
  "cenarios": {"favorito":"<nome + 1 frase>","zebra":"<nome + 1 frase>","ascensao":"<nome + 1 frase>","colapso":"<nome + 1 frase>"},
  "resumo": {"lidera":"<nome + 1 frase>","cresce":"<nome + 1 frase>","estagnou":"<nome + 1 frase>","preocupa":"<nome + 1 frase>","surpreende":"<nome + 1 frase>"}
}\nNão use markdown.`;
      const r = await callAICerebrasFirst({
        systemMsg: sys, userPrompt: prompt, jsonMode: true,
        maxTokens: 3800, temperature: 0.5, tag: "candidate-comparison",
      });
      const parsed = safeParseJson(r.content);
      if (parsed && typeof parsed === "object") {
        (parsed.narrativas ?? []).forEach((n: any) => n?.id && aiNarratives.set(String(n.id).toLowerCase(), n));
        (parsed.swot ?? []).forEach((s: any) => s?.id && aiSwot.set(String(s.id).toLowerCase(), s));
        aiResumo = parsed.resumo ?? null;
        aiCenarios = parsed.cenarios ?? null;
      }
    } catch (e) {
      console.warn("[ai-candidate-comparison] AI fallback:", (e as Error).message);
    }

    const candidatesOut = enriched.map((c) => {
      const nKey = c.name.toLowerCase();
      const n = aiNarratives.get(nKey);
      const s = aiSwot.get(nKey);
      const narrativas = n
        ? {
            positivas: Array.isArray(n.positivas) ? n.positivas.slice(0, 3) : [],
            negativas: Array.isArray(n.negativas) ? n.negativas.slice(0, 3) : [],
            neutras: Array.isArray(n.neutras) ? n.neutras.slice(0, 3) : [],
            arquetipo: n.arquetipo ?? fallbackArchetype(c),
            tom: n.tom ?? fallbackTom(c),
          }
        : { ...fallbackNarrativas(c), arquetipo: fallbackArchetype(c), tom: fallbackTom(c) };
      const swot = s
        ? {
            forcas: Array.isArray(s.forcas) ? s.forcas.slice(0, 3) : fallbackSwot(c).forcas,
            fraquezas: Array.isArray(s.fraquezas) ? s.fraquezas.slice(0, 3) : fallbackSwot(c).fraquezas,
            oportunidades: Array.isArray(s.oportunidades) ? s.oportunidades.slice(0, 3) : fallbackSwot(c).oportunidades,
            ameacas: Array.isArray(s.ameacas) ? s.ameacas.slice(0, 3) : fallbackSwot(c).ameacas,
          }
        : fallbackSwot(c);
      return {
        id: c.id, name: c.name, party: c.party, state: c.region,
        scores: c.scores, status: c.status, momentum: c.momentum, quadrant: c.quadrant,
        confidence: c.confidence,
        narrativas, swot,
      };
    });

    const resumo = aiResumo ?? {
      lidera: fav ? `${fav.name} lidera pelo maior score estratégico (${fav.scores.strength}/100).` : "Sem liderança definida.",
      cresce: ascensao ? `${ascensao.name} tende a crescer, combinando viralização e momentum positivo.` : "Sem crescimento relevante.",
      estagnou: enriched.find((c) => Math.abs(c.scores.growth) < 8)?.name
        ? `${enriched.find((c) => Math.abs(c.scores.growth) < 8)!.name} mostra estabilidade sem ruptura recente.`
        : "Sem estagnação clara.",
      preocupa: colapso ? `${colapso.name} concentra a maior rejeição relativa do grupo.` : "Sem risco dominante mapeado.",
      surpreende: zebra ? `${zebra.name} tende a surpreender pelo vetor de crescimento recente.` : "Sem zebra identificada.",
    };

    const cenarios = aiCenarios ?? {
      favorito: fav ? `${fav.name} — maior força política consolidada no grupo.` : "—",
      zebra: zebra ? `${zebra.name} — vetor de crescimento atípico.` : "—",
      ascensao: ascensao ? `${ascensao.name} — combinação rara de viralização e momentum.` : "—",
      colapso: colapso ? `${colapso.name} — rejeição elevada pode acelerar perda de espaço.` : "—",
    };

    return ok({
      success: true,
      generatedAt: new Date().toISOString(),
      period,
      candidates: candidatesOut,
      destaques: Object.fromEntries(
        Object.entries(destaques).map(([k, v]: any) => [k, v ? { id: v.id, name: v.name, value: v.scores.strength, state: v.region } : null]),
      ),
      cenarios,
      confrontos,
      resumo,
    });
  } catch (e) {
    console.error("[ai-candidate-comparison] fatal:", (e as Error).message);
    return ok({ success: false, message: `Falha ao gerar comparação: ${(e as Error).message ?? "erro inesperado"}` });
  }
});
