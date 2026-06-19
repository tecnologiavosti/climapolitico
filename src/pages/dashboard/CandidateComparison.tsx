import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip as RTooltip,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Crown,
  Flame,
  Shield,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Trophy,
  Compass,
  Brain,
  RefreshCw,
  Swords,
  AlertTriangle,
} from "lucide-react";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface CandidateScores {
  strength: number;
  recall: number;
  approval: number;
  rejection: number;
  virality: number;
  regionalForce: number;
  growth: number;
  dominance: number;
}

interface CandidateOut {
  id: string;
  name: string;
  party: string | null;
  state: string | null;
  scores: CandidateScores;
  status: "Dominante" | "Forte" | "Competitivo" | "Fraco";
  momentum: "up" | "down" | "stable";
  narrativas: { temas: string[]; tom: string | null; arquetipo: string | null };
  momentumNota: string | null;
}

interface ApiResponse {
  success: boolean;
  empty?: boolean;
  message?: string;
  candidates?: CandidateOut[];
  bestInClass?: {
    traction: { name: string; value: number } | null;
    lowestRejection: { name: string; value: number } | null;
    growth: { name: string; value: number } | null;
    centroOeste: { nome: string; justificativa: string } | null;
    overall: { name: string; value: number } | null;
  };
  summary?: { lidera: string; cresce: string; estagnou: string; preocupa: string } | null;
}

interface RawCandidate {
  id: string;
  full_name: string;
  party: string | null;
  region: string | null;
}

interface RawMetrics {
  candidate_id: string;
  total_mentions: number | null;
  unique_authors: number | null;
  total_engagement: number | null;
  average_sentiment: number | null;
  positive_count: number | null;
  negative_count: number | null;
  neutral_count: number | null;
}

