import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, AlertTriangle, ShieldAlert, Lightbulb, Users, Flame,
  MessageSquareQuote, Megaphone, Crosshair, Target, TrendingDown, RefreshCw, CalendarIcon
} from "lucide-react";
import { toast } from "sonner";
import RejectionLoading from "@/components/dashboard/RejectionLoading";

interface RejectionVector {
  name: string;
  weight: 'baixo' | 'medio' | 'alto' | 'critico';
  type: 'moral' | 'politico' | 'ideologico' | 'emocional' | 'economico';
  explanation: string;
}
interface WhoRejects { profile: string; reason: string; }
interface DestructiveNarrative { narrative: string; danger: 'medio' | 'alto' | 'critico'; why_it_works: string; }
interface CommentCluster { theme: string; representative_quote: string; frequency_label: string; }
interface VulnerabilityPoint { group: string; explanation: string; }

interface RejectionAnalysis {
  rejection_level: 'baixa' | 'moderada' | 'alta' | 'critica' | 'explosiva';
  diagnosis: string;
  rejection_vectors: RejectionVector[];
  who_rejects: WhoRejects[];
  destructive_narratives: DestructiveNarrative[];
  rejection_language: { raiva: string[]; deboche: string[]; medo: string[]; };
  comment_clusters: CommentCluster[];
  vulnerability_points: VulnerabilityPoint[];
  mitigation: { comunicacao: string[]; posicionamento: string[]; crise: string[]; narrativa: string[]; };
}

type ConfidenceLevel = 'baixa' | 'moderada' | 'boa' | 'alta';

interface AnalysisResult {
  analysis: RejectionAnalysis | null;
  insufficient?: boolean;
  fallback?: boolean;
  usedFallback?: boolean;
  evidenceCount?: number;
  confidence?: ConfidenceLevel;
  message?: string;
}

const confidenceConfig: Record<ConfidenceLevel, { label: string; badge: string; subtitle: string }> = {
  baixa:    { label: "Baixa confiança",    badge: "bg-yellow-100 text-yellow-800 border-yellow-400 dark:bg-yellow-900/30 dark:text-yellow-300", subtitle: "Poucas evidências encontradas. A análise pode não representar todo o eleitorado." },
  moderada: { label: "Confiança moderada", badge: "bg-blue-100 text-blue-800 border-blue-400 dark:bg-blue-900/30 dark:text-blue-300",         subtitle: "Amostragem moderada. Padrões já são identificáveis." },
  boa:      { label: "Boa confiança",      badge: "bg-emerald-100 text-emerald-800 border-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-300", subtitle: "Volume saudável de evidências analisadas." },
  alta:     { label: "Alta confiança",     badge: "bg-green-100 text-green-800 border-green-500 dark:bg-green-900/30 dark:text-green-300",      subtitle: "Amostragem ampla e representativa." },
};

const QUICK_PERIODS = [
  { value: "7",   label: "7 dias" },
  { value: "30",  label: "30 dias" },
  { value: "90",  label: "90 dias" },
  { value: "365", label: "1 ano" },
] as const;

const MODAL_QUICK = [
  { label: "Últimos 7 dias",   days: 7 },
  { label: "Últimos 30 dias",  days: 30 },
  { label: "Últimos 90 dias",  days: 90 },
  { label: "Último ano",       days: 365 },
  { label: "Campanha atual",   days: 180 },
  { label: "Pré-eleição",      days: 540 },
];

const MAX_RANGE_DAYS = 365 * 8;

const levelConfig: Record<string, { label: string; bg: string; ring: string; text: string }> = {
  baixa:     { label: "BAIXA",     bg: "bg-emerald-500",  ring: "ring-emerald-500/30",  text: "text-emerald-50" },
  moderada:  { label: "MODERADA",  bg: "bg-yellow-500",   ring: "ring-yellow-500/30",   text: "text-yellow-50" },
  alta:      { label: "ALTA",      bg: "bg-orange-500",   ring: "ring-orange-500/30",   text: "text-orange-50" },
  critica:   { label: "CRÍTICA",   bg: "bg-red-600",      ring: "ring-red-600/30",      text: "text-red-50" },
  explosiva: { label: "EXPLOSIVA", bg: "bg-rose-700",     ring: "ring-rose-700/30",     text: "text-rose-50" },
};

