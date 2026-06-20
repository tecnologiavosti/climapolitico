import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/DateRangePicker";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Sparkles, Target, Megaphone, AlertTriangle, Brain,
  Loader2, CheckCircle2, Instagram, Music2, Mic2, Tv, MapPin, Flame,
  Grid3x3, Activity, Heart, Shield, ShieldAlert, Swords,
} from "lucide-react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";

interface DNA {
  emocao: number; autoridade: number; carisma: number;
  confianca: number; combatividade: number; proximidade: number;
}
interface QuadrantMetrics {
  electoral_impact: number; reputational_risk: number; conversion_rate: number; summary: string;
}
interface Recommendations {
  central_narrative: string;
  archetype: string;
  archetype_rationale: string;
  public_perception: string;
  ideological_position: string;
  emotional_force: number;
  narrative_dna: DNA;
  narrative_gaps: { topic: string; opportunity: string; why: string }[];
  high_conversion_narratives: { narrative: string; score: number; target_audience: string; rationale: string }[];
  harmful_narratives: { narrative: string; risk: string; mitigation: string }[];
  discourse_matrix?: {
    conservador: QuadrantMetrics; moderado: QuadrantMetrics;
    economico: QuadrantMetrics; polarizador: QuadrantMetrics;
  };
  narrative_elasticity?: { score: number; label: string; explanation: string };
  emotional_triggers?: { emotion: string; score: number; why: string }[];
  attack_surface?: {
    high: { vector: string; why: string }[];
    medium: { vector: string; why: string }[];
    low: { vector: string; why: string }[];
  };
  counter_narratives?: { attack: string; response: string; channel: string }[];
  channel_plan: Record<string, { strategy: string; tone: string; content_examples: string[] }>;
  confidence: number;
}

const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "365", label: "Último ano" },
  { value: "custom", label: "Personalizado" },
];

const LOADING_STAGES = [
  "Analisando posicionamento",
  "Detectando arquétipo",
  "Mapeando vulnerabilidades",
  "Calculando elasticidade narrativa",
  "Finalizando estratégia de war room",
];

const CHANNEL_META: Record<string, { label: string; icon: any; gradient: string }> = {
  instagram: { label: "Instagram", icon: Instagram, gradient: "from-pink-500/20 to-purple-500/20" },
  tiktok:    { label: "TikTok",    icon: Music2,    gradient: "from-rose-500/20 to-cyan-500/20" },
  debates:   { label: "Debates",   icon: Mic2,      gradient: "from-amber-500/20 to-orange-500/20" },
  tv:        { label: "TV",        icon: Tv,        gradient: "from-blue-500/20 to-indigo-500/20" },
  interior:  { label: "Interior",  icon: MapPin,    gradient: "from-emerald-500/20 to-teal-500/20" },
};

const QUADRANT_META: Record<string, { label: string; gradient: string; border: string }> = {
  conservador: { label: "Conservador", gradient: "from-blue-600/15 to-indigo-600/15", border: "border-blue-500/30" },
  moderado:    { label: "Moderado",    gradient: "from-emerald-600/15 to-teal-600/15", border: "border-emerald-500/30" },
  economico:   { label: "Econômico",   gradient: "from-amber-600/15 to-orange-600/15", border: "border-amber-500/30" },
  polarizador: { label: "Polarizador", gradient: "from-rose-600/15 to-fuchsia-600/15", border: "border-rose-500/30" },
};

const TIPS = {
  emotional_force: "Mede quanto a comunicação do candidato desperta emoções fortes no eleitor.",
  public_perception: "Síntese de como o eleitorado médio enxerga o candidato hoje, com base em arquétipo e posicionamento estimado.",
  dna: "Perfil de comunicação em 6 dimensões: emoção, autoridade, carisma, confiança, combatividade e proximidade.",
  gaps: "Temas pouco explorados pelo candidato com alto potencial de retorno eleitoral.",
  conversion: "Score estimado pela IA de quanto a narrativa converte indecisos em apoiadores.",
  elasticity: "Capacidade do candidato de reposicionar discurso sem perder a base de apoio atual.",
  triggers: "Emoções que mais geram conversão de apoio quando ativadas pelo discurso do candidato.",
  attack: "Vetores pelos quais adversários podem atacar reputação ou narrativa do candidato.",
  matrix: "Avalia o efeito eleitoral, risco reputacional e taxa de conversão para cada postura de discurso.",
  counter: "Respostas estratégicas pré-formuladas para ataques previsíveis no ciclo eleitoral.",
};

const glass =
  "backdrop-blur-xl bg-white/5 dark:bg-white/[0.03] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.12)]";

function ScoreBar({ value, color = "from-blue-500 to-violet-500" }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className={`h-full bg-gradient-to-r ${color}`}
      />
    </div>
  );
}

