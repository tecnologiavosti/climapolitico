import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, ThumbsUp, ThumbsDown, Lightbulb, AlertTriangle, TrendingUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { DateRange } from "react-day-picker";

interface SummaryData {
  overall_sentiment: string;
  overall_summary: string;
  positive_points: string[];
  negative_points: string[];
  narrative_recommendations: string[];
  risk_alert: string;
  opportunity_alert: string;
}

interface SummaryResponse {
  summary: SummaryData | null;
  stats: { total: number; positive: number; negative: number; neutral: number };
  candidate: { id: string; full_name: string; party: string | null; region: string | null };
  period: { daysBack: number; startDate: string; endDate: string };
  message?: string;
}

const sentimentConfig: Record<string, { label: string; color: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  muito_positiva: { label: "Muito Positiva", color: "text-green-600", variant: "default" },
  positiva: { label: "Positiva", color: "text-green-500", variant: "default" },
  mista: { label: "Mista", color: "text-yellow-500", variant: "secondary" },
  negativa: { label: "Negativa", color: "text-red-500", variant: "destructive" },
  muito_negativa: { label: "Muito Negativa", color: "text-red-700", variant: "destructive" },
};

const CandidateSummary = () => {
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [daysBack, setDaysBack] = useState<string>("7"); // "all" | "custom" | number
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  const { data: candidates } = useQuery({
    queryKey: ['candidates-for-summary'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name, party, region')
        .eq('user_id', user.id)
        .order('full_name');
      if (error) throw error;
      return data;
    }
  });

  const summaryMutation = useMutation({
    mutationFn: async (params: { candidateId: string; days: number | null; startDate?: string; endDate?: string }) => {
      const body: any = { candidateId: params.candidateId, daysBack: params.days };
      if (params.startDate) body.startDate = params.startDate;
      if (params.endDate) body.endDate = params.endDate;
      const { data, error } = await supabase.functions.invoke('generate-candidate-summary', { body });
      if (error) throw error;
      return data as SummaryResponse;
    },
    onError: (error: any) => {
      console.error('Error generating summary:', error);
      toast.error(error?.message || 'Erro ao gerar resumo');
    }
  });

  const handleGenerate = () => {
    if (!selectedCandidate) {
      toast.error('Selecione um candidato');
      return;
    }
    if (daysBack === 'custom') {
      if (!customRange?.from) {
        toast.error('Selecione a data inicial');
        return;
      }
      const end = customRange.to ?? new Date();
      const start = new Date(customRange.from);
      start.setHours(0, 0, 0, 0);
      const endAdj = new Date(end);
      endAdj.setHours(23, 59, 59, 999);
      summaryMutation.mutate({
        candidateId: selectedCandidate,
        days: null,
        startDate: start.toISOString(),
        endDate: endAdj.toISOString(),
      });
      return;
    }
    const days = daysBack === 'all' ? null : parseInt(daysBack);
    summaryMutation.mutate({ candidateId: selectedCandidate, days });
  };

  const result = summaryMutation.data;
  const summary = result?.summary;
  const sentiment = summary ? sentimentConfig[summary.overall_sentiment] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileText className="h-8 w-8 text-primary" />
          Resumo Inteligente
        </h1>
        <p className="text-muted-foreground mt-1">
          Visão executiva rápida baseada em comentários reais
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-row flex-wrap gap-3 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Candidato</label>
              <HelpTooltip text="Escolha de qual candidato você quer ver o resumo.">
                <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um candidato" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates?.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name} {c.party ? `(${c.party})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </HelpTooltip>
            </div>
            <div className="w-32 sm:w-40 space-y-2">
              <label className="text-sm font-medium">Período</label>
              <HelpTooltip text="Quantos dias atrás a IA vai olhar pra montar o resumo.">
                <Select value={daysBack} onValueChange={setDaysBack}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Últimas 24h</SelectItem>
                    <SelectItem value="3">Últimos 3 dias</SelectItem>
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="14">Últimos 14 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                    <SelectItem value="all">Período Total (todos os comentários)</SelectItem>
                  </SelectContent>
                </Select>
              </HelpTooltip>
            </div>
            <HelpTooltip text="Clica aqui e a IA monta um resumo pronto pra você ler.">
              <Button onClick={handleGenerate} disabled={summaryMutation.isPending || !selectedCandidate}>
                {summaryMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando...</>
                ) : (
                  <><RefreshCw className="mr-2 h-4 w-4" /> Gerar Resumo</>
                )}
              </Button>
            </HelpTooltip>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {summaryMutation.isPending && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-3">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Analisando {result?.stats?.total || ''} comentários com IA...</p>
          </div>
        </div>
      )}

      {/* No data message */}
      {result && !summary && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Sem dados no período</h3>
            <p className="text-muted-foreground">{result.message || 'Nenhum comentário encontrado. Execute uma coleta primeiro.'}</p>
          </CardContent>
        </Card>
      )}

      {/* Summary Results */}
      {summary && (
        <div className="space-y-4">
          {/* Overall sentiment + stats bar */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold">{result.candidate.full_name}</h2>
                    {sentiment && (
                      <Badge variant={sentiment.variant} className="text-sm">
                        {sentiment.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {result.stats.total} comentários analisados • {result.period.daysBack === null || result.period.daysBack === 0 ? 'Período total' : `Últimos ${result.period.daysBack} dias`}
                  </p>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center">
                    <div className="font-bold text-green-600">{result.stats.positive}</div>
                    <div className="text-muted-foreground">Positivos</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-yellow-500">{result.stats.neutral}</div>
                    <div className="text-muted-foreground">Neutros</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-red-500">{result.stats.negative}</div>
                    <div className="text-muted-foreground">Negativos</div>
                  </div>
                </div>
              </div>

              {/* Sentiment bar */}
              <div className="mt-4 h-3 rounded-full overflow-hidden flex bg-muted">
                {result.stats.total > 0 && (
                  <>
                    <div className="bg-green-500 transition-all" style={{ width: `${(result.stats.positive / result.stats.total) * 100}%` }} />
                    <div className="bg-yellow-400 transition-all" style={{ width: `${(result.stats.neutral / result.stats.total) * 100}%` }} />
                    <div className="bg-red-500 transition-all" style={{ width: `${(result.stats.negative / result.stats.total) * 100}%` }} />
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Executive Summary */}
          <Card>
            <CardHeader>
              <HelpTooltip text="Em poucas linhas: como o povo está vendo seu candidato agora.">
                <CardTitle className="text-lg flex items-center gap-2 cursor-help">
                  <FileText className="h-5 w-5 text-primary" />
                  Resumo Executivo
                </CardTitle>
              </HelpTooltip>
            </CardHeader>
            <CardContent>
              <p className="text-base leading-relaxed">{summary.overall_summary}</p>
            </CardContent>
          </Card>

          {/* Alerts row */}
          {(summary.risk_alert || summary.opportunity_alert) && (
            <div className="grid gap-4 md:grid-cols-2">
              {summary.risk_alert && (
                <HelpTooltip text="Cuidado! Algo que pode prejudicar seu candidato e precisa de resposta rápida.">
                  <Card className="border-red-200 dark:border-red-900 cursor-help">
                    <CardContent className="pt-6">
                      <div className="flex gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <h3 className="font-semibold text-red-600 dark:text-red-400 mb-1">Alerta de Risco</h3>
                          <p className="text-sm">{summary.risk_alert}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </HelpTooltip>
              )}
              {summary.opportunity_alert && (
                <HelpTooltip text="Boa chance pra seu candidato usar a favor dele.">
                  <Card className="border-green-200 dark:border-green-900 cursor-help">
                    <CardContent className="pt-6">
                      <div className="flex gap-3">
                        <TrendingUp className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                        <div>
                          <h3 className="font-semibold text-green-600 dark:text-green-400 mb-1">Oportunidade</h3>
                          <p className="text-sm">{summary.opportunity_alert}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </HelpTooltip>
              )}
            </div>
          )}

          {/* Positive + Negative points */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <HelpTooltip text="O que o povo está elogiando no seu candidato.">
                  <CardTitle className="text-lg flex items-center gap-2 cursor-help">
                    <ThumbsUp className="h-5 w-5 text-green-500" />
                    Pontos Positivos
                  </CardTitle>
                </HelpTooltip>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {summary.positive_points.map((point, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-green-500 font-bold shrink-0">+</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <HelpTooltip text="O que o povo está reclamando do seu candidato.">
                  <CardTitle className="text-lg flex items-center gap-2 cursor-help">
                    <ThumbsDown className="h-5 w-5 text-red-500" />
                    Pontos Negativos
                  </CardTitle>
                </HelpTooltip>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {summary.negative_points.map((point, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-red-500 font-bold shrink-0">−</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Recommendations */}
          <Card>
            <CardHeader>
              <HelpTooltip text="Dicas práticas do que falar e como agir, baseadas no que o povo comenta.">
                <CardTitle className="text-lg flex items-center gap-2 cursor-help">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  Recomendações de Narrativa
                </CardTitle>
              </HelpTooltip>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {summary.narrative_recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="bg-primary/10 text-primary rounded-full h-6 w-6 flex items-center justify-center shrink-0 text-xs font-bold">
                      {i + 1}
                    </span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Source attribution */}
          <p className="text-xs text-muted-foreground text-center">
            Resumo gerado por IA com base em {result.stats.total} comentários reais coletados entre{' '}
            {new Date(result.period.startDate).toLocaleDateString('pt-BR')} e{' '}
            {new Date(result.period.endDate).toLocaleDateString('pt-BR')}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!summaryMutation.isPending && !result && (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold mb-2">Resumo Inteligente do Candidato</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Selecione um candidato e o período desejado para gerar um resumo executivo automático baseado nos comentários reais coletados.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CandidateSummary;
