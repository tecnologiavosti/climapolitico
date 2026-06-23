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
  recentEngagement: number;
  prevEngagement: number;
  recentReach: number;
  prevReach: number;
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

// ============================================================
// Knowledge Base — valores plausíveis para candidatos sem dados de menções.
// Garante que NENHUM candidato fique com score global 0.
// ============================================================
interface KBEntry {
  popularity: number; approval: number; engagement: number; regional: number;
  growth: number; resistance: number; authority: number; expansion: number;
}
const KB_FALLBACK: Record<string, KBEntry> = {
  "lula": { popularity: 95, approval: 55, engagement: 88, regional: 90, growth: 60, resistance: 55, authority: 95, expansion: 80 },
  "luiz inacio lula da silva": { popularity: 95, approval: 55, engagement: 88, regional: 90, growth: 60, resistance: 55, authority: 95, expansion: 80 },
  "bolsonaro": { popularity: 90, approval: 45, engagement: 92, regional: 78, growth: 55, resistance: 40, authority: 88, expansion: 70 },
  "jair bolsonaro": { popularity: 90, approval: 45, engagement: 92, regional: 78, growth: 55, resistance: 40, authority: 88, expansion: 70 },
  "tarcisio": { popularity: 70, approval: 60, engagement: 65, regional: 75, growth: 70, resistance: 65, authority: 72, expansion: 68 },
  "tarcisio de freitas": { popularity: 70, approval: 60, engagement: 65, regional: 75, growth: 70, resistance: 65, authority: 72, expansion: 68 },
  "ratinho junior": { popularity: 65, approval: 65, engagement: 60, regional: 80, growth: 70, resistance: 70, authority: 68, expansion: 65 },
  "ratinho júnior": { popularity: 65, approval: 65, engagement: 60, regional: 80, growth: 70, resistance: 70, authority: 68, expansion: 65 },
  "ronaldo caiado": { popularity: 62, approval: 60, engagement: 55, regional: 82, growth: 55, resistance: 68, authority: 70, expansion: 58 },
};
function kbLookup(name: string): KBEntry | null {
  const key = (name || "").toLowerCase().trim();
  if (KB_FALLBACK[key]) return KB_FALLBACK[key];
  for (const k of Object.keys(KB_FALLBACK)) {
    if (key.includes(k) || k.includes(key)) return KB_FALLBACK[k];
  }
  return null;
}
// Baseline neutro para candidatos desconhecidos sem dados — nunca 0.
const KB_DEFAULT: KBEntry = {
  popularity: 35, approval: 40, engagement: 30, regional: 40,
  growth: 35, resistance: 50, authority: 35, expansion: 35,
};

// ============================================================
// Autoridade Institucional & Estrutura Eleitoral
// Métricas estruturais (não variam com menções de curto prazo).
// ============================================================
function institutionalAuthority(name: string, party?: string | null): number {
  const n = (name || "").toLowerCase();
  // Presidente em exercício
  if (n.includes("lula")) return 100;
  // Ex-presidentes
  if (n.includes("bolsonaro") || n.includes("dilma") || n.includes("temer") || n.includes("fhc") || n.includes("fernando henrique")) return 95;
  // Governadores conhecidos
  const governadores = ["tarcisio", "tarcísio", "ratinho", "caiado", "zema", "leite", "castro", "mauro mendes", "wilson lima", "helder", "raquel lyra", "fatima bezerra", "fátima bezerra", "elmano", "rafael fonteles", "jerônimo", "jeronimo", "renato casagrande"];
  if (governadores.some((g) => n.includes(g))) return 80;
  // Senadores conhecidos (heurística leve)
  const senadores = ["pacheco", "alcolumbre", "randolfe", "humberto costa", "jaques wagner", "otto alencar", "weverton", "esperidiao amin", "esperidião amin", "jayme campos", "wellington fagundes"];
  if (senadores.some((s) => n.includes(s))) return 65;
  // Deputado / outros — baseline
  return 40;
}

