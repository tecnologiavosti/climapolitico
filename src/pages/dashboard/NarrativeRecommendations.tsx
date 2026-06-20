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
  Sparkles, Target, AlertTriangle, Loader2, CheckCircle2,
  Instagram, Music2, Mic2, Tv, MapPin, ShieldAlert, Shield,
  Swords, Users, TrendingUp, Activity, FileText, Crosshair, Megaphone,
} from "lucide-react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";

interface PositioningMatrix {
  autoridade_institucional: number; mobilizacao: number; penetracao_popular: number;
  confianca_economica: number; confronto: number; elasticidade_eleitoral: number;
}
interface Recommendations {
  central_thesis: { headline: string; confidence: number; rationale: string };
  political_diagnosis: {
    dominant_positioning: string; public_perception: string; ideological_position: string;
    electoral_strength: number; base_consolidation: number; critical_rejection: number;
  };
  vote_drivers: { topic: string; score: number; explanation: string }[];
  positioning_matrix: PositioningMatrix;
  electoral_vulnerabilities: {
    high: { title: string; explanation: string }[];
    medium: { title: string; explanation: string }[];
    low: { title: string; explanation: string }[];
  };
  discourse_pillars: { pillar: string; message: string; target: string }[];
  opposition_attacks: { attack: string; risk: string; damage_potential: number; works_with: string[] }[];
  strategic_responses: { attack: string; response: string; channel: string }[];
  priority_audiences: {
    hard_core: string; persuadable: string; hard_convert: string; locked_rejection: string;
  };
  conversion_themes: { theme: string; score: number; segments: string[]; recommended_narrative: string }[];
  communication_risks: { risk: string; mitigation: string }[];
  channel_plan: Record<string, { objective: string; message_type: string; format: string; frequency: string }>;
  executive_briefing: {
    scenario: string; main_opportunity: string; main_threat: string; immediate_action: string;
    growth_probability: number; retraction_probability: number;
  };
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
  "Diagnóstico político",
  "Mapeamento de vulnerabilidades",
  "Cenário de ataques da oposição",
  "Plano tático por canal",
  "Compilando briefing executivo",
];

const CHANNEL_META: Record<string, { label: string; icon: any }> = {
  instagram: { label: "Instagram", icon: Instagram },
  tiktok:    { label: "TikTok",    icon: Music2 },
  debates:   { label: "Debates",   icon: Mic2 },
  tv:        { label: "TV",        icon: Tv },
  interior:  { label: "Interior",  icon: MapPin },
};

const MATRIX_LABELS: Record<keyof PositioningMatrix, { label: string; tip: string }> = {
  autoridade_institucional: { label: "Autoridade institucional", tip: "Percepção de competência, preparo e legitimidade para ocupar o cargo." },
  mobilizacao:              { label: "Capacidade de mobilização", tip: "Capacidade de gerar engajamento espontâneo e ato político." },
  penetracao_popular:       { label: "Penetração popular", tip: "Alcance entre eleitorado de baixa renda, interior e bases populares." },
  confianca_economica:      { label: "Confiança econômica", tip: "Credibilidade do candidato em pautas econômicas e de gestão fiscal." },
  confronto:                { label: "Capacidade de confronto", tip: "Habilidade para enfrentar adversários e dominar debates." },
  elasticidade_eleitoral:   { label: "Elasticidade eleitoral", tip: "Capacidade de ampliar eleitorado sem perder a base atual." },
};

const TIPS = {
  electoral_strength: "Força Eleitoral: combinação de base consolidada, recall, aprovação e capilaridade regional.",
  base_consolidation: "Consolidação da Base: percentual do núcleo duro que permanece firme em diferentes cenários.",
  critical_rejection: "Rejeição Crítica: parcela do eleitorado que rejeita o candidato e dificilmente muda de opinião.",
  vote_drivers: "Motores de Voto: temas políticos que mais convertem apoio quando bem trabalhados pelo candidato.",
  matrix: "Matriz de Posicionamento Político: 6 dimensões institucionais e eleitorais avaliadas pela IA.",
  vulnerabilities: "Vulnerabilidades Eleitorais: pontos estruturais que podem reduzir competitividade do candidato.",
  attacks: "Ataques Prováveis: linhas de ataque que a oposição tende a explorar no ciclo eleitoral.",
  responses: "Respostas Estratégicas: contra-ataques pré-formulados para os ataques mais prováveis.",
  audiences: "Públicos Prioritários: segmentação eleitoral entre base, persuasíveis, difíceis e rejeição.",
  conversion: "Temas com maior potencial de mover indecisos a partir do diagnóstico atual.",
  briefing: "Síntese institucional do cenário, oportunidade, ameaça e ação imediata recomendada.",
};