const weightConfig: Record<string, string> = {
  baixo:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  medio:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  alto:    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critico: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const dangerConfig: Record<string, string> = {
  medio:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  alto:    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critico: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const typeConfig: Record<string, string> = {
  moral:       "border-rose-500/50 text-rose-700 dark:text-rose-300",
  politico:    "border-blue-500/50 text-blue-700 dark:text-blue-300",
  ideologico:  "border-purple-500/50 text-purple-700 dark:text-purple-300",
  emocional:   "border-pink-500/50 text-pink-700 dark:text-pink-300",
  economico:   "border-amber-500/50 text-amber-700 dark:text-amber-300",
};

const RejectionAnalysisPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [period, setPeriod] = useState<string>("7"); // "7" | "30" | "90" | "365" | "custom"
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [draftRange, setDraftRange] = useState<DateRange | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
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

  const daysBack = useMemo(() => {
    if (period === "custom" && customRange?.from && customRange?.to) {
      return Math.max(1, differenceInCalendarDays(customRange.to, customRange.from) + 1);
    }
    return parseInt(period, 10) || 7;
  }, [period, customRange]);

  const periodLabel = useMemo(() => {
    if (period === "custom" && customRange?.from && customRange?.to) {
      return `${format(customRange.from, "dd/MM/yyyy", { locale: ptBR })} → ${format(customRange.to, "dd/MM/yyyy", { locale: ptBR })}`;
    }
    return QUICK_PERIODS.find((p) => p.value === period)?.label ?? `${daysBack} dias`;
  }, [period, customRange, daysBack]);

  const handlePeriodPill = (value: string) => {
    if (value === "custom") {
      setDraftRange(customRange);
      setCustomOpen(true);
      return;
    }
    setPeriod(value);
  };

  const applyCustom = () => {
    if (!draftRange?.from || !draftRange?.to) {
      toast.error("Selecione data inicial e final");
      return;
    }
    if (draftRange.to < draftRange.from) {
      toast.error("Data final não pode ser menor que a inicial");
      return;
    }
    const diff = differenceInCalendarDays(draftRange.to, draftRange.from);
    if (diff > MAX_RANGE_DAYS) {
      toast.error("Período máximo permitido: 8 anos");
      return;
    }
    setCustomRange(draftRange);
    setPeriod("custom");
    setCustomOpen(false);
  };

  const applyModalQuick = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDraftRange({ from, to });
  };

  const handleAnalyze = async () => {
    if (!selectedCandidate) {
      toast.error("Selecione um candidato");
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-rejection', {
        body: { candidateId: selectedCandidate, daysBack },
      });
      if (error) throw error;
      setAnalysisResult(data);
      if (data.usedFallback) {
        toast.warning("Análise local gerada — provedor de IA indisponível no momento.");
      } else if (data.analysis) {
        toast.success("Mapa de rejeição gerado.");
      }
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
        <h1 className="text-3xl font-bold tracking-tight">Mapa de Rejeição Política</h1>
        <p className="text-muted-foreground mt-1">
          Entenda quais narrativas geram resistência ao candidato e onde estão seus maiores riscos reputacionais.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-row flex-wrap gap-3 items-end">
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="w-[200px] sm:w-[280px]">
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

            <Button onClick={handleAnalyze} disabled={isAnalyzing || !selectedCandidate}>
              {isAnalyzing ? (
                <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />{analysisResult ? "Reanalisando..." : "Analisando..."}</>
              ) : analysisResult ? (
                <><RefreshCw className="mr-2 h-4 w-4" />Reanalisar</>
              ) : (
                <><TrendingDown className="mr-2 h-4 w-4" />Gerar mapa de rejeição</>
              )}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {QUICK_PERIODS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={period === p.value ? "default" : "outline"}
                className="rounded-full"
                onClick={() => handlePeriodPill(p.value)}
                disabled={isAnalyzing}
              >
                {p.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant={period === "custom" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => handlePeriodPill("custom")}
              disabled={isAnalyzing}
            >
              <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
              Personalizado
            </Button>
            {period === "custom" && customRange?.from && customRange?.to && (
              <Badge variant="secondary" className="ml-1">
                {format(customRange.from, "dd/MM/yyyy")} → {format(customRange.to, "dd/MM/yyyy")}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Custom period dialog */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Selecionar período de análise</DialogTitle>
            <DialogDescription>
              Escolha o intervalo que será usado para analisar a rejeição do candidato
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {MODAL_QUICK.map((q) => (
              <Button
                key={q.label}
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => applyModalQuick(q.days)}
              >
                {q.label}
              </Button>
            ))}
          </div>

          <div className="flex justify-center">
            <Calendar
              mode="range"
              selected={draftRange}
              onSelect={setDraftRange}
              numberOfMonths={2}
              locale={ptBR}
              className="pointer-events-auto"
            />
          </div>

          {draftRange?.from && draftRange?.to && (
            <div className="flex items-center justify-center">
              <Badge variant="secondary" className="text-sm">
                {format(draftRange.from, "dd/MM/yyyy")} → {format(draftRange.to, "dd/MM/yyyy")}
              </Badge>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCustomOpen(false)}>Cancelar</Button>
            <Button onClick={applyCustom}>Aplicar período</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <RejectionLoading candidateName={candidateName} periodLabel={periodLabel} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* (removido) bloqueio por evidência insuficiente — a IA sempre gera análise */}


      {/* (removido) card de "Serviço de IA sobrecarregado" — agora há fallback heurístico local */}

      {/* Empty state — no candidate selected */}
      {!isAnalyzing && !analysisResult && !selectedCandidate && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">Selecione um candidato para começar</h3>
            <p className="text-sm text-muted-foreground">
              A análise de rejeição é gerada sob demanda a partir de evidências reais.
            </p>
          </CardContent>
        </Card>
      )}

      {!isAnalyzing && analysis && level && (
        <motion.div
          key={`${selectedCandidate}-${period}-${customRange?.from?.toISOString() ?? ""}`}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* 1 — Rejection Level */}
          <Card className={`overflow-hidden ring-1 ${level.ring}`}>
            <CardContent className="p-0">
              <div className={`${level.bg} ${level.text} p-8 text-center`}>
                <p className="text-xs uppercase tracking-[0.3em] opacity-80">Rejeição atual</p>
                <p className="text-5xl sm:text-6xl font-black tracking-tight mt-2">{level.label}</p>
              </div>
              {analysisResult?.evidenceCount !== undefined && analysisResult?.confidence && (
                <div className="px-6 py-4 flex flex-wrap items-center justify-center gap-3 border-t bg-muted/30">
                  <span className="text-sm font-medium">
                    {analysisResult.evidenceCount} evidências negativas analisadas
                  </span>
                  <Badge variant="outline" className={confidenceConfig[analysisResult.confidence].badge}>
                    {confidenceConfig[analysisResult.confidence].label}
                  </Badge>
                  <p className="w-full text-center text-xs text-muted-foreground">
                    {confidenceConfig[analysisResult.confidence].subtitle}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2 — Diagnosis */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Por que esse candidato gera rejeição?
              </CardTitle>
              <CardDescription>Diagnóstico estratégico baseado em evidências reais</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-foreground leading-relaxed whitespace-pre-line">
                {analysis.diagnosis}
              </div>
            </CardContent>
          </Card>

          {/* 3 — Rejection Vectors */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crosshair className="h-5 w-5" />
                Vetores de Rejeição
              </CardTitle>
              <CardDescription>Origens estruturais da resistência ao candidato</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {analysis.rejection_vectors?.map((v, i) => (
                  <div key={i} className={`border-2 ${typeConfig[v.type] || 'border-muted'} rounded-lg p-4 bg-card`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="font-semibold text-foreground">{v.name}</h4>
                      <Badge className={weightConfig[v.weight]} variant="outline">
                        Peso: {v.weight}
                      </Badge>
                    </div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Tipo: {v.type}</p>
                    <p className="text-sm text-muted-foreground">{v.explanation}</p>
                  </div>
                ))}
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
                    <p className="text-sm text-muted-foreground">Motivo: {p.reason}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 5 — Destructive narratives */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Flame className="h-5 w-5" />
                Narrativas de ataque mais perigosas
              </CardTitle>
              <CardDescription>Linhas de ataque com maior poder destrutivo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.destructive_narratives?.map((n, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <p className="font-semibold text-foreground italic">"{n.narrative}"</p>
                      <Badge className={dangerConfig[n.danger]} variant="outline">
                        Perigo: {n.danger}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Por que funciona:</span> {n.why_it_works}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 6 — Rejection language */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5" />
                Linguagem da Rejeição
              </CardTitle>
              <CardDescription>Palavras reais usadas, agrupadas por emoção</CardDescription>
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
                      {(analysis.rejection_language?.[key] || []).map((w, i) => (
                        <Badge key={i} className={color} variant="outline">{w}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 7 — Comment clusters */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareQuote className="h-5 w-5" />
                Comentários representativos
              </CardTitle>
              <CardDescription>Agrupados semanticamente por narrativa</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.comment_clusters?.map((c, i) => (
                  <div key={i} className="border rounded-lg p-4 bg-muted/30">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      Cluster {i + 1} — {c.theme}
                    </p>
                    <p className="text-sm italic text-foreground mb-2">"{c.representative_quote}"</p>
                    <p className="text-xs text-muted-foreground">{c.frequency_label}</p>
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
