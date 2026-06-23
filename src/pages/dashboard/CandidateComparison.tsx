import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip as RTooltip,
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Crown, Flame, Shield, TrendingUp, TrendingDown, Minus, Sparkles, Trophy,
  Compass, Brain, RefreshCw, Swords, AlertTriangle, Target, Zap, MapPin,
  Activity, Layers, Megaphone, Radar as RadarIcon,
  ArrowLeftRight,
} from "lucide-react";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { InfoTip } from "@/components/ui/info-tip";
import { toast } from "sonner";

type Period = "7d" | "30d" | "90d" | "1y" | "custom";
const PERIOD_LABEL: Record<Period, string> = {
  "7d": "7 dias", "30d": "30 dias", "90d": "90 dias", "1y": "1 ano", custom: "Personalizado",
};
const PERIOD_TTL_MIN: Record<Period, number> = { "7d": 20, "30d": 45, "90d": 90, "1y": 180, custom: 30 };
const PERIOD_DAYS: Record<Exclude<Period, "custom">, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

// Override oficial de partidos (sempre prevalece)
const PARTY_OVERRIDE: Record<string, string> = {
  "ronaldo caiado": "União Brasil",
  "wellington fagundes": "PL",
  "otaviano pivetta": "Republicanos",
  "jayme campos": "União Brasil",
  "natasha slhessarenko": "PSB",
};
const resolveParty = (name: string, party: string | null) => {
  const ov = PARTY_OVERRIDE[name?.toLowerCase().trim()];
  if (ov) return ov;
  if (party && party.trim() && !/sem partido/i.test(party)) return party;
  return "—";
};

interface Scores {
  strength: number; recall: number; approval: number; rejection: number;
  virality: number; regionalForce: number; growth: number; dominance: number;
  authority: number; expansion: number;
  popularity?: number; hasBaseline?: boolean; growthInsufficient?: boolean;
}
type Status = "Dominante" | "Forte" | "Competitivo" | "Fraco" | "Crítico";
type Momentum = "Subindo forte" | "Subindo" | "Estável" | "Caindo" | "Caindo forte";
type Quadrant = "Dominante" | "Polarizador" | "Promissor" | "Vulnerável";

interface CandidateOut {
  id: string;
  name: string;
  party: string | null;
  state: string | null;
  scores: Scores;
  status: Status;
  momentum: Momentum;
  quadrant: Quadrant;
  confidence: number;
  narrativas: {
    positivas: string[]; negativas: string[]; neutras: string[];
    arquetipo: string; tom: string;
  };
  swot: {
    forcas: string[]; fraquezas: string[]; oportunidades: string[]; ameacas: string[];
  };
}

interface BestEntry { id: string; name: string; value: number; state?: string | null }
interface ApiResponse {
  success: boolean;
  empty?: boolean;
  message?: string;
  generatedAt?: string;
  period?: Period;
  candidates?: CandidateOut[];
  destaques?: Record<string, BestEntry | null>;
  cenarios?: { favorito: string; zebra: string; ascensao: string; colapso: string };
  confrontos?: {
    a: string; b: string;
    dimensoes: { dim: string; vencedor: string }[];
  } | null;
  resumo?: { lidera: string; cresce: string; estagnou: string; preocupa: string; surpreende: string } | null;
}

const STATUS_STYLES: Record<Status, string> = {
  Dominante: "bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-[0_0_18px_-6px] shadow-amber-500/40",
  Forte: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  Competitivo: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  Fraco: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  "Crítico": "bg-red-700/20 text-red-300 border-red-700/40",
};
const QUADRANT_COLOR: Record<Quadrant, string> = {
  Dominante: "#f59e0b",
  Polarizador: "#ef4444",
  Promissor: "#22c55e",
  "Vulnerável": "#64748b",
};

const PALETTE = [
  "hsl(45 95% 60%)", "hsl(160 70% 50%)", "hsl(210 90% 60%)",
  "hsl(340 80% 60%)", "hsl(280 75% 65%)", "hsl(20 85% 60%)",
];

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

// ============= Cache (localStorage) =============
const cacheKey = (userId: string, ids: string[], period: Period, range?: { from?: string; to?: string }) =>
  `cmp_${userId}_${period}_${range?.from ?? ""}_${range?.to ?? ""}_${ids.slice().sort().join(",")}`;

interface CacheEntry { savedAt: number; data: ApiResponse }