const STATUS_STYLES: Record<CandidateOut["status"], string> = {
  Dominante: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Forte: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Competitivo: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  Fraco: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const PALETTE = [
  "hsl(45 95% 60%)",
  "hsl(160 70% 50%)",
  "hsl(210 90% 60%)",
  "hsl(340 80% 60%)",
  "hsl(280 75% 65%)",
  "hsl(20 85% 60%)",
];

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

function ScanningSkeleton() {
  const steps = [
    "IA analisando força eleitoral…",
    "Comparando momentum…",
    "Calculando rejeição relativa…",
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card/40 p-6 relative overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {steps.map((step, i) => (
            <motion.div
              key={step}
              className="inline-flex items-center gap-2"
              animate={{ opacity: [0.45, 1, 0.45] }}
              transition={{ duration: 1.7, repeat: Infinity, delay: i * 0.35 }}
            >
              <Brain className="h-4 w-4 text-primary" />
              <span>{step}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-6 grid lg:grid-cols-[1.1fr_.9fr] gap-5">
          <div className="space-y-3">
            {[82, 68, 54, 41].map((width, i) => (
              <div key={i} className="grid grid-cols-[28px_1fr_64px] items-center gap-3 rounded-lg border border-border/40 bg-card/40 px-3 py-3">
                <Skeleton className="h-4 w-5" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-44 max-w-full" />
                  <Skeleton className="h-2 rounded-full" style={{ width: `${width}%` }} />
                </div>
                <Skeleton className="h-6 w-14 rounded-full" />
              </div>
            ))}
          </div>
          <div className="relative min-h-[230px] rounded-xl border border-border/40 bg-card/30 overflow-hidden p-5">
            <div className="absolute inset-8 rounded-full border border-primary/20" />
            <div className="absolute inset-14 rounded-full border border-primary/15" />
            <div className="absolute left-1/2 top-6 bottom-6 border-l border-primary/15" />
            <div className="absolute top-1/2 left-6 right-6 border-t border-primary/15" />
            <Skeleton className="absolute left-[22%] top-[24%] h-3 w-24" />
            <Skeleton className="absolute right-[18%] top-[38%] h-3 w-28" />
            <Skeleton className="absolute left-[32%] bottom-[25%] h-3 w-32" />
          </div>
        </div>
        <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary/10 to-transparent animate-[scan_2.2s_linear_infinite]" />
      </div>
      <style>{`@keyframes scan { 0% { transform: translateX(0) } 100% { transform: translateX(400%) } }`}</style>
    </div>
  );
}

function MomentumBadge({ momentum }: { momentum: CandidateOut["momentum"] }) {
  if (momentum === "up")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-medium">
        <TrendingUp className="h-3.5 w-3.5" /> Subindo
      </span>
    );
  if (momentum === "down")
    return (
      <span className="inline-flex items-center gap-1 text-rose-400 text-xs font-medium">
        <TrendingDown className="h-3.5 w-3.5" /> Caindo
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs font-medium">
      <Minus className="h-3.5 w-3.5" /> Estável
    </span>
  );
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeMax(value: number, max: number): number {
  if (max <= 0) return 0;
  return clampScore((value / max) * 100);
}

function statusFromScore(score: number): CandidateOut["status"] {
  if (score >= 75) return "Dominante";
  if (score >= 55) return "Forte";
  if (score >= 35) return "Competitivo";
  return "Fraco";
}

function momentumFromGrowth(growth: number): CandidateOut["momentum"] {
  if (growth >= 15) return "up";
  if (growth <= -15) return "down";
  return "stable";
}

function buildComparisonFromMetrics(candidatesRaw: RawCandidate[], metricsRaw: RawMetrics[]): ApiResponse {
  const metricsByCandidate = new Map(metricsRaw.map((m) => [m.candidate_id, m]));
  const maxMentions = Math.max(1, ...candidatesRaw.map((c) => metricsByCandidate.get(c.id)?.total_mentions ?? 0));
  const maxAuthors = Math.max(1, ...candidatesRaw.map((c) => metricsByCandidate.get(c.id)?.unique_authors ?? 0));
  const maxEngagement = Math.max(1, ...candidatesRaw.map((c) => metricsByCandidate.get(c.id)?.total_engagement ?? 0));

  const candidates: CandidateOut[] = candidatesRaw
    .map((candidate) => {
      const metrics = metricsByCandidate.get(candidate.id);
      const mentions = metrics?.total_mentions ?? 0;
      const authors = metrics?.unique_authors ?? 0;
      const engagement = metrics?.total_engagement ?? 0;
      const positive = metrics?.positive_count ?? 0;
      const negative = metrics?.negative_count ?? 0;
      const neutral = metrics?.neutral_count ?? 0;
      const totalSentiment = positive + negative + neutral;
      const approval = totalSentiment > 0 ? (positive / totalSentiment) * 100 : 50;
      const rejection = totalSentiment > 0 ? (negative / totalSentiment) * 100 : 30;
      const recall = normalizeMax(mentions, maxMentions);
      const dominance = normalizeMax(authors, maxAuthors);
      const virality = mentions > 0 ? normalizeMax(engagement / Math.max(1, mentions), maxEngagement / Math.max(1, maxMentions)) : 0;
      const sentiment = Number(metrics?.average_sentiment ?? 0);
      const growth = clampScore((sentiment + 100) / 2) - 50;
      const growthNorm = (growth + 100) / 2;
      const regionalForce = clampScore(recall * 0.6 + dominance * 0.4);
      const strength = clampScore(regionalForce * 0.25 + approval * 0.2 + (100 - rejection) * 0.2 + virality * 0.15 + growthNorm * 0.1 + dominance * 0.1);
      const highRejection = rejection >= 50;
      const highRegional = regionalForce >= 65;

      return {
        id: candidate.id,
        name: candidate.full_name,
        party: candidate.party,
        state: candidate.region,
        scores: {
          strength,
          recall,
          approval: clampScore(approval),
          rejection: clampScore(rejection),
          virality,
          regionalForce,
          growth: Math.max(-100, Math.min(100, Math.round(growth))),
          dominance,
        },
        status: statusFromScore(strength),
        momentum: momentumFromGrowth(growth),
        narrativas: {
          temas: [
            highRegional ? "força regional" : "presença regional",
            highRejection ? "rejeição" : "aprovação relativa",
            virality >= 60 ? "tração digital" : "alcance orgânico",
            candidate.region ?? "base nacional",
          ].slice(0, 4),
          tom: highRejection ? "polarizado" : growth >= 15 ? "ascendente" : "competitivo",
          arquetipo: highRegional ? "Liderança regional consolidada" : highRejection ? "Polarizador competitivo" : "Competidor em consolidação",
        },
        momentumNota: growth >= 15 ? "Indicadores locais sugerem aceleração recente." : growth <= -15 ? "Indicadores locais sugerem perda de ritmo." : "Indicadores locais sugerem estabilidade competitiva.",
      };
    })
    .sort((a, b) => b.scores.strength - a.scores.strength);

  const leader = candidates[0];
  const fastestGrowth = [...candidates].sort((a, b) => b.scores.growth - a.scores.growth)[0];
  const highestRejection = [...candidates].sort((a, b) => b.scores.rejection - a.scores.rejection)[0];
  const stagnant = [...candidates].sort((a, b) => Math.abs(a.scores.growth) - Math.abs(b.scores.growth))[0];

  return {
    success: true,
    empty: candidates.length === 0,
    message: "Comparação gerada com fallback local.",
    candidates,
    bestInClass: {
      traction: [...candidates].sort((a, b) => b.scores.virality - a.scores.virality)[0] ? { name: [...candidates].sort((a, b) => b.scores.virality - a.scores.virality)[0].name, value: [...candidates].sort((a, b) => b.scores.virality - a.scores.virality)[0].scores.virality } : null,
      lowestRejection: [...candidates].sort((a, b) => a.scores.rejection - b.scores.rejection)[0] ? { name: [...candidates].sort((a, b) => a.scores.rejection - b.scores.rejection)[0].name, value: [...candidates].sort((a, b) => a.scores.rejection - b.scores.rejection)[0].scores.rejection } : null,
      growth: fastestGrowth ? { name: fastestGrowth.name, value: fastestGrowth.scores.growth } : null,
      centroOeste: leader ? { nome: leader.name, justificativa: "Fallback local: melhor score ponderado com os dados disponíveis." } : null,
      overall: leader ? { name: leader.name, value: leader.scores.strength } : null,
    },
    summary: {
      lidera: leader ? `${leader.name} lidera pelo melhor score estratégico local (${leader.scores.strength}/100).` : "Sem liderança definida.",
      cresce: fastestGrowth ? `${fastestGrowth.name} tem o maior sinal relativo de crescimento.` : "Sem crescimento detectado.",
      estagnou: stagnant ? `${stagnant.name} apresenta menor oscilação nos indicadores disponíveis.` : "Sem estagnação clara.",
      preocupa: highestRejection ? `${highestRejection.name} concentra a maior rejeição relativa (${highestRejection.scores.rejection}/100).` : "Sem risco dominante mapeado.",
    },
  };
}

const CandidateComparisonPage = () => {
  const { user } = useAuth();
  const [headA, setHeadA] = useState<string | null>(null);
  const [headB, setHeadB] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch, error } = useQuery<ApiResponse>({
    queryKey: ["ai-candidate-comparison", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-candidate-comparison", { body: {} });
      if (error) throw error;
      return data as ApiResponse;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  const candidates = data?.candidates ?? [];

  useEffect(() => {
    if (candidates.length >= 2 && !headA && !headB) {
      setHeadA(candidates[0].id);
      setHeadB(candidates[1].id);
    }
  }, [candidates, headA, headB]);

  const radarData = useMemo(() => {
    const keys: { key: keyof CandidateScores; label: string }[] = [
      { key: "recall", label: "Recall" },
      { key: "approval", label: "Aprovação" },
      { key: "rejection", label: "Rejeição" },
      { key: "virality", label: "Viralização" },
      { key: "regionalForce", label: "Penetração" },
      { key: "growth", label: "Momentum" },
    ];
    return keys.map(({ key, label }) => {
      const row: any = { metric: label };
      candidates.forEach((c) => {
        const v = c.scores[key];
        row[c.name] = key === "growth" ? (v + 100) / 2 : v;
      });
      return row;
    });
  }, [candidates]);

  const headACand = candidates.find((c) => c.id === headA);
  const headBCand = candidates.find((c) => c.id === headB);

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div {...fadeIn} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <HelpTooltip text="Comparativo estratégico IA-first: ranking, radar, narrativas, head-to-head e momentum.">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-7 w-7 text-primary" />
              Comparação Estratégica
            </h1>
          </HelpTooltip>
          <p className="text-muted-foreground mt-1 text-sm">
            Inteligência política comparativa — não métricas brutas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar análise
        </Button>
      </motion.div>

      {isLoading && <ScanningSkeleton />}

      {!isLoading && (error || data?.success === false) && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-muted-foreground">
              {data?.message ?? "A análise está sendo processada. Tente novamente em instantes."}
            </p>
            <Button onClick={() => refetch()} size="sm">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.success && data?.empty && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum candidato cadastrado.
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.success && candidates.length > 0 && (
        <>
          {/* SECTION 1 — Political Strength Ranking */}
          <motion.div {...fadeIn}>
            <Card className="border-primary/20 bg-gradient-to-br from-background via-background to-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-400" />
                  Political Strength Ranking
                </CardTitle>
                <CardDescription>
                  Score 0–100 ponderado: regional 25% · aprovação 20% · rejeição inversa 20% · viralização 15% ·
                  crescimento 10% · dominância 10%.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {candidates.map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="grid grid-cols-[28px_1fr_auto] sm:grid-cols-[28px_1fr_120px_auto] items-center gap-3 rounded-lg border border-border/40 bg-card/40 px-3 py-2.5 hover:bg-card/70 transition-colors"
                  >
                    <span className="text-sm font-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.party ?? "Sem partido"}
                        {c.state ? ` · ${c.state}` : ""}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-amber-400 transition-all duration-700"
                          style={{ width: `${c.scores.strength}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold tabular-nums w-9 text-right">{c.scores.strength}</span>
                    </div>
                    <Badge variant="outline" className={STATUS_STYLES[c.status]}>
                      {c.status}
                    </Badge>
                  </motion.div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          {/* SECTION 2 — Radar */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Compass className="h-5 w-5 text-primary" />
                  Radar Comparativo
                </CardTitle>
                <CardDescription>Perfil multidimensional dos candidatos (0–100).</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[420px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} outerRadius="75%">
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <RTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {candidates.slice(0, 6).map((c, i) => (
                        <Radar
                          key={c.id}
                          name={c.name}
                          dataKey={c.name}
                          stroke={PALETTE[i % PALETTE.length]}
                          fill={PALETTE[i % PALETTE.length]}
                          fillOpacity={0.18}
                          strokeWidth={2}
                        />
                      ))}
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* SECTION 3 — Best in Class */}
          <motion.div {...fadeIn}>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-400" />
              Best in Class
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <BestCard
                icon={<Flame className="h-4 w-4" />}
                label="Maior tração digital"
                name={data.bestInClass?.traction?.name}
                hint={`${data.bestInClass?.traction?.value ?? 0}/100`}
                accent="from-orange-500/20 to-amber-500/5"
              />
              <BestCard
                icon={<Shield className="h-4 w-4" />}
                label="Menor rejeição"
                name={data.bestInClass?.lowestRejection?.name}
                hint={`${data.bestInClass?.lowestRejection?.value ?? 0}% rejeição`}
                accent="from-emerald-500/20 to-emerald-500/5"
              />
              <BestCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Maior crescimento"
                name={data.bestInClass?.growth?.name}
                hint={`${data.bestInClass?.growth?.value ?? 0}% 7d`}
                accent="from-sky-500/20 to-sky-500/5"
              />
              <BestCard
                icon={<Compass className="h-4 w-4" />}
                label="Melhor no Centro-Oeste"
                name={data.bestInClass?.centroOeste?.nome}
                hint={data.bestInClass?.centroOeste?.justificativa ?? "—"}
                accent="from-purple-500/20 to-purple-500/5"
              />
              <BestCard
                icon={<Trophy className="h-4 w-4" />}
                label="Melhor no Brasil"
                name={data.bestInClass?.overall?.name}
                hint={`Score ${data.bestInClass?.overall?.value ?? 0}`}
                accent="from-amber-500/20 to-amber-500/5"
              />
            </div>
          </motion.div>

          {/* SECTION 4 — Narrativas Dominantes */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  Narrativas Dominantes
                </CardTitle>
                <CardDescription>Temas, tom emocional e arquétipo político por candidato.</CardDescription>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-3">
                {candidates.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border/40 bg-card/40 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{c.name}</div>
                      {c.narrativas.arquetipo && (
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                          {c.narrativas.arquetipo}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.narrativas.temas.length > 0 ? (
                        c.narrativas.temas.map((t, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {t}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem narrativas mapeadas.</span>
                      )}
                    </div>
                    {c.narrativas.tom && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/70">Tom:</span> {c.narrativas.tom}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          {/* SECTION 5 — Head-to-Head */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="h-5 w-5 text-primary" />
                  Head-to-Head
                </CardTitle>
                <CardDescription>Comparação direta categoria por categoria.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Select value={headA ?? undefined} onValueChange={setHeadA}>
                    <SelectTrigger><SelectValue placeholder="Candidato A" /></SelectTrigger>
                    <SelectContent>
                      {candidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={headB ?? undefined} onValueChange={setHeadB}>
                    <SelectTrigger><SelectValue placeholder="Candidato B" /></SelectTrigger>
                    <SelectContent>
                      {candidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {headACand && headBCand && headACand.id !== headBCand.id && (
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    {[
                      { label: "Popularidade", a: headACand.scores.approval, b: headBCand.scores.approval, higherWins: true },
                      { label: "Rejeição", a: headACand.scores.rejection, b: headBCand.scores.rejection, higherWins: false },
                      { label: "Penetração regional", a: headACand.scores.regionalForce, b: headBCand.scores.regionalForce, higherWins: true },
                      { label: "Engajamento (viralização)", a: headACand.scores.virality, b: headBCand.scores.virality, higherWins: true },
                      { label: "Potencial eleitoral (Strength)", a: headACand.scores.strength, b: headBCand.scores.strength, higherWins: true },
                    ].map((row, i) => {
                      const aWins = row.higherWins ? row.a > row.b : row.a < row.b;
                      const tie = row.a === row.b;
                      return (
                        <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2 border-b border-border/30 last:border-0 text-sm">
                          <div className={`text-right tabular-nums ${!tie && aWins ? "text-emerald-400 font-semibold" : ""}`}>
                            {row.a}
                          </div>
                          <div className="text-xs text-muted-foreground text-center min-w-[140px]">{row.label}</div>
                          <div className={`tabular-nums ${!tie && !aWins ? "text-emerald-400 font-semibold" : ""}`}>
                            {row.b}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* SECTION 6 — Momentum */}
          <motion.div {...fadeIn}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Momentum
                </CardTitle>
                <CardDescription>Tendência baseada em variação temporal de menções (7d vs 7d).</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {candidates.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border/40 bg-card/40 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-medium truncate">{c.name}</div>
                      <MomentumBadge momentum={c.momentum} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.momentumNota ?? `Variação ${c.scores.growth >= 0 ? "+" : ""}${c.scores.growth}%`}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          {/* SECTION 7 — Resumo Estratégico */}
          {data.summary && (
            <motion.div {...fadeIn}>
              <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Resumo Estratégico IA
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
                  <SummaryBlock title="Quem lidera" body={data.summary.lidera} tone="amber" />
                  <SummaryBlock title="Quem cresce" body={data.summary.cresce} tone="emerald" />
                  <SummaryBlock title="Quem estagnou" body={data.summary.estagnou} tone="sky" />
                  <SummaryBlock title="Quem preocupa" body={data.summary.preocupa} tone="rose" />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
};

function BestCard({
  icon,
  label,
  name,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  name?: string | null;
  hint?: string;
  accent: string;
}) {
  return (
    <div className={`rounded-xl border border-border/40 bg-gradient-to-br ${accent} p-4 transition-transform hover:-translate-y-0.5 duration-300`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-semibold truncate">{name ?? "—"}</div>
      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{hint}</div>
    </div>
  );
}

function SummaryBlock({ title, body, tone }: { title: string; body: string; tone: "amber" | "emerald" | "sky" | "rose" }) {
  const colors: Record<string, string> = {
    amber: "border-amber-500/30 text-amber-400",
    emerald: "border-emerald-500/30 text-emerald-400",
    sky: "border-sky-500/30 text-sky-400",
    rose: "border-rose-500/30 text-rose-400",
  };
  return (
    <div className={`rounded-lg border ${colors[tone]} bg-card/40 p-3`}>
      <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${colors[tone]}`}>{title}</div>
      <div className="text-sm text-foreground/90">{body}</div>
    </div>
  );
}

export default CandidateComparisonPage;