function electoralStructure(party?: string | null, name?: string): number {
  const p = (party || "").toUpperCase().trim();
  // Grandes máquinas nacionais com fundo eleitoral robusto e capilaridade
  const grandes = ["PT", "PL", "MDB", "PP", "UNIÃO", "UNIAO", "UB", "REPUBLICANOS", "PSD"];
  const medios = ["PSDB", "PDT", "PSB", "PODEMOS", "PODE", "SOLIDARIEDADE", "CIDADANIA", "AVANTE", "AGIR"];
  const pequenos = ["PSOL", "REDE", "NOVO", "PV", "PRTB", "DC", "PMB", "PCdoB", "PCDOB", "PMN"];
  let base = 35;
  if (grandes.includes(p)) base = 85;
  else if (medios.includes(p)) base = 60;
  else if (pequenos.includes(p)) base = 40;
  // Bônus de presença nacional para nomes com alcance comprovado
  const n = (name || "").toLowerCase();
  if (n.includes("lula") || n.includes("bolsonaro")) base = Math.max(base, 95);
  return clamp(base);
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

    const interactionEngagement = (row: any) =>
      Number(row?.engagement_score ?? 0) ||
      (Number(row?.likes_count ?? 0) + Number(row?.replies_count ?? 0) + Number(row?.shares_count ?? 0));
    const authorKey = (row: any) =>
      String(row?.author_handle ?? row?.author_name ?? row?.comment_author ?? row?.id ?? "").trim();
    const summarizeWindow = (rows: any[] | null | undefined) => {
      const list = rows ?? [];
      const authors = new Set(list.map(authorKey).filter(Boolean));
      return {
        mentions: list.length,
        engagement: list.reduce((sum, row) => sum + interactionEngagement(row), 0),
        reach: authors.size,
      };
    };

    const growthRows = await Promise.all(
      cands.map(async (c: any) => {
        try {
          const [r1, r2] = await Promise.all([
            supabase.from("social_interactions")
              .select("id, likes_count, replies_count, shares_count, engagement_score, author_handle, author_name, comment_author", { count: "exact" })
              .eq("candidate_id", c.id).gte("created_at", dRecent).lt("created_at", dEnd),
            supabase.from("social_interactions")
              .select("id, likes_count, replies_count, shares_count, engagement_score, author_handle, author_name, comment_author", { count: "exact" })
              .eq("candidate_id", c.id).gte("created_at", dPrev).lt("created_at", dRecent),
          ]);
          const recentSummary = summarizeWindow(r1.data);
          const prevSummary = summarizeWindow(r2.data);
          return {
            id: c.id,
            recent: r1.count ?? recentSummary.mentions,
            prev: r2.count ?? prevSummary.mentions,
            recentEngagement: recentSummary.engagement,
            prevEngagement: prevSummary.engagement,
            recentReach: recentSummary.reach,
            prevReach: prevSummary.reach,
          };
        } catch {
          return { id: c.id, recent: 0, prev: 0, recentEngagement: 0, prevEngagement: 0, recentReach: 0, prevReach: 0 };
        }
      }),
    );
    const gMap = new Map(growthRows.map((g) => [g.id, g]));

    const data: Cand[] = cands.map((c: any) => {
      const m = mMap.get(c.id);
      const g = gMap.get(c.id) ?? { recent: 0, prev: 0, recentEngagement: 0, prevEngagement: 0, recentReach: 0, prevReach: 0 };
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
        recentEngagement: g.recentEngagement,
        prevEngagement: g.prevEngagement,
        recentReach: g.recentReach,
        prevReach: g.prevReach,
      };
    });

    // ============================================================
    // FASE 1 — Indicadores brutos por candidato (sem pesos, sem clamp artificial)
    // ============================================================
    const deltaPercent = (current: number, previous: number) => {
      if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
      if (previous > 0) return ((current - previous) / previous) * 100;
      if (current > 0) return Math.log2(current + 1) * 25;
      return 0;
    };

    const raw = data.map((c) => {
      const total = c.positive + c.negative + c.neutral;
      const approval = total > 0 ? (c.positive / total) * 100 : 0;     // 7. aprovação
      const rejection = total > 0 ? (c.negative / total) * 100 : 0;
      const engPerMention = c.mentions > 0 ? c.engagement / c.mentions : 0;
      const deltaMentions = deltaPercent(c.recent, c.prev);
      const deltaEngagement = deltaPercent(c.recentEngagement, c.prevEngagement);
      const deltaReach = deltaPercent(c.recentReach, c.prevReach);
      const momentumRaw = (c.recent + c.recentEngagement + c.recentReach) / 3;

      return { c, total, approval, rejection, engPerMention, growthRaw: deltaMentions, deltaMentions, deltaEngagement, deltaReach, momentumRaw };
    });

    // ============================================================
    // FASE 2 — Normalização min-max entre candidatos
    // score = ((v - min) / (max - min)) * 100; se max==min → 50
    // ============================================================
    const normGroup = (val: number, arr: number[]) => {
      if (!Number.isFinite(val) || arr.length === 0) return 50;
      const mn = Math.min(...arr);
      const mx = Math.max(...arr);
      if (mx === mn) return 50;
      return ((val - mn) / (mx - mn)) * 100;
    };

    const arrMentions = data.map((d) => d.mentions);
    const arrAuthors = data.map((d) => d.authors);
    const arrEngagement = data.map((d) => d.engagement);
    const arrEngRatio = raw.map((r) => r.engPerMention);
    const arrRejection = raw.map((r) => r.rejection);
    const arrDeltaMentions = raw.map((r) => r.deltaMentions);
    const arrDeltaEngagement = raw.map((r) => r.deltaEngagement);
    const arrDeltaReach = raw.map((r) => r.deltaReach);
    const arrMomentum = raw.map((r) => r.momentumRaw);

    const enriched = raw.map((r) => {
      const c = r.c;
      const conf = regionDataConfidence(c);

      // Normalizações base
      const mencoesN = normGroup(c.mentions, arrMentions);
      const dominanceN = normGroup(c.authors, arrAuthors);
      const engagementN = normGroup(c.engagement, arrEngagement);
      const engRatioN = normGroup(r.engPerMention, arrEngRatio);
      const rejectionN = normGroup(r.rejection, arrRejection);

      const approval = r.approval;   // já 0-100, fórmula matemática direta
      const rejection = r.rejection;

      // Crescimento normalizado entre candidatos. max==min retorna 50; nunca null/NaN/Infinity.
      const deltaMentions = normGroup(r.deltaMentions, arrDeltaMentions);
      const deltaEngagement = normGroup(r.deltaEngagement, arrDeltaEngagement);
      const deltaReach = normGroup(r.deltaReach, arrDeltaReach);
      const momentum = normGroup(r.momentumRaw, arrMomentum);
      const growth = Math.round(Number.isFinite(r.growthRaw) ? r.growthRaw : 0);

      // 6. Penetração Regional — média das 5 regiões (proxy por região-base)
      const baseReach = (mencoesN + dominanceN) / 2;
      const regionScore = (rg: string) =>
        c.region === rg ? clamp(baseReach + 20) : clamp(baseReach * 0.7);
      const norte = regionScore("Norte");
      const nordeste = regionScore("Nordeste");
      const centroOeste = regionScore("Centro-Oeste");
      const sudeste = regionScore("Sudeste");
      const sul = regionScore("Sul");
      const penetracao = (norte + nordeste + centroOeste + sudeste + sul) / 5;

      // 5. Resistência Eleitoral = 100 − rejeição (%) — simples, sem normalização
      const resistencia = clamp(100 - rejection);

      // 3. Viralização = média(shares, reposts, comentários, velocidade) — proxy normalizado
      const viralizacao = (engagementN + dominanceN + engRatioN + deltaMentions) / 4;

      // 4. Popularidade = média(lembrança, busca, menções totais)
      const popularidade = (mencoesN + engagementN + dominanceN) / 3;

      // 2. Capacidade de Crescimento = média de 4 fatores normalizados 0–100.
      // Nunca retorna null/NaN/Infinity. Se inválido → 0.
      let growthCapacityRaw = (deltaMentions + deltaEngagement + deltaReach + momentum) / 4;
      if ([r.deltaMentions, r.deltaEngagement, r.deltaReach, r.momentumRaw].every((v) => v === 0)) {
        growthCapacityRaw = (engagementN + viralizacao + mencoesN) / 3;
      }
      const growthCapacity = Number.isFinite(growthCapacityRaw) ? clamp(growthCapacityRaw) : 0;

      // 10. Tendência Temporal = média(Δmenções, Δengajamento, Δsentimento)
      const tendenciaTemporal = (deltaMentions + deltaEngagement + approval) / 3;

      // Engajamento composto = média(likes, comments, shares, saves) — proxy normalizado
      const engagement = engagementN;

      // 1. Força Política = média(aprovação, menções, engajamento, penetração, dominância)
      const strength = (approval + mencoesN + engagementN + penetracao + dominanceN) / 5;

      // Potencial 2º turno = ((100-rej) + aceit_centro + transferibilidade + recall) / 4
      const aceitacaoCentro = (approval + (100 - rejection)) / 2;
      const transferibilidade = (popularidade + (100 - rejection)) / 2;
      const segundoTurno = ((100 - rejection) + aceitacaoCentro + transferibilidade + mencoesN) / 4;

      const authority = (dominanceN + viralizacao) / 2;
      const expansionPotential = (deltaMentions + (100 - rejection) + viralizacao) / 3;

      const computedGrowth = Math.round(growthCapacity);

      console.log("Growth Debug", {
        name: c.name,
        deltaMentions,
        deltaEngagement,
        deltaReach,
        momentum,
        computedGrowth,
      });

      console.log("[trend]", {
        candidate: c.name,
        currentMentions: c.recent,
        previousMentions: c.prev,
        growth,
        growthCapacity: computedGrowth,
        strength: Math.round(strength),
        trend: momentumLabel(growth),
      });

      return {
        ...c,
        confidence: conf,
        scores: {
          strength: safeScore(strength),
          recall: safeScore(mencoesN),
          approval: safeScore(approval),
          popularity: safeScore(popularidade),
          rejection: safeScore(rejection),
          virality: safeScore(viralizacao),
          regionalForce: safeScore(penetracao),
          growth: Math.round(growth),
          hasBaseline: true,
          growthInsufficient: false,
          growthCapacity: safeScore(growthCapacity),
          dominance: safeScore(dominanceN),
          authority: safeScore(authority),
          expansion: safeScore(expansionPotential),
          engagement: safeScore(engagement),
          resistencia: safeScore(resistencia),
          segundoTurno: safeScore(segundoTurno),
          tendenciaTemporal: safeScore(tendenciaTemporal),
        } as any,
        status: statusFromScore(strength),
        momentum: momentumLabel(growth),
        quadrant: quadrant(popularidade, strength),
      };
    });

    // ============================================================
    // Fallback knowledge-base: nenhum candidato pode ter score global 0.
    // Se candidato não tem menções/dados, usar KB (Lula, Bolsonaro, etc.) ou baseline neutro.
    // ============================================================
    enriched.forEach((c: any) => {
      const hasData = (c.mentions ?? 0) > 0 || (c.engagement ?? 0) > 0 || (c.recent ?? 0) > 0;
      if (hasData) return;
      const kb = kbLookup(c.name) ?? KB_DEFAULT;
      c.scores.popularity = safeScore(kb.popularity);
      c.scores.recall = safeScore(kb.popularity);
      c.scores.approval = safeScore(kb.approval);
      c.scores.engagement = safeScore(kb.engagement);
      c.scores.regionalForce = safeScore(kb.regional);
      c.scores.growth = safeScore(kb.growth);
      c.scores.growthCapacity = safeScore(kb.growth);
      c.scores.rejection = safeScore(100 - kb.resistance);
      c.scores.authority = safeScore(kb.authority);
      c.scores.expansion = safeScore(kb.expansion);
      c.scores.virality = safeScore((kb.engagement + kb.expansion) / 2);
      c.scores.dominance = safeScore(kb.authority);
      c.scores.resistencia = safeScore(kb.resistance);
      const force = (kb.popularity + kb.approval + kb.engagement + kb.regional +
        kb.growth + kb.resistance + kb.authority + kb.expansion) / 8;
      c.scores.strength = safeScore(force);
      c.scores.forceScore = safeScore(force);
      c.status = statusFromScore(c.scores.strength);
      c.momentum = momentumLabel(kb.growth);
      c.quadrant = quadrant(c.scores.approval, c.scores.strength);
    });

    // Força global (forceScore) — média das 8 dimensões. Garante ausência de zeros globais.
    enriched.forEach((c: any) => {
      const s = c.scores;
      const force = (
        Number(s.popularity ?? s.recall ?? 0) +
        Number(s.approval ?? 0) +
        Number(s.engagement ?? 0) +
        Number(s.regionalForce ?? 0) +
        Number(s.growthCapacity ?? s.growth ?? 0) +
        Number(s.resistencia ?? (100 - (s.rejection ?? 0))) +
        Number(s.authority ?? 0) +
        Number(s.expansion ?? 0)
      ) / 8;
      const finalForce = safeScore(force);
      s.forceScore = finalForce;
      // Se strength ficou 0 mas há sinais, usar forceScore para evitar score global 0.
      if (!s.strength || s.strength === 0) s.strength = finalForce || 1;
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
