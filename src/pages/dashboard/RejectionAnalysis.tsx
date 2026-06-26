import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { DateRange } from "react-day-picker";
import {
  AlertTriangle, Brain, Lightbulb, Users, Flame,
  MessageSquareQuote, Megaphone, Target, TrendingDown, RefreshCw, Sparkles,
  MessageCircle, Copy, Check
} from "lucide-react";
import { toast } from "sonner";
import RejectionLoading from "@/components/dashboard/RejectionLoading";

type PeriodKey = "7d" | "30d" | "90d" | "1y" | "custom";

const PERIOD_LABEL: Record<PeriodKey, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  "1y": "Último ano",
  "custom": "Personalizado",
};

interface Components {
  polarizacao: number;
  desgaste: number;
  antagonismo_ideologico: number;
  fragilidade_narrativa: number;
  exposicao_negativa: number;
}
interface WhoRejects { profile: string; reason: string; }
interface AttackNarrative { narrative: string; why_it_works: string; }
interface VulnerabilityPoint { group: string; explanation: string; }

interface RejectionAnalysis {
  rejection_score: number;
  rejection_level: 'baixa' | 'moderada' | 'alta' | 'critica' | 'extrema';
  components: Components;
  diagnosis: string;
  who_rejects: WhoRejects[];
  attack_narratives: AttackNarrative[];
  emotional_language: { raiva: string[]; deboche: string[]; medo: string[] };
  simulated_narratives: string[];
  vulnerability_points: VulnerabilityPoint[];
  mitigation: { comunicacao: string[]; posicionamento: string[]; crise: string[]; narrativa: string[] };
}

interface AnalysisResult {
  analysis: RejectionAnalysis | null;
}

const levelConfig: Record<string, { label: string; bg: string; ring: string; text: string }> = {
  baixa:    { label: "BAIXA",    bg: "bg-emerald-500", ring: "ring-emerald-500/30", text: "text-emerald-50" },
  moderada: { label: "MODERADA", bg: "bg-amber-500",   ring: "ring-amber-500/30",   text: "text-amber-50" },
  alta:     { label: "ALTA",     bg: "bg-rose-600",    ring: "ring-rose-600/30",    text: "text-rose-50" },
  critica:  { label: "CRÍTICA",  bg: "bg-red-700",     ring: "ring-red-700/30",     text: "text-red-50" },
  extrema:  { label: "EXTREMA",  bg: "bg-red-900",     ring: "ring-red-900/40",     text: "text-red-50" },
};

const componentLabels: Record<keyof Components, string> = {
  polarizacao: "Polarização",
  desgaste: "Desgaste",
  antagonismo_ideologico: "Ataque ideológico",
  fragilidade_narrativa: "Fragilidade narrativa",
  exposicao_negativa: "Exposição negativa",
};

function scoreColor(n: number): string {
  if (n <= 30) return "text-emerald-500";
  if (n <= 60) return "text-amber-500";
  return "text-rose-500";
}

const RejectionAnalysisPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { data: candidates = [] } = useQuery({
    queryKey: ['candidates-for-rejection', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name, party')
        .order('full_name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const candidateName = candidates.find((c) => c.id === selectedCandidate)?.full_name;

  const handleAnalyze = async () => {
    if (!selectedCandidate) {
      toast.error("Selecione um candidato");
      return;
    }
    if (period === "custom" && (!customRange?.from || !customRange?.to)) {
      toast.error("Selecione o intervalo personalizado");
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-rejection', {
        body: {
          candidateId: selectedCandidate,
          period,
          customStart: customRange?.from?.toISOString(),
          customEnd: customRange?.to?.toISOString(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAnalysisResult(data);
      if (data?.analysis) toast.success("Mapa de rejeição IA gerado.");
    } catch (err: any) {
      console.error('Error:', err);
      toast.error(err.message || "Erro ao gerar mapa de rejeição");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analysis = analysisResult?.analysis;
  const level = analysis ? (levelConfig[analysis.rejection_level] || levelConfig.moderada) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-7 w-7" />
          Mapa de Rejeição Política
        </h1>
        <p className="text-muted-foreground mt-1">
          Leitura estratégica IA considerando o intervalo escolhido — recalcula narrativas, polarização e desgaste conforme o período.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-row flex-wrap gap-3 items-end">
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="w-[200px] sm:w-[320px]">
                <SelectValue placeholder="Selecione um candidato" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}{c.party ? ` (${c.party})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="1y">Último ano</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>

            {period === "custom" && (
              <DateRangePicker
                dateRange={customRange}
                onDateRangeChange={setCustomRange}
                className="w-[280px]"
              />
            )}

            <Button onClick={handleAnalyze} disabled={isAnalyzing || !selectedCandidate}>
              {isAnalyzing ? (
                <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />{analysisResult ? "Reanalisando..." : "Analisando..."}</>
              ) : analysisResult ? (
                <><RefreshCw className="mr-2 h-4 w-4" />Reanalisar</>
              ) : (
                <><TrendingDown className="mr-2 h-4 w-4" />Gerar mapa de rejeição IA</>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Análise reputacional baseada no período selecionado — a IA recalibra peso entre narrativas recentes e desgaste estrutural.
          </p>
        </CardContent>
      </Card>

      {/* Loading */}
      <AnimatePresence mode="wait">
        {isAnalyzing && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3 }}
          >
            <RejectionLoading candidateName={candidateName} periodLabel={PERIOD_LABEL[period]} />
          </motion.div>
        )}
      </AnimatePresence>

      {!isAnalyzing && !analysisResult && !selectedCandidate && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">Selecione um candidato para começar</h3>
            <p className="text-sm text-muted-foreground">
              A análise é gerada por IA estratégica com base no perfil político — sem depender de dados coletados.
            </p>
          </CardContent>
        </Card>
      )}

      {!isAnalyzing && analysis && level && (
        <motion.div
          key={selectedCandidate}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* 1 — Score & Level */}
          <Card className={`overflow-hidden ring-1 ${level.ring}`}>
            <CardContent className="p-0">
              <div className={`${level.bg} ${level.text} p-8 text-center`}>
                <p className="text-xs uppercase tracking-[0.3em] opacity-80">Score de Rejeição IA</p>
                <p className="text-6xl sm:text-7xl font-black tracking-tight mt-2">
                  {analysis.rejection_score}<span className="text-3xl opacity-70">/100</span>
                </p>
                <p className="text-2xl font-bold mt-2 tracking-wide">{level.label}</p>
                <p className="text-xs opacity-80 mt-3 flex items-center justify-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Leitura estratégica IA · {PERIOD_LABEL[period]}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 2 — Diagnosis */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Por que esse candidato gera rejeição?
              </CardTitle>
              <CardDescription>Diagnóstico estratégico inferencial</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-foreground leading-relaxed whitespace-pre-line">
                {analysis.diagnosis}
              </div>
            </CardContent>
          </Card>

          {/* 3 — Vectors (component scores) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Vetores de Rejeição
              </CardTitle>
              <CardDescription>Componentes do score (0–100)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(Object.keys(componentLabels) as (keyof Components)[]).map((key) => {
                  const value = analysis.components[key] ?? 0;
                  return (
                    <div key={key} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-foreground">{componentLabels[key]}</h4>
                        <span className={`text-2xl font-black tabular-nums ${scoreColor(value)}`}>{value}</span>
                      </div>
                      <Progress value={value} className="h-2" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 4 — Who rejects */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Perfis que mais rejeitam
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analysis.who_rejects?.map((p, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <h4 className="font-semibold text-foreground mb-1">{p.profile}</h4>
                    <p className="text-sm text-muted-foreground">{p.reason}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 5 — Attack narratives */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Flame className="h-5 w-5" />
                Narrativas de ataque mais perigosas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.attack_narratives?.map((n, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <p className="font-semibold text-foreground italic mb-2">"{n.narrative}"</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Por que funciona:</span> {n.why_it_works}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 6 — Emotional language */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5" />
                Linguagem da Rejeição
              </CardTitle>
              <CardDescription>Clusters emocionais inferidos por IA</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {([
                  { key: 'raiva', label: 'Raiva', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
                  { key: 'deboche', label: 'Deboche', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
                  { key: 'medo', label: 'Medo', color: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200' },
                ] as const).map(({ key, label, color }) => (
                  <div key={key}>
                    <p className="text-sm font-semibold mb-2">{label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(analysis.emotional_language?.[key] || []).map((w, i) => (
                        <Badge key={i} className={color} variant="outline">{w}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 7 — Simulated narratives */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareQuote className="h-5 w-5" />
                Simulações de Narrativas Críticas
              </CardTitle>
              <CardDescription>
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  Frases simuladas pela IA com base em padrões narrativos.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.simulated_narratives?.map((quote, i) => (
                  <div key={i} className="border rounded-lg p-4 bg-muted/30">
                    <p className="text-sm italic text-foreground">"{quote}"</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 8 — Vulnerability points */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Onde ele mais perde votos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analysis.vulnerability_points?.map((v, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <h4 className="font-semibold text-foreground mb-1">{v.group}</h4>
                    <p className="text-sm text-muted-foreground">{v.explanation}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 9 — Mitigation */}
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Lightbulb className="h-5 w-5" />
                Como reduzir rejeição
              </CardTitle>
              <CardDescription>Plano estratégico em 4 frentes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([
                  { key: 'comunicacao', label: 'Comunicação' },
                  { key: 'posicionamento', label: 'Posicionamento' },
                  { key: 'crise', label: 'Crise' },
                  { key: 'narrativa', label: 'Narrativa' },
                ] as const).map(({ key, label }) => (
                  <div key={key} className="border rounded-lg p-4">
                    <p className="font-semibold mb-2">{label}</p>
                    <ul className="space-y-2">
                      {(analysis.mitigation?.[key] || []).map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
};

export default RejectionAnalysisPage;
