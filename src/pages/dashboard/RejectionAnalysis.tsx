import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, AlertTriangle, ShieldAlert, Lightbulb, Users, Flame,
  MessageSquareQuote, Megaphone, Crosshair, Target, TrendingDown
} from "lucide-react";
import { toast } from "sonner";

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

interface AnalysisResult {
  analysis: RejectionAnalysis | null;
  insufficient?: boolean;
  evidenceCount?: number;
  minRequired?: number;
  message?: string;
}

const PERIOD_OPTIONS = [
  { value: "3", label: "Últimos 3 dias" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "14", label: "Últimos 14 dias" },
  { value: "30", label: "Últimos 30 dias" },
];

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
  const [selectedPeriod, setSelectedPeriod] = useState<string>("7");
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

  const handleAnalyze = async () => {
    if (!selectedCandidate) {
      toast.error("Selecione um candidato");
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-rejection', {
        body: { candidateId: selectedCandidate, daysBack: parseInt(selectedPeriod) },
      });
      if (error) throw error;
      setAnalysisResult(data);
      if (data.insufficient) {
        toast.info(data.message);
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
        <CardContent className="pt-6">
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

            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[160px] sm:w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={handleAnalyze} disabled={isAnalyzing || !selectedCandidate}>
              {isAnalyzing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando...</>
              ) : (
                <><TrendingDown className="mr-2 h-4 w-4" />Gerar mapa de rejeição</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Insufficient */}
      {analysisResult?.insufficient && (
        <Card className="border-yellow-500/40">
          <CardContent className="py-12 text-center">
            <ShieldAlert className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Dados insuficientes para análise de rejeição confiável.</h3>
            <p className="text-muted-foreground">
              Encontradas {analysisResult.evidenceCount} evidências negativas. Mínimo: {analysisResult.minRequired}.
              Aumente o período ou colete mais comentários antes de gerar o mapa.
            </p>
          </CardContent>
        </Card>
      )}

      {analysis && level && (
        <div className="space-y-6">
          {/* 1 — Rejection Level */}
          <Card className={`overflow-hidden ring-1 ${level.ring}`}>
            <CardContent className="p-0">
              <div className={`${level.bg} ${level.text} p-8 text-center`}>
                <p className="text-xs uppercase tracking-[0.3em] opacity-80">Rejeição atual</p>
                <p className="text-5xl sm:text-6xl font-black tracking-tight mt-2">{level.label}</p>
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
        </div>
      )}
    </div>
  );
};

export default RejectionAnalysisPage;