const card = "bg-card/60 border border-border/60 backdrop-blur-sm";

function ScoreBar({ value, tone = "primary" }: { value: number; tone?: "primary" | "risk" | "ok" | "neutral" }) {
  const cls =
    tone === "risk" ? "bg-rose-500" :
    tone === "ok" ? "bg-emerald-500" :
    tone === "neutral" ? "bg-muted-foreground/60" :
    "bg-blue-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className={`h-full ${cls}`}
      />
    </div>
  );
}

function Metric({ label, value, tip, tone = "primary" }: { label: string; value: number; tip?: string; tone?: "primary" | "risk" | "ok" }) {
  return (
    <div className="rounded-md border border-border/50 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        {label} {tip && <InfoTip text={tip} iconClassName="h-3 w-3" />}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{Math.round(value)}<span className="text-xs text-muted-foreground ml-1">/100</span></div>
      <div className="mt-2"><ScoreBar value={value} tone={tone} /></div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children, tip }: { icon: any; children: React.ReactNode; tip?: string }) {
  return (
    <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.15em] text-muted-foreground font-semibold">
      <Icon className="h-4 w-4 text-blue-400" />
      {children}
      {tip && <InfoTip text={tip} />}
    </CardTitle>
  );
}

function LoadingStages() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STAGES.length)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className={card}>
      <CardContent className="py-8 space-y-5">
        <Progress value={(step / LOADING_STAGES.length) * 100} className="h-1" />
        <ul className="space-y-2">
          {LOADING_STAGES.map((s, i) => (
            <motion.li
              key={s}
              initial={{ opacity: 0.3, x: -8 }}
              animate={{ opacity: i < step ? 1 : 0.4, x: i < step ? 0 : -4 }}
              className="flex items-center gap-3 text-sm"
            >
              {i < step ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                : i === step ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                : <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />}
              <span className={i < step ? "text-foreground" : "text-muted-foreground"}>{s}</span>
            </motion.li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
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
    candidate?: any; ai_provider?: string;
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
        toast.success("Briefing estratégico gerado");
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
    if (!rec?.positioning_matrix) return [];
    const m = rec.positioning_matrix;
    return (Object.keys(MATRIX_LABELS) as (keyof PositioningMatrix)[]).map((k) => ({
      dim: MATRIX_LABELS[k].label, v: m[k],
    }));
  }, [rec]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">
          <Crosshair className="h-3.5 w-3.5" /> War Room · Inteligência de Campanha
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Recomendações de Narrativa</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Briefing estratégico institucional gerado por IA — diagnóstico, vulnerabilidades, ataques e plano tático.
        </p>
      </div>

      {/* Controls */}
      <Card className={card}>
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
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</>
                : <><Sparkles className="mr-2 h-4 w-4" />Gerar Briefing</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && <LoadingStages />}

      {result && !rec && !isLoading && (
        <Card className={card}>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-500 mb-3" />
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
            {/* 1. Tese Central */}
            <Card className={`${card} border-l-4 border-l-blue-500`}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-blue-400 font-semibold">Tese Central de Campanha</span>
                  <Badge variant="outline" className="ml-auto">Confiança IA: {Math.round(rec.central_thesis?.confidence ?? rec.confidence ?? 0)}%</Badge>
                </div>
                <p className="text-xl font-semibold leading-snug">"{rec.central_thesis?.headline}"</p>
                <div className="mt-4 rounded-md border border-border/50 p-3 bg-muted/20">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Por que essa tese converte</div>
                  <p className="text-sm leading-relaxed">{rec.central_thesis?.rationale}</p>
                </div>
              </CardContent>
            </Card>

            {/* 2. Diagnóstico Político */}
            <Card className={card}>
              <CardHeader><SectionTitle icon={Activity}>Diagnóstico Político Atual</SectionTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-blue-500/40 text-blue-400">
                    Posicionamento dominante: {rec.political_diagnosis?.dominant_positioning}
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border/50 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Percepção pública</div>
                    <p className="text-sm">{rec.political_diagnosis?.public_perception}</p>
                  </div>
                  <div className="rounded-md border border-border/50 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Posicionamento ideológico</div>
                    <p className="text-sm">{rec.political_diagnosis?.ideological_position}</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Metric label="Força eleitoral" value={rec.political_diagnosis?.electoral_strength ?? 0} tip={TIPS.electoral_strength} />
                  <Metric label="Consolidação da base" value={rec.political_diagnosis?.base_consolidation ?? 0} tip={TIPS.base_consolidation} tone="ok" />
                  <Metric label="Rejeição crítica" value={rec.political_diagnosis?.critical_rejection ?? 0} tip={TIPS.critical_rejection} tone="risk" />
                </div>
              </CardContent>
            </Card>

            {/* 3. Vulnerabilidades + 4. Pilares */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className={card}>
                <CardHeader><SectionTitle icon={ShieldAlert} tip={TIPS.vulnerabilities}>Vulnerabilidades Eleitorais</SectionTitle></CardHeader>
                <CardContent className="space-y-4">
                  {([
                    { key: "high",   label: "Alta",  wrap: "border-l-rose-500", badge: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
                    { key: "medium", label: "Média", wrap: "border-l-amber-500", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
                    { key: "low",    label: "Baixa", wrap: "border-l-emerald-500", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
                  ] as const).map(({ key, label, wrap, badge }) => (
                    <div key={key} className="space-y-2">
                      <Badge variant="outline" className={badge}>{label}</Badge>
                      {(rec.electoral_vulnerabilities?.[key] || []).map((v, i) => (
                        <div key={i} className={`rounded-md border border-border/50 border-l-2 ${wrap} p-3`}>
                          <div className="font-medium text-sm">{v.title}</div>
                          <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{v.explanation}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className={card}>
                <CardHeader><SectionTitle icon={FileText}>Pilares de Discurso</SectionTitle></CardHeader>
                <CardContent className="space-y-3">
                  {rec.discourse_pillars?.map((p, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="rounded-md border border-border/50 p-3"
                    >
                      <div className="font-semibold text-sm">{p.pillar}</div>
                      <div className="text-sm mt-1">{p.message}</div>
                      <div className="text-xs text-muted-foreground mt-2">Alvo: {p.target}</div>
                    </motion.div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* 5. Ataques */}
            <Card className={card}>
              <CardHeader><SectionTitle icon={Swords} tip={TIPS.attacks}>Ataques Prováveis da Oposição</SectionTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {rec.opposition_attacks?.map((a, i) => (
                  <div key={i} className="rounded-md border border-border/50 border-l-2 border-l-rose-500 p-3">
                    <div className="font-semibold text-sm">"{a.attack}"</div>
                    <div className="text-xs text-muted-foreground mt-1">{a.risk}</div>
                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                        <span>Potencial de dano</span><span className="font-semibold text-foreground">{Math.round(a.damage_potential)}%</span>
                      </div>
                      <ScoreBar value={a.damage_potential} tone="risk" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">Funciona em:</span>
                      {a.works_with?.map((w, j) => (
                        <Badge key={j} variant="secondary" className="text-[10px]">{w}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* 6. Respostas */}
            <Card className={card}>
              <CardHeader><SectionTitle icon={Shield} tip={TIPS.responses}>Respostas Estratégicas</SectionTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {rec.strategic_responses?.map((c, i) => (
                  <div key={i} className="rounded-md border border-border/50 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-rose-400 mb-1">Ataque</div>
                    <div className="text-sm mb-3">"{c.attack}"</div>
                    <div className="text-[11px] uppercase tracking-wider text-emerald-400 mb-1">Resposta estratégica</div>
                    <div className="text-sm">{c.response}</div>
                    {c.channel && <Badge variant="outline" className="mt-3 text-xs">Canal ideal: {c.channel}</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* 7. Públicos + Motores de Voto */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className={card}>
                <CardHeader><SectionTitle icon={Users} tip={TIPS.audiences}>Públicos Prioritários</SectionTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {([
                    { k: "hard_core",        label: "Núcleo duro",          dot: "bg-emerald-500" },
                    { k: "persuadable",      label: "Persuasíveis",         dot: "bg-blue-500" },
                    { k: "hard_convert",     label: "Conversão difícil",    dot: "bg-amber-500" },
                    { k: "locked_rejection", label: "Rejeição consolidada", dot: "bg-rose-500" },
                  ] as const).map(({ k, label, dot }) => (
                    <div key={k} className="rounded-md border border-border/50 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`h-2 w-2 rounded-full ${dot}`} />
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
                      </div>
                      <p>{rec.priority_audiences?.[k]}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className={card}>
                <CardHeader><SectionTitle icon={TrendingUp} tip={TIPS.vote_drivers}>Motores de Voto</SectionTitle></CardHeader>
                <CardContent className="space-y-3">
                  {rec.vote_drivers?.map((d, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{d.topic}</span>
                        <span className="tabular-nums text-muted-foreground">{Math.round(d.score)}</span>
                      </div>
                      <ScoreBar value={d.score} />
                      <p className="text-xs text-muted-foreground mt-1">{d.explanation}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Matriz de Posicionamento */}
            <Card className={card}>
              <CardHeader>
                <SectionTitle icon={Crosshair} tip={TIPS.matrix}>Matriz de Posicionamento Político</SectionTitle>
                <CardDescription>Avaliação institucional em 6 dimensões. Passe o mouse nos rótulos para legendas.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                      <Radar name="Posicionamento" dataKey="v" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {(Object.keys(MATRIX_LABELS) as (keyof PositioningMatrix)[]).map((k) => (
                    <div key={k} className="flex items-center gap-3 rounded-md border border-border/50 p-2">
                      <div className="flex-1 text-sm flex items-center gap-1">
                        {MATRIX_LABELS[k].label}
                        <InfoTip text={MATRIX_LABELS[k].tip} iconClassName="h-3 w-3" />
                      </div>
                      <div className="w-32"><ScoreBar value={rec.positioning_matrix?.[k] ?? 0} /></div>
                      <div className="w-10 text-right text-sm tabular-nums">{Math.round(rec.positioning_matrix?.[k] ?? 0)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 8. Temas de Conversão */}
            <Card className={card}>
              <CardHeader><SectionTitle icon={Megaphone} tip={TIPS.conversion}>Temas com Maior Potencial de Conversão</SectionTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {rec.conversion_themes?.map((t, i) => (
                  <div key={i} className="rounded-md border border-border/50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold uppercase text-sm tracking-wider">{t.theme}</span>
                      <Badge variant="outline" className="border-blue-500/40 text-blue-400">{Math.round(t.score)}/100</Badge>
                    </div>
                    <ScoreBar value={t.score} />
                    <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Impacta</div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {t.segments?.map((s, j) => <Badge key={j} variant="secondary" className="text-[10px]">{s}</Badge>)}
                    </div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Narrativa recomendada</div>
                    <p className="text-sm">{t.recommended_narrative}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* 9. Riscos */}
            <Card className={card}>
              <CardHeader><SectionTitle icon={AlertTriangle}>Riscos de Comunicação</SectionTitle></CardHeader>
              <CardContent className="space-y-2">
                {rec.communication_risks?.map((r, i) => (
                  <div key={i} className="rounded-md border border-border/50 border-l-2 border-l-rose-500 p-3">
                    <div className="font-medium text-sm">{r.risk}</div>
                    <div className="text-xs mt-1"><span className="text-emerald-400">Mitigação:</span> {r.mitigation}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* 10. Plano por Canal */}
            <Card className={card}>
              <CardHeader><SectionTitle icon={Target}>Plano Tático por Canal</SectionTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(rec.channel_plan || {}).map(([k, v], i) => {
                  const meta = CHANNEL_META[k] || { label: k, icon: Target };
                  const Icon = meta.icon;
                  return (
                    <motion.div
                      key={k}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      className="rounded-md border border-border/50 p-4"
                    >
                      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
                        <Icon className="h-4 w-4 text-blue-400" />
                        <span className="font-semibold uppercase text-sm tracking-wider">{meta.label}</span>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Objetivo</div>
                          <p>{v.objective}</p>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Mensagem</div>
                          <p>{v.message_type}</p>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Formato</div>
                          <p>{v.format}</p>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Frequência</div>
                          <p>{v.frequency}</p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </CardContent>
            </Card>

            {/* 11. Executive Briefing */}
            {rec.executive_briefing && (
              <Card className={`${card} border-l-4 border-l-blue-500`}>
                <CardHeader>
                  <SectionTitle icon={FileText} tip={TIPS.briefing}>Executive Briefing</SectionTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Cenário atual:</span>
                    <Badge variant="outline" className={
                      rec.executive_briefing.scenario === "Risco" ? "border-rose-500/40 text-rose-400" :
                      rec.executive_briefing.scenario === "Expansão" ? "border-emerald-500/40 text-emerald-400" :
                      "border-blue-500/40 text-blue-400"
                    }>{rec.executive_briefing.scenario}</Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-border/50 border-l-2 border-l-emerald-500 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-emerald-400 mb-1">Principal oportunidade</div>
                      <p className="text-sm">{rec.executive_briefing.main_opportunity}</p>
                    </div>
                    <div className="rounded-md border border-border/50 border-l-2 border-l-rose-500 p-3">
                      <div className="text-[11px] uppercase tracking-wider text-rose-400 mb-1">Principal ameaça</div>
                      <p className="text-sm">{rec.executive_briefing.main_threat}</p>
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 border-l-2 border-l-blue-500 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-blue-400 mb-1">Ação imediata recomendada</div>
                    <p className="text-sm">{rec.executive_briefing.immediate_action}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Metric label="Probabilidade de crescimento" value={rec.executive_briefing.growth_probability ?? 0} tone="ok" />
                    <Metric label="Probabilidade de retração" value={rec.executive_briefing.retraction_probability ?? 0} tone="risk" />
                  </div>
                </CardContent>
              </Card>
            )}

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