function LoadingStages() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STAGES.length)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className={glass}>
      <CardContent className="py-8 space-y-5">
        <Progress value={(step / LOADING_STAGES.length) * 100} className="h-1.5" />
        <ul className="space-y-2">
          {LOADING_STAGES.map((s, i) => (
            <motion.li
              key={s}
              initial={{ opacity: 0.3, x: -8 }}
              animate={{ opacity: i < step ? 1 : 0.4, x: i < step ? 0 : -4 }}
              className="flex items-center gap-3 text-sm"
            >
              {i < step ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : i === step ? (
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
              )}
              <span className={i < step ? "text-foreground" : "text-muted-foreground"}>{s}</span>
            </motion.li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const NarrativeRecommendationsPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("7");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [result, setResult] = useState<{
    recommendations: Recommendations | null; fallback?: boolean; message?: string;
    candidate?: any; period?: any; ai_provider?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { data: candidates = [] } = useQuery({
    queryKey: ["candidates-narr", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates").select("id, full_name, party").order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleGenerate = async () => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    setIsLoading(true); setResult(null);
    try {
      const payload: any = { mode: "full", candidateId: selectedCandidate };
      if (selectedPeriod === "custom" && dateRange?.from && dateRange?.to) {
        payload.startDate = dateRange.from.toISOString();
        payload.endDate = dateRange.to.toISOString();
      } else {
        payload.daysBack = parseInt(selectedPeriod) || 7;
      }
      const { data, error } = await supabase.functions.invoke(
        "generate-narrative-recommendations", { body: payload }
      );
      if (error) throw error;
      setResult(data);
      if (data?.fallback || !data?.recommendations) {
        toast.error(data?.message || "IA temporariamente indisponível");
      } else {
        toast.success("Inteligência estratégica gerada!");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Erro ao gerar");
    } finally {
      setIsLoading(false);
    }
  };

  const rec = result?.recommendations;

  const radarData = useMemo(() => {
    if (!rec?.narrative_dna) return [];
    const d = rec.narrative_dna;
    return [
      { dim: "Emoção", v: d.emocao },
      { dim: "Autoridade", v: d.autoridade },
      { dim: "Carisma", v: d.carisma },
      { dim: "Confiança", v: d.confianca },
      { dim: "Combatividade", v: d.combatividade },
      { dim: "Proximidade", v: d.proximidade },
    ];
  }, [rec]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-violet-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
          Recomendações de Narrativa
        </h1>
        <p className="text-muted-foreground mt-1">
          Central de inteligência de campanha — arquétipo, vulnerabilidades, counter-narratives e estratégia de war room.
        </p>
      </div>

      {/* Controls */}
      <Card className={glass}>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="Selecione um candidato" /></SelectTrigger>
              <SelectContent>
                {candidates.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}{c.party ? ` (${c.party})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedPeriod === "custom" && (
              <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} className="w-[320px]" />
            )}

            <Button
              onClick={handleGenerate}
              disabled={isLoading || !selectedCandidate}
              className="bg-gradient-to-r from-violet-600 to-blue-600 hover:opacity-90"
            >
              {isLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</>) :
                (<><Sparkles className="mr-2 h-4 w-4" />Gerar Inteligência</>)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && <LoadingStages />}

      {result && !rec && !isLoading && (
        <Card className={glass}>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-400 mb-3" />
            <p className="text-muted-foreground">{result.message || "Sem dados."}</p>
          </CardContent>
        </Card>
      )}

      <AnimatePresence>
        {rec && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Central Narrative */}
            <Card className={`${glass} border-violet-500/30`}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <Target className="h-7 w-7 text-violet-400 mt-1 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs uppercase tracking-wider text-violet-300">Narrativa Central Recomendada</span>
                      <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                        Arquétipo: {rec.archetype}
                      </Badge>
                      <Badge variant="outline" className="ml-auto">
                        Confiança IA: {Math.round(rec.confidence ?? 0)}%
                      </Badge>
                    </div>
                    <p className="text-xl font-semibold leading-snug">{rec.central_narrative}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
                      <div className="rounded-lg border border-white/10 p-3">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          Percepção pública <InfoTip text={TIPS.public_perception} iconClassName="h-3 w-3" />
                        </div>
                        <div>{rec.public_perception}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 p-3">
                        <div className="text-xs text-muted-foreground mb-1">Posicionamento ideológico</div>
                        <div>{rec.ideological_position}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 p-3">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          Força emocional <InfoTip text={TIPS.emotional_force} iconClassName="h-3 w-3" />
                        </div>
                        <div className="text-2xl font-bold">{Math.round(rec.emotional_force ?? 0)}</div>
                        <ScoreBar value={rec.emotional_force ?? 0} color="from-rose-500 to-amber-500" />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Matriz de Discurso Estratégico */}
            {rec.discourse_matrix && (
              <Card className={glass}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Grid3x3 className="h-5 w-5 text-blue-400" /> Matriz de Discurso Estratégico
                    <InfoTip text={TIPS.matrix} />
                  </CardTitle>
                  <CardDescription>Impacto eleitoral, risco reputacional e conversão por postura.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {(["conservador", "moderado", "economico", "polarizador"] as const).map((k, i) => {
                    const q = rec.discourse_matrix![k];
                    const meta = QUADRANT_META[k];
                    return (
                      <motion.div
                        key={k}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                        className={`rounded-xl border ${meta.border} bg-gradient-to-br ${meta.gradient} p-4 hover:scale-[1.02] transition-transform`}
                      >
                        <div className="font-semibold mb-3">{meta.label}</div>
                        <div className="space-y-3 text-xs">
                          <div>
                            <div className="flex justify-between mb-1">
                              <span className="text-muted-foreground">Impacto eleitoral</span>
                              <span className="font-semibold">{Math.round(q.electoral_impact)}</span>
                            </div>
                            <ScoreBar value={q.electoral_impact} color="from-blue-500 to-cyan-400" />
                          </div>
                          <div>
                            <div className="flex justify-between mb-1">
                              <span className="text-muted-foreground">Risco reputacional</span>
                              <span className="font-semibold">{Math.round(q.reputational_risk)}</span>
                            </div>
                            <ScoreBar value={q.reputational_risk} color="from-rose-500 to-orange-400" />
                          </div>
                          <div>
                            <div className="flex justify-between mb-1">
                              <span className="text-muted-foreground">Taxa de conversão</span>
                              <span className="font-semibold">{Math.round(q.conversion_rate)}</span>
                            </div>
                            <ScoreBar value={q.conversion_rate} color="from-emerald-500 to-teal-400" />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{q.summary}</p>
                      </motion.div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Elasticidade + Triggers */}
            <div className="grid gap-6 lg:grid-cols-2">
              {rec.narrative_elasticity && (
                <Card className={glass}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-cyan-400" /> Elasticidade Narrativa
                      <InfoTip text={TIPS.elasticity} />
                    </CardTitle>
                    <CardDescription>Reposicionamento sem perder base.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-end gap-3">
                      <div className="text-5xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                        {Math.round(rec.narrative_elasticity.score)}
                      </div>
                      <div className="text-sm text-muted-foreground pb-2">/ 100</div>
                      <Badge variant="outline" className="ml-auto">{rec.narrative_elasticity.label}</Badge>
                    </div>
                    <ScoreBar value={rec.narrative_elasticity.score} color="from-cyan-500 to-blue-500" />
                    <p className="text-sm text-muted-foreground leading-relaxed">{rec.narrative_elasticity.explanation}</p>
                  </CardContent>
                </Card>
              )}

              {rec.emotional_triggers && rec.emotional_triggers.length > 0 && (
                <Card className={glass}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Heart className="h-5 w-5 text-rose-400" /> Triggers Emocionais do Eleitor
                      <InfoTip text={TIPS.triggers} />
                    </CardTitle>
                    <CardDescription>Emoções que mais convertem apoio.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {rec.emotional_triggers.map((t, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      >
                        <div className="flex justify-between text-sm mb-1">
                          <span className="capitalize font-medium">{t.emotion}</span>
                          <span className="text-muted-foreground">{Math.round(t.score)}</span>
                        </div>
                        <ScoreBar value={t.score} color="from-rose-500 via-fuchsia-500 to-violet-500" />
                        <p className="text-xs text-muted-foreground mt-1">{t.why}</p>
                      </motion.div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* DNA Radar + Vacuums */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className={glass}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-cyan-400" /> Radar DNA Narrativo
                    <InfoTip text={TIPS.dna} />
                  </CardTitle>
                  <CardDescription>Perfil de comunicação em 6 dimensões.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                        <Radar name="DNA" dataKey="v" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.4} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className={glass}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-amber-400" /> Vácuos Narrativos
                    <InfoTip text={TIPS.gaps} />
                  </CardTitle>
                  <CardDescription>Oportunidades pouco exploradas com alto retorno.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rec.narrative_gaps?.map((g, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="rounded-lg border border-white/10 p-3 hover:border-amber-500/40 transition-colors"
                    >
                      <div className="font-semibold">{g.topic}</div>
                      <div className="text-sm text-muted-foreground mt-1">{g.opportunity}</div>
                      <div className="text-xs text-amber-300/80 mt-2">Por quê: {g.why}</div>
                    </motion.div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Conversion narratives */}
            <Card className={`${glass} border-emerald-500/20`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-300">
                  <Megaphone className="h-5 w-5" /> Narrativas com Maior Potencial de Conversão
                  <InfoTip text={TIPS.conversion} />
                </CardTitle>
                <CardDescription>Score 0–100 estimado pela IA para mover indecisos.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {rec.high_conversion_narratives?.map((n, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 hover:bg-emerald-500/[0.08] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">{n.narrative}</span>
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">{Math.round(n.score)}</Badge>
                    </div>
                    <ScoreBar value={n.score} color="from-emerald-500 to-teal-400" />
                    <div className="text-xs text-muted-foreground mt-2">🎯 {n.target_audience}</div>
                    <div className="text-sm mt-2">{n.rationale}</div>
                  </motion.div>
                ))}
              </CardContent>
            </Card>

            {/* Superfície de Ataque */}
            {rec.attack_surface && (
              <Card className={glass}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-rose-400" /> Superfície de Ataque
                    <InfoTip text={TIPS.attack} />
                  </CardTitle>
                  <CardDescription>Onde adversários podem atacar — agrupado por vulnerabilidade.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  {([
                    { key: "high",   label: "Alta vulnerabilidade",   wrap: "border-rose-500/30 bg-rose-500/[0.04]",       text: "text-rose-300",    Icon: ShieldAlert },
                    { key: "medium", label: "Média vulnerabilidade",  wrap: "border-amber-500/30 bg-amber-500/[0.04]",     text: "text-amber-300",   Icon: Shield },
                    { key: "low",    label: "Baixa vulnerabilidade",  wrap: "border-emerald-500/30 bg-emerald-500/[0.04]", text: "text-emerald-300", Icon: Shield },
                  ] as const).map(({ key, label, wrap, text, Icon }) => (
                    <div key={key} className={`rounded-xl border p-4 ${wrap}`}>
                      <div className={`flex items-center gap-2 mb-3 font-semibold ${text}`}>
                        <Icon className="h-4 w-4" /> {label}
                      </div>
                      <ul className="space-y-2">
                        {(rec.attack_surface![key] || []).map((a, i) => (
                          <li key={i} className="text-sm">
                            <div className="font-medium">{a.vector}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{a.why}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Counter-narratives */}
            {rec.counter_narratives && rec.counter_narratives.length > 0 && (
              <Card className={glass}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Swords className="h-5 w-5 text-fuchsia-400" /> Counter-Narratives
                    <InfoTip text={TIPS.counter} />
                  </CardTitle>
                  <CardDescription>Respostas estratégicas pré-formuladas para ataques previsíveis.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {rec.counter_narratives.map((c, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-4"
                    >
                      <div className="text-xs uppercase text-rose-300 tracking-wider mb-1">Ataque</div>
                      <div className="text-sm font-medium mb-3">"{c.attack}"</div>
                      <div className="text-xs uppercase text-emerald-300 tracking-wider mb-1">Resposta estratégica</div>
                      <div className="text-sm">{c.response}</div>
                      {c.channel && (
                        <Badge variant="outline" className="mt-3 text-xs">Canal ideal: {c.channel}</Badge>
                      )}
                    </motion.div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Harmful narratives */}
            <Card className={`${glass} border-rose-500/20`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-rose-300">
                  <AlertTriangle className="h-5 w-5" /> Narrativas que Prejudicam
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rec.harmful_narratives?.map((h, i) => (
                  <div key={i} className="rounded-lg border border-rose-500/20 p-4 bg-rose-500/[0.04]">
                    <div className="font-semibold">{h.narrative}</div>
                    <div className="text-sm mt-1"><span className="text-rose-300">Risco:</span> {h.risk}</div>
                    <div className="text-sm mt-1"><span className="text-emerald-300">Mitigação:</span> {h.mitigation}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Channel plan */}
            <Card className={glass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-400" /> Plano de Comunicação por Canal
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(rec.channel_plan || {}).map(([k, v], i) => {
                  const meta = CHANNEL_META[k] || { label: k, icon: Target, gradient: "from-blue-500/20 to-violet-500/20" };
                  const Icon = meta.icon;
                  return (
                    <motion.div
                      key={k}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      className={`rounded-xl border border-white/10 p-4 bg-gradient-to-br ${meta.gradient} hover:scale-[1.02] transition-transform`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className="h-5 w-5" />
                        <span className="font-semibold">{meta.label}</span>
                        <Badge variant="outline" className="ml-auto text-xs">{v.tone}</Badge>
                      </div>
                      <p className="text-sm mb-3">{v.strategy}</p>
                      <ul className="space-y-1">
                        {v.content_examples?.map((ex, j) => (
                          <li key={j} className="text-xs text-muted-foreground flex gap-2">
                            <span className="text-blue-300">▸</span><span>{ex}</span>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="text-xs text-muted-foreground text-right">
              Gerado por IA · {result?.ai_provider}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NarrativeRecommendationsPage;