function readCache(key: string, ttlMin: number): CacheEntry | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.savedAt || !parsed?.data) return null;
    if (Date.now() - parsed.savedAt > ttlMin * 60_000) return parsed; // stale-but-shown
    return parsed;
  } catch { return null; }
}
function writeCache(key: string, data: ApiResponse) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch {}
}
function ageLabel(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return "agora há pouco";
  if (diff < 60) return `${diff} min atrás`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

// ============= Loading Overlay =============
const STEPS = [
  { from: 0, to: 20, label: "Analisando percepção nacional..." },
  { from: 20, to: 40, label: "Calculando força eleitoral..." },
  { from: 40, to: 70, label: "Comparando narrativas e rejeição..." },
  { from: 70, to: 100, label: "Modelando cenários..." },
];

function LoadingOverlay() {
  const [progress, setProgress] = useState(2);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      setProgress((p) => {
        if (p >= 96) return p;
        const speed = p < 30 ? 0.04 : p < 60 ? 0.025 : p < 85 ? 0.015 : 0.006;
        return Math.min(96, p + dt * speed);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const current = STEPS.find((s) => progress < s.to) ?? STEPS[STEPS.length - 1];

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-background via-primary/5 to-background p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: 18 }).map((_, i) => (
          <motion.span
            key={i}
            className="absolute h-1 w-1 rounded-full bg-primary/60"
            style={{ left: `${(i * 53) % 100}%`, top: `${(i * 37) % 100}%` }}
            animate={{ opacity: [0.1, 0.9, 0.1], scale: [0.6, 1.4, 0.6] }}
            transition={{ duration: 2.2 + (i % 5) * 0.3, repeat: Infinity, delay: (i % 7) * 0.2 }}
          />
        ))}
      </div>
      <div className="relative flex items-center gap-3 mb-4">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}>
          <RadarIcon className="h-6 w-6 text-primary" />
        </motion.div>
        <div>
          <div className="font-semibold">IA processando comparação estratégica</div>
          <div className="text-xs text-muted-foreground">{current.label}</div>
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden mb-2">
        <motion.div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-fuchsia-500 to-amber-400"
          animate={{ width: `${progress}%` }}
          transition={{ ease: "linear", duration: 0.2 }}
        />
      </div>
      <div className="text-xs text-muted-foreground text-right tabular-nums">{Math.round(progress)}%</div>

      <div className="mt-6 grid lg:grid-cols-[1.2fr_.8fr] gap-5">
        <div className="space-y-3">
          {[88, 72, 60, 47].map((w, i) => (
            <div key={i} className="grid grid-cols-[24px_1fr_56px] items-center gap-3 rounded-lg border border-border/40 bg-card/40 px-3 py-3">
              <Skeleton className="h-4 w-4" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <motion.div className="h-2 rounded-full bg-gradient-to-r from-primary/40 to-fuchsia-500/40" style={{ width: `${w}%` }} animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.15 }} />
              </div>
              <Skeleton className="h-6 w-12 rounded-full" />
            </div>
          ))}
        </div>
        <div className="relative min-h-[230px] rounded-xl border border-border/40 bg-card/30 overflow-hidden p-5">
          <div className="absolute inset-8 rounded-full border border-primary/20" />
          <div className="absolute inset-14 rounded-full border border-primary/15" />
          <motion.div
            className="absolute left-1/2 top-1/2 h-[120%] w-px bg-gradient-to-b from-transparent via-primary to-transparent origin-top"
            style={{ x: "-50%", y: "-50%" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
          />
          {[0.25, 0.55, 0.75].map((t, i) => (
            <motion.span key={i}
              className="absolute h-2 w-2 rounded-full bg-fuchsia-400"
              style={{ left: `${20 + i * 25}%`, top: `${30 + (i % 2) * 25}%` }}
              animate={{ scale: [0.6, 1.4, 0.6], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.8, repeat: Infinity, delay: t }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============= Helpers =============
function extractJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = value.replace(/```json\s*/gi, "").replace(/```/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Resposta da IA não contém JSON válido");
  return JSON.parse(m[0].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"));
}

function MomentumBadge({ m }: { m: Momentum }) {
  const map: Record<Momentum, { c: string; icon: any }> = {
    "Subindo forte": { c: "text-emerald-300", icon: TrendingUp },
    "Subindo": { c: "text-emerald-400", icon: TrendingUp },
    "Estável": { c: "text-muted-foreground", icon: Minus },
    "Caindo": { c: "text-rose-400", icon: TrendingDown },
    "Caindo forte": { c: "text-rose-300", icon: TrendingDown },
  };
  const { c, icon: Icon } = map[m];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${c}`}>
      <Icon className="h-3.5 w-3.5" /> {m}
    </span>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  if (value >= 0.4) return null;
  return (
    <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/40 text-[10px]">
      Baixa confiabilidade
    </Badge>
  );
}

// ============= Main =============
const CandidateComparisonPage = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("30d");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date } | undefined>(undefined);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headA, setHeadA] = useState<string | null>(null);
  const [headB, setHeadB] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Resolve effective date range from selected period
  const resolvedRange = useMemo(() => {
    const to = new Date();
    if (period === "custom" && customRange?.from && customRange?.to) {
      return { from: customRange.from, to: customRange.to };
    }
    const days = PERIOD_DAYS[period === "custom" ? "30d" : period];
    const from = new Date(to.getTime() - days * 86400000);
    return { from, to };
  }, [period, customRange]);

  const rangeKey = { from: resolvedRange.from.toISOString().slice(0, 10), to: resolvedRange.to.toISOString().slice(0, 10) };

  // Load candidates ids to build cache key
  const [candidateIds, setCandidateIds] = useState<string[] | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: cands } = await supabase.from("candidates").select("id").order("full_name");
      if (!cancel) setCandidateIds((cands ?? []).map((c) => c.id));
    })();
    return () => { cancel = true; };
  }, [user?.id]);

  // Try to hydrate from cache on mount / period change
  useEffect(() => {
    if (!user?.id || !candidateIds) return;
    if (period === "custom" && !(customRange?.from && customRange?.to)) {
      setData(null); setSavedAt(null); return;
    }
    const key = cacheKey(user.id, candidateIds, period, rangeKey);
    const cached = readCache(key, PERIOD_TTL_MIN[period]);
    if (cached) {
      setData(cached.data);
      setSavedAt(cached.savedAt);
      setError(null);
    } else {
      setData(null);
      setSavedAt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, candidateIds, period, rangeKey.from, rangeKey.to]);

  const runComparison = useCallback(async () => {
    if (!user?.id || !candidateIds) return;
    if (period === "custom" && !(customRange?.from && customRange?.to)) {
      setError("Selecione data inicial e final.");
      return;
    }
    setLoading(true); setError(null);
    try {
      const body: any = { period };
      if (period === "custom") {
        body.startDate = resolvedRange.from.toISOString();
        body.endDate = resolvedRange.to.toISOString();
      }
      const response = await Promise.race([
        supabase.functions.invoke("ai-candidate-comparison", { body }),
        new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error("Tempo esgotado.")), 60000)),
      ]);
      if (response.error) throw new Error(response.error.message ?? "Erro na função");
      const parsed = extractJson(response.data) as ApiResponse;
      if (!parsed?.success) throw new Error(parsed?.message || "A análise está sendo processada. Tente novamente em instantes.");
      if (!mountedRef.current) return;
      setData(parsed);
      const ts = Date.now();
      setSavedAt(ts);
      writeCache(cacheKey(user.id, candidateIds, period, rangeKey), parsed);
    } catch (e: any) {
      console.error(e);
      if (mountedRef.current) setError(e?.message ?? "Falha ao gerar comparação.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [user?.id, candidateIds, period, customRange, resolvedRange, rangeKey.from, rangeKey.to]);

  const candidates = data?.candidates ?? [];
  useEffect(() => {
    if (candidates.length >= 2) {
      if (!headA || !candidates.find((c) => c.id === headA)) setHeadA(candidates[0].id);
      if (!headB || !candidates.find((c) => c.id === headB)) setHeadB(candidates[1].id);
    }
  }, [candidates, headA, headB]);

  const radarData = useMemo(() => {
    const keys: { key: keyof Scores; label: string }[] = [
      { key: "recall", label: "Lembrança" },
      { key: "approval", label: "Aprovação" },
      { key: "rejection", label: "Resistência Eleitoral" },
      { key: "virality", label: "Viralização" },
      { key: "regionalForce", label: "Penetração" },
      { key: "growth", label: "Crescimento" },
      { key: "authority", label: "Autoridade" },
      { key: "expansion", label: "Expansão" },
    ];
    return keys.map(({ key, label }) => {
      const row: any = { metric: label };
      candidates.forEach((c) => {
        const v = Number((c.scores as any)[key]) || 0;
        row[c.name] = key === "growth" ? (v + 100) / 2 : key === "rejection" ? 100 - v : v;
      });
      return row;
    });
  }, [candidates]);

  const scatterData = useMemo(() => candidates.map((c, i) => ({
    name: c.name, x: c.scores.approval, y: c.scores.strength,
    z: Math.max(20, c.scores.virality), quadrant: c.quadrant, color: PALETTE[i % PALETTE.length],
  })), [candidates]);

  const headACand = candidates.find((c) => c.id === headA);
  const headBCand = candidates.find((c) => c.id === headB);

  const hasNoData = !loading && !data && !error;

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div {...fadeIn} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <HelpTooltip text="Central de inteligência política comparativa, 100% IA. Atualização manual com cache inteligente por período.">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2 text-white">
              <Sparkles className="h-7 w-7 text-primary" />
              Comparação Estratégica
            </h1>
          </HelpTooltip>
          <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Baseado em histórico consolidado + sinais recentes.</span>
              {savedAt && (
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                  {ageLabel(savedAt)}
                </Badge>
              )}
            </div>
            {savedAt && (
              <div className="tabular-nums">
                Última análise: {new Date(savedAt).toLocaleDateString("pt-BR")} {new Date(savedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={runComparison} disabled={loading} className="bg-gradient-to-r from-primary to-fuchsia-500 hover:opacity-90">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar IA
          </Button>
        </div>
      </motion.div>

      <AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LoadingOverlay />
          </motion.div>
        )}
      </AnimatePresence>

      {!loading && error && (
        <Card className="border-destructive/25 bg-destructive/5">
          <CardContent className="py-10 text-center space-y-4">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">A análise está sendo processada</h2>
              <p className="mt-1 text-sm text-muted-foreground">Tente novamente em instantes.</p>
              <p className="mt-2 text-[11px] text-muted-foreground/70">{error}</p>
            </div>
            <Button onClick={runComparison} size="sm">Tentar novamente</Button>
          </CardContent>
        </Card>
      )}

      {hasNoData && (
        <Card className="border-primary/20 bg-gradient-to-br from-background to-primary/5">
          <CardContent className="py-12 text-center space-y-3">
            <Brain className="mx-auto h-10 w-10 text-primary opacity-70" />
            <h2 className="text-lg font-semibold">Nenhuma análise carregada ainda</h2>
            <p className="text-sm text-muted-foreground">Clique em <strong>Atualizar IA</strong> para gerar a comparação estratégica.</p>
            <Button onClick={runComparison} className="bg-gradient-to-r from-primary to-fuchsia-500">
              <Sparkles className="h-4 w-4 mr-2" /> Gerar análise
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && data?.success && data?.empty && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum candidato cadastrado.</CardContent></Card>
      )}

      {!loading && data?.success && candidates.length > 0 && (
        <>
          {/* 1 — Ranking */}
          <motion.div {...fadeIn}>
            <Card className="border-primary/20 bg-gradient-to-br from-background via-background to-primary/5 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-400" />
                  Ranking de Força Política
                  <InfoTip text="Score IA 0–100 calculado por modelo híbrido com pesos regionais, sentimentais e competitivos: regional 25% · aprovação 20% · resistência 20% · viralização 15% · crescimento 10% · dominância 10%." />
                </CardTitle>
                <CardDescription>
                  Pontuação consolidada de cada candidato. Hover/tap nos indicadores para entender cada métrica.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {candidates.map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="grid grid-cols-[28px_1fr_auto] sm:grid-cols-[28px_1fr_160px_auto] items-center gap-3 rounded-lg border border-border/40 bg-card/40 px-3 py-2.5 hover:bg-card/70 transition-colors"
                  >
                    <span className="text-sm font-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      <div className="font-semibold truncate flex items-center gap-2">
                        {c.name}
                        <ConfidenceBadge value={c.confidence} />
                        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/90">
                          Confiança IA {Math.round((c.confidence ?? 0) * 100)}%
                        </Badge>
                        <InfoTip
                          text={`Por que a IA concluiu isso?\n\nArquétipo: ${c.narrativas?.arquetipo ?? "—"}\nTom dominante: ${c.narrativas?.tom ?? "—"}\nStatus: ${c.status} · Momentum: ${c.momentum}\n\nScore final ${c.scores.strength}/100 combina força regional (${c.scores.regionalForce}), aprovação (${c.scores.approval}), resistência (${100 - c.scores.rejection}), viralização (${c.scores.virality}), crescimento (${c.scores.growth >= 0 ? "+" : ""}${c.scores.growth}) e dominância (${c.scores.dominance}).`}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {resolveParty(c.name, c.party)}{c.state ? ` · ${c.state}` : ""}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-2">
                      <div className="w-28 h-2 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-primary via-fuchsia-500 to-amber-400"
                          initial={{ width: 0 }} animate={{ width: `${c.scores.strength}%` }}
                          transition={{ duration: 0.7, delay: i * 0.04 }}
                        />
                      </div>
                      <span className="text-sm font-bold tabular-nums w-9 text-right">{c.scores.strength}</span>
                    </div>
                    <Badge variant="outline" className={STATUS_STYLES[c.status]}>{c.status}</Badge>
                  </motion.div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          {/* 2 — Radar */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Compass className="h-5 w-5 text-primary" />
                  Radar Multidimensional
                </CardTitle>
                <CardDescription>
                  Perfil em 8 dimensões (0–100). Quanto maior a área preenchida, mais robusto o candidato.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const DIM_HELP: Record<string, string> = {
                    "Lembrança": "Percentual estimado de eleitores que reconhecem espontaneamente o nome do candidato. 100 = amplamente conhecido.",
                    "Aprovação": "Nível de percepção positiva com base em sentimento, apoio e comentários favoráveis.",
                    "Resistência Eleitoral": "Mede o quão pouco rejeitado o candidato é. 100 = baixa rejeição.",
                    "Viralização": "Capacidade de gerar repercussão rápida nas redes sociais.",
                    "Penetração": "Capacidade de alcançar diferentes grupos eleitorais (jovens, agro, evangélicos, urbano, etc).",
                    "Crescimento": "Velocidade de evolução política recente em relevância e apoio.",
                    "Autoridade": "Percepção de competência, preparo e liderança política.",
                    "Expansão": "Potencial de crescer em regiões ou públicos onde ainda é fraco.",
                  };
                  return (
                    <>
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {Object.entries(DIM_HELP).map(([dim, desc]) => (
                          <span key={dim} className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-card/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                            {dim}
                            <InfoTip text={desc} iconClassName="h-3 w-3" />
                          </span>
                        ))}
                      </div>
                      <div className="h-[440px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={radarData} outerRadius="75%">
                            <PolarGrid stroke="hsl(var(--border))" />
                            <PolarAngleAxis dataKey="metric" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            {candidates.slice(0, 6).map((c, i) => (
                              <Radar key={c.id} name={c.name} dataKey={c.name}
                                stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]}
                                fillOpacity={0.18} strokeWidth={2} />
                            ))}
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-3 text-center text-xs text-muted-foreground">
                        Quanto maior a área preenchida, mais robusto e competitivo é o candidato em múltiplas dimensões.
                      </p>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </motion.div>

          {/* 3 — Destaques Comparativos */}
          <motion.div {...fadeIn}>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-400" /> Destaques Comparativos
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <BestCard icon={<Flame className="h-4 w-4" />} label="Maior tração digital" entry={data.destaques?.tracaoDigital} accent="from-orange-500/20 to-amber-500/5" />
              <BestCard icon={<TrendingUp className="h-4 w-4" />} label="Maior crescimento" entry={data.destaques?.crescimento} accent="from-sky-500/20 to-sky-500/5" />
              <BestCard icon={<Shield className="h-4 w-4" />} label="Menor rejeição" entry={data.destaques?.menorRejeicao} accent="from-emerald-500/20 to-emerald-500/5" />
              <BestCard icon={<Target className="h-4 w-4" />} label="Maior potencial nacional" entry={data.destaques?.potencialNacional} accent="from-fuchsia-500/20 to-fuchsia-500/5" />
              <BestCard icon={<MapPin className="h-4 w-4" />} label="Melhor região" entry={data.destaques?.melhorRegiao} accent="from-purple-500/20 to-purple-500/5" />
              <BestCard icon={<MapPin className="h-4 w-4" />} label="Melhor estado" entry={data.destaques?.melhorEstado} accent="from-indigo-500/20 to-indigo-500/5" />
              <BestCard icon={<Zap className="h-4 w-4" />} label="Capacidade de viralização" entry={data.destaques?.capacidadeViral} accent="from-rose-500/20 to-rose-500/5" />
              <BestCard icon={<Megaphone className="h-4 w-4" />} label="Narrativa mais forte" entry={data.destaques?.narrativa} accent="from-amber-500/20 to-amber-500/5" />
            </div>
          </motion.div>

          {/* 4 — Matriz Estratégica 2x2 */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" /> Matriz Estratégica 2x2
                </CardTitle>
                <CardDescription>Aprovação (X) × Força Política (Y). Tamanho da bolha = viralização.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[380px] w-full">
                  <ResponsiveContainer>
                    <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis type="number" dataKey="x" name="Aprovação" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12}>
                      </XAxis>
                      <YAxis type="number" dataKey="y" name="Força Política" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <ZAxis type="number" dataKey="z" range={[80, 500]} />
                      <ReferenceLine x={55} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                      <ReferenceLine y={55} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                      <RTooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, n: any) => [v, n]}
                        labelFormatter={() => ""}
                        content={({ payload }: any) => {
                          if (!payload?.[0]) return null;
                          const p = payload[0].payload;
                          return (
                            <div className="rounded-md border border-border bg-card p-2 text-xs">
                              <div className="font-semibold">{p.name}</div>
                              <div>Aprovação: {p.x}</div>
                              <div>Força: {p.y}</div>
                              <div>Quadrante: <span style={{ color: QUADRANT_COLOR[p.quadrant as Quadrant] }}>{p.quadrant}</span></div>
                            </div>
                          );
                        }}
                      />
                      <Scatter data={scatterData}>
                        {scatterData.map((d, i) => (
                          <Cell key={i} fill={QUADRANT_COLOR[d.quadrant as Quadrant]} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-xs">
                  {([
                    { q: "Dominante" as Quadrant, desc: "Alta aprovação + alta força. Liderança consolidada." },
                    { q: "Polarizador" as Quadrant, desc: "Força alta, mas aprovação dividida. Gera reação." },
                    { q: "Promissor" as Quadrant, desc: "Boa aprovação, força em construção." },
                    { q: "Vulnerável" as Quadrant, desc: "Aprovação e força baixas. Risco competitivo." },
                  ]).map(({ q, desc }) => (
                    <div key={q} className="flex items-center gap-2 rounded border border-border/40 bg-card/40 px-2 py-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: QUADRANT_COLOR[q] }} />
                      <span className="text-muted-foreground">{q}</span>
                      <InfoTip text={desc} className="ml-auto" />
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Eixo X = Aprovação · Eixo Y = Força Política · Tamanho da bolha = Viralização.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* 5 — Comparação Direta */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="h-5 w-5 text-primary" /> Comparação Direta
                </CardTitle>
                <CardDescription>Confronto categoria por categoria entre dois candidatos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Select value={headA ?? undefined} onValueChange={setHeadA}>
                    <SelectTrigger><SelectValue placeholder="Candidato A" /></SelectTrigger>
                    <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={headB ?? undefined} onValueChange={setHeadB}>
                    <SelectTrigger><SelectValue placeholder="Candidato B" /></SelectTrigger>
                    <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {headACand && headBCand && headACand.id !== headBCand.id && (
                  <div className="rounded-lg border border-border/40 overflow-hidden divide-y divide-border/30">
                    {[
                      { label: "Popularidade", a: headACand.scores.approval, b: headBCand.scores.approval, higherWins: true },
                      { label: "Resistência Eleitoral", a: 100 - headACand.scores.rejection, b: 100 - headBCand.scores.rejection, higherWins: true },
                      { label: "Penetração regional", a: headACand.scores.regionalForce, b: headBCand.scores.regionalForce, higherWins: true },
                      { label: "Engajamento", a: headACand.scores.virality, b: headBCand.scores.virality, higherWins: true },
                      { label: "Força política", a: headACand.scores.strength, b: headBCand.scores.strength, higherWins: true },
                      { label: "Potencial 2º turno", a: headACand.scores.expansion, b: headBCand.scores.expansion, higherWins: true },
                      { label: "Capacidade de crescimento", a: Math.max(0, headACand.scores.growth), b: Math.max(0, headBCand.scores.growth), higherWins: true },
                    ].map((row, i) => {
                      const aWins = row.higherWins ? row.a > row.b : row.a < row.b;
                      const bWins = row.higherWins ? row.b > row.a : row.b < row.a;
                      const max = Math.max(row.a, row.b, 1);
                      return (
                        <div key={i} className="grid grid-cols-[1fr_120px_1fr] items-center gap-3 px-3 py-2.5 text-sm">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <motion.div className={`h-full ml-auto ${aWins ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
                                initial={{ width: 0 }} animate={{ width: `${(row.a / max) * 100}%` }} transition={{ duration: 0.6 }}
                                style={{ marginLeft: "auto" }}
                              />
                            </div>
                            <span className={`tabular-nums w-9 text-right ${aWins ? "text-emerald-400 font-semibold" : ""}`}>{row.a}</span>
                          </div>
                          <div className="text-xs text-muted-foreground text-center">{row.label}</div>
                          <div className="flex items-center gap-2">
                            <span className={`tabular-nums w-9 ${bWins ? "text-emerald-400 font-semibold" : ""}`}>{row.b}</span>
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <motion.div className={`h-full ${bWins ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
                                initial={{ width: 0 }} animate={{ width: `${(row.b / max) * 100}%` }} transition={{ duration: 0.6 }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* 6 — Narrativa Dominante */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" /> Narrativa Dominante
                </CardTitle>
                <CardDescription>Arquétipo, tom emocional e narrativas (positivas, negativas, neutras).</CardDescription>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-3">
                {candidates.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border/40 bg-card/40 p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="font-semibold">{c.name}</div>
                      <div className="flex gap-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">{c.narrativas.arquetipo}</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">tom: {c.narrativas.tom}</Badge>
                      </div>
                    </div>
                    <NarrativeBlock label="Positivas" items={c.narrativas.positivas} cls="bg-emerald-500/10 text-emerald-300 border-emerald-500/30" />
                    <NarrativeBlock label="Negativas" items={c.narrativas.negativas} cls="bg-rose-500/10 text-rose-300 border-rose-500/30" />
                    <NarrativeBlock label="Neutras" items={c.narrativas.neutras} cls="bg-sky-500/10 text-sky-300 border-sky-500/30" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          {/* 7 — Tendência Temporal */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" /> Tendência Temporal
                </CardTitle>
                <CardDescription>Aceleração de engajamento, mudança de sentimento e crescimento de lembrança.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {candidates.map((c) => {
                  const hasBaseline = (c.scores as any).hasBaseline !== false;
                  const g = Math.max(-100, Math.min(100, c.scores.growth));
                  const mid = 50;
                  const width = Math.abs(g) / 2; // 0..50
                  const positive = g >= 0;
                  return (
                    <div key={c.id} className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-medium truncate">{c.name}</div>
                        {hasBaseline ? <MomentumBadge m={c.momentum} /> : <Badge variant="outline" className="text-[10px]">Sem histórico</Badge>}
                      </div>
                      {hasBaseline ? (
                        <>
                          <div className="text-xs text-muted-foreground">
                            Crescimento {g >= 0 ? "+" : ""}{g}% · Viralização {c.scores.virality}
                          </div>
                          <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                            <motion.div
                              className={`absolute inset-y-0 ${positive ? "bg-emerald-400" : "bg-rose-400"}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${width}%`, left: positive ? `${mid}%` : `${mid - width}%` }}
                              transition={{ duration: 0.7 }}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground italic">Sem histórico suficiente</div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </motion.div>

          {/* 8 — Cenários Eleitorais */}
          {data.cenarios && (
            <motion.div {...fadeIn}>
              <Card className="border-primary/20 bg-gradient-to-br from-fuchsia-500/5 via-background to-amber-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-fuchsia-400" /> Cenários Eleitorais
                  </CardTitle>
                  <CardDescription>Se a eleição fosse hoje — leitura qualitativa IA.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
                  <ScenarioBlock title="Favorito" body={data.cenarios.favorito} tone="amber" />
                  <ScenarioBlock title="Zebra" body={data.cenarios.zebra} tone="fuchsia" />
                  <ScenarioBlock title="Nome em ascensão" body={data.cenarios.ascensao} tone="emerald" />
                  <ScenarioBlock title="Maior risco de colapso" body={data.cenarios.colapso} tone="rose" />
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* 9 — Simulação de Confrontos */}
          <motion.div {...fadeIn}>
            <ConfrontoSimulator candidates={candidates} />
          </motion.div>


          {/* 10 — SWOT */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" /> SWOT Político
                </CardTitle>
                <CardDescription>Forças, Fraquezas, Oportunidades e Ameaças por candidato.</CardDescription>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-3">
                {candidates.map((c) => (
                  <div key={c.id} className="rounded-xl border border-border/40 bg-card/40 p-4">
                    <div className="font-semibold mb-3">{c.name}</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <SwotCell title="Forças" items={c.swot.forcas} cls="border-emerald-500/40 text-emerald-300" />
                      <SwotCell title="Fraquezas" items={c.swot.fraquezas} cls="border-rose-500/40 text-rose-300" />
                      <SwotCell title="Oportunidades" items={c.swot.oportunidades} cls="border-sky-500/40 text-sky-300" />
                      <SwotCell title="Ameaças" items={c.swot.ameacas} cls="border-amber-500/40 text-amber-300" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          {/* 11 — Resumo Executivo */}
          {data.resumo && (
            <motion.div {...fadeIn}>
              <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-fuchsia-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" /> Resumo Executivo IA
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                  <SummaryBlock title="Quem lidera" body={data.resumo.lidera} tone="amber" />
                  <SummaryBlock title="Quem cresce" body={data.resumo.cresce} tone="emerald" />
                  <SummaryBlock title="Quem estagnou" body={data.resumo.estagnou} tone="sky" />
                  <SummaryBlock title="Quem preocupa" body={data.resumo.preocupa} tone="rose" />
                  <SummaryBlock title="Quem pode surpreender" body={data.resumo.surpreende} tone="fuchsia" />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
};

function BestCard({ icon, label, entry, accent }: {
  icon: React.ReactNode; label: string; entry?: BestEntry | null; accent: string;
}) {
  return (
    <div className={`rounded-xl border border-border/40 bg-gradient-to-br ${accent} p-4 transition-transform hover:-translate-y-0.5 duration-300`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">{icon}<span>{label}</span></div>
      <div className="font-semibold truncate">{entry?.name ?? "—"}</div>
      <div className="text-xs text-muted-foreground mt-1">
        {entry ? `Score ${entry.value}${entry.state ? ` · ${entry.state}` : ""}` : "Dados insuficientes"}
      </div>
    </div>
  );
}

function NarrativeBlock({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t, i) => <Badge key={i} variant="outline" className={`text-xs ${cls}`}>{t}</Badge>)}
      </div>
    </div>
  );
}

function SwotCell({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  return (
    <div className={`rounded-md border bg-background/40 p-2 ${cls}`}>
      <div className="font-semibold text-[11px] uppercase tracking-wider mb-1">{title}</div>
      <ul className="space-y-1">
        {(items ?? []).map((it, i) => <li key={i} className="text-foreground/80">• {it}</li>)}
      </ul>
    </div>
  );
}

function ScenarioBlock({ title, body, tone }: { title: string; body: string; tone: "amber" | "emerald" | "fuchsia" | "rose" }) {
  const colors: Record<string, string> = {
    amber: "border-amber-500/30 text-amber-300",
    emerald: "border-emerald-500/30 text-emerald-300",
    fuchsia: "border-fuchsia-500/30 text-fuchsia-300",
    rose: "border-rose-500/30 text-rose-300",
  };
  return (
    <div className={`rounded-lg border ${colors[tone]} bg-card/40 p-3`}>
      <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${colors[tone]}`}>{title}</div>
      <div className="text-sm text-foreground/90">{body}</div>
    </div>
  );
}

function SummaryBlock({ title, body, tone }: { title: string; body: string; tone: "amber" | "emerald" | "sky" | "rose" | "fuchsia" }) {
  const colors: Record<string, string> = {
    amber: "border-amber-500/30 text-amber-300",
    emerald: "border-emerald-500/30 text-emerald-300",
    sky: "border-sky-500/30 text-sky-300",
    rose: "border-rose-500/30 text-rose-300",
    fuchsia: "border-fuchsia-500/30 text-fuchsia-300",
  };
  return (
    <div className={`rounded-lg border ${colors[tone]} bg-card/40 p-3`}>
      <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${colors[tone]}`}>{title}</div>
      <div className="text-sm text-foreground/90">{body}</div>
    </div>
  );
}

// ============= Simulação de Confrontos (interativo) =============
const SIM_DIMENSIONS = [
  "Centro-Oeste", "Sudeste", "Nordeste", "Rural",
  "Urbano", "Jovens", "Evangélicos", "Agro",
];
function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function ConfrontoSimulator({ candidates }: { candidates: CandidateOut[] }) {
  const [candidate1, setCandidate1] = useState<string | null>(null);
  const [candidate2, setCandidate2] = useState<string | null>(null);
  const [result, setResult] = useState<{ a: string; b: string; dims: { dim: string; vencedor: string }[] } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("Candidates loaded:", candidates);
  }, [candidates]);

  const nameById = (id: string | null) => candidates.find((c) => c.id === id)?.name ?? "";

  const compare = () => {
    if (!candidate1 || !candidate2) {
      toast.error("Selecione dois candidatos para comparar");
      return;
    }
    if (candidate1 === candidate2) {
      toast.error("Escolha candidatos diferentes");
      return;
    }
    const a = nameById(candidate1);
    const b = nameById(candidate2);
    const dims = SIM_DIMENSIONS.map((dim) => {
      const sA = hashStr(a + "|" + dim);
      const sB = hashStr(b + "|" + dim);
      return { dim, vencedor: sA >= sB ? a : b };
    });
    setResult({ a, b, dims });
  };

  const invert = () => {
    setCandidate1(candidate2);
    setCandidate2(candidate1);
    if (result) setResult({ a: result.b, b: result.a, dims: result.dims });
  };

  const empty = candidates.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Swords className="h-5 w-5 text-primary" /> Simulação de Confrontos
        </CardTitle>
        <CardDescription>
          {result ? (
            <><span className="font-semibold text-foreground">{result.a}</span> <span className="text-muted-foreground">vs</span> <span className="font-semibold text-foreground">{result.b}</span></>
          ) : (
            "Selecione dois candidatos para simular o confronto."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {empty ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            Nenhum candidato disponível para comparação
          </div>
        ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Candidato 1</label>
            <Select value={candidate1 ?? ""} onValueChange={(v) => setCandidate1(v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar candidato" /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Candidato 2</label>
            <Select value={candidate2 ?? ""} onValueChange={(v) => setCandidate2(v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar candidato" /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        )}


        <Button onClick={compare} disabled={empty} className="w-full rounded-xl h-12 text-base font-semibold">
          <Swords className="h-4 w-4" /> Comparar candidatos
        </Button>

        <Button onClick={invert} disabled={empty} variant="outline" className="w-full rounded-xl">
          <ArrowLeftRight className="h-4 w-4" /> Inverter candidatos
        </Button>

        {result && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {result.dims.map((d) => (
              <div key={d.dim} className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="text-xs text-muted-foreground">{d.dim}</div>
                <div className="font-semibold mt-1 truncate">{d.vencedor}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CandidateComparisonPage;
