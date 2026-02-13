import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, ThumbsDown, MessageSquare, ShieldAlert, Lightbulb, Tag, TrendingDown } from "lucide-react";
import { toast } from "sonner";

interface RejectionTheme {
  theme: string;
  description: string;
  frequency: 'alta' | 'media' | 'baixa';
  severity: 'critica' | 'alta' | 'moderada' | 'baixa';
}

interface RejectionAnalysis {
  rejection_summary: string;
  rejection_themes: RejectionTheme[];
  recurring_keywords: string[];
  crisis_points: string[];
  mitigation_strategies: string[];
  risk_level: 'critico' | 'alto' | 'moderado' | 'baixo';
}

interface TopComment {
  text: string;
  author: string;
  network: string;
  likes: number;
  replies: number;
}

interface AnalysisResult {
  analysis: RejectionAnalysis | null;
  message?: string;
  stats: {
    totalComments: number;
    negativeCount: number;
    rejectionRate: number;
    byNetwork: Record<string, number>;
  };
  topNegativeComments?: TopComment[];
  candidate?: { full_name: string; party: string; region: string };
  period?: { daysBack: number; startDate: string; endDate: string };
}

const PERIOD_OPTIONS = [
  { value: "1", label: "Últimas 24 horas" },
  { value: "3", label: "Últimos 3 dias" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "14", label: "Últimos 14 dias" },
  { value: "30", label: "Últimos 30 dias" },
];

const riskConfig: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  critico: { color: "bg-red-600 text-white", label: "Crítico", icon: <AlertTriangle className="h-4 w-4" /> },
  alto: { color: "bg-red-500 text-white", label: "Alto", icon: <AlertTriangle className="h-4 w-4" /> },
  moderado: { color: "bg-yellow-500 text-white", label: "Moderado", icon: <ShieldAlert className="h-4 w-4" /> },
  baixo: { color: "bg-green-500 text-white", label: "Baixo", icon: <ShieldAlert className="h-4 w-4" /> },
};

const severityConfig: Record<string, string> = {
  critica: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  alta: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  moderada: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  baixa: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const frequencyConfig: Record<string, string> = {
  alta: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  media: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  baixa: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
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

      if (!data.analysis) {
        toast.info(data.message || "Nenhum comentário negativo encontrado.");
      } else {
        toast.success("Análise de rejeição gerada com sucesso!");
      }
    } catch (err: any) {
      console.error('Error:', err);
      toast.error(err.message || "Erro ao gerar análise de rejeição");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analysis = analysisResult?.analysis;
  const stats = analysisResult?.stats;
  const risk = analysis ? riskConfig[analysis.risk_level] || riskConfig.moderado : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Análise de Rejeição</h1>
        <p className="text-muted-foreground mt-1">
          Entenda os principais motivos da rejeição ao candidato com base em comentários reais.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="w-full sm:w-[280px]">
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
              <SelectTrigger className="w-full sm:w-[200px]">
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
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analisando...
                </>
              ) : (
                <>
                  <TrendingDown className="mr-2 h-4 w-4" />
                  Analisar Rejeição
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* No data */}
      {analysisResult && !analysis && (
        <Card>
          <CardContent className="py-12 text-center">
            <ThumbsDown className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum comentário negativo encontrado</h3>
            <p className="text-muted-foreground">{analysisResult.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {analysis && stats && (
        <div className="space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-sm text-muted-foreground">Comentários Negativos</p>
                <p className="text-3xl font-bold text-destructive">{stats.negativeCount}</p>
                <p className="text-xs text-muted-foreground">de {stats.totalComments} totais</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-sm text-muted-foreground">Taxa de Rejeição</p>
                <p className="text-3xl font-bold text-destructive">{stats.rejectionRate.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground">do total de comentários</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex flex-col items-center justify-center">
                <p className="text-sm text-muted-foreground mb-2">Nível de Risco</p>
                <Badge className={`text-base px-4 py-1 ${risk?.color}`}>
                  {risk?.icon}
                  <span className="ml-1">{risk?.label}</span>
                </Badge>
              </CardContent>
            </Card>
          </div>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Resumo da Rejeição
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">{analysis.rejection_summary}</p>
            </CardContent>
          </Card>

          {/* Rejection Themes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                Temas de Crítica
              </CardTitle>
              <CardDescription>Principais motivos agrupados por tema</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analysis.rejection_themes.map((theme, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="font-semibold text-foreground">{theme.theme}</h4>
                      <Badge variant="outline" className={severityConfig[theme.severity]}>
                        Severidade: {theme.severity}
                      </Badge>
                      <Badge variant="outline" className={frequencyConfig[theme.frequency]}>
                        Frequência: {theme.frequency}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{theme.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Keywords */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Palavras-chave Recorrentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {analysis.recurring_keywords.map((kw, i) => (
                  <Badge key={i} variant="secondary" className="text-sm px-3 py-1">
                    {kw}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Crisis Points */}
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="h-5 w-5" />
                Pontos Críticos
              </CardTitle>
              <CardDescription>Itens que exigem atenção imediata</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {analysis.crisis_points.map((point, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{point}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Mitigation Strategies */}
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Lightbulb className="h-5 w-5" />
                Estratégias de Mitigação
              </CardTitle>
              <CardDescription>Recomendações para reduzir a rejeição</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {analysis.mitigation_strategies.map((strategy, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-sm">{strategy}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Top Negative Comments */}
          {analysisResult.topNegativeComments && analysisResult.topNegativeComments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ThumbsDown className="h-5 w-5" />
                  Comentários Negativos Mais Relevantes
                </CardTitle>
                <CardDescription>Ordenados por engajamento (curtidas + respostas)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysisResult.topNegativeComments.map((comment, i) => (
                    <div key={i} className="border rounded-lg p-3 bg-muted/30">
                      <p className="text-sm text-foreground mb-2">"{comment.text}"</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {comment.author && <span>@{comment.author}</span>}
                        <Badge variant="outline" className="text-xs">{comment.network}</Badge>
                        {comment.likes > 0 && <span>👍 {comment.likes}</span>}
                        {comment.replies > 0 && <span>💬 {comment.replies}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Network Distribution */}
          {stats.byNetwork && Object.keys(stats.byNetwork).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Distribuição por Rede Social</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(stats.byNetwork).map(([network, count]) => (
                    <div key={network} className="text-center">
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-sm text-muted-foreground">{network}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default RejectionAnalysisPage;
