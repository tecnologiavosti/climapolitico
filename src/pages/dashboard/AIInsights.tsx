import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, AlertTriangle, TrendingUp, Lightbulb, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { InsightCard } from "@/components/dashboard/InsightCard";
import { InsightFilters } from "@/components/dashboard/InsightFilters";
import { TrendingKeywords } from "@/components/dashboard/TrendingKeywords";

interface Insight {
  id: string;
  insight_type: string;
  priority: string;
  title: string;
  description: string;
  recommended_actions: string[];
  confidence_score: number;
  created_at: string;
  is_active: boolean;
  candidate_id?: string;
}

const AIInsights = () => {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const { data: insights, isLoading } = useQuery({
    queryKey: ['ai-insights', selectedType, selectedPriority, selectedCandidate, showDismissed],
    queryFn: async () => {
      let query = supabase
        .from('ai_insights')
        .select('*')
        .order('created_at', { ascending: false });

      if (selectedType) query = query.eq('insight_type', selectedType);
      if (selectedPriority) query = query.eq('priority', selectedPriority);
      if (selectedCandidate) query = query.eq('candidate_id', selectedCandidate);
      if (!showDismissed) query = query.eq('is_active', true);

      const { data, error } = await query;
      if (error) throw error;
      return data as Insight[];
    }
  });

  const { data: candidates } = useQuery({
    queryKey: ['candidates-for-insights'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name')
        .order('full_name');
      if (error) throw error;
      return data;
    }
  });

  const generateInsightsMutation = useMutation({
    mutationFn: async (candidateId?: string) => {
      const { data, error } = await supabase.functions.invoke('generate-insights', {
        body: { candidateId, daysBack: 7 }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] });
      toast.success(`${data.count} novos insights gerados!`);
    },
    onError: (error) => {
      console.error('Error generating insights:', error);
      toast.error('Erro ao gerar insights');
    }
  });

  const stats = {
    total: insights?.length || 0,
    critical: insights?.filter(i => i.priority === 'high' && i.is_active).length || 0,
    opportunities: insights?.filter(i => i.insight_type === 'opportunity' && i.is_active).length || 0,
    avgConfidence: insights?.length 
      ? Math.round(insights.reduce((acc, i) => acc + (i.confidence_score || 0), 0) / insights.length)
      : 0
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            IA & Insights
          </h1>
          <p className="text-muted-foreground mt-1">
            Inteligência estratégica gerada automaticamente
          </p>
        </div>
        <Button 
          onClick={() => generateInsightsMutation.mutate(undefined)}
          disabled={generateInsightsMutation.isPending}
        >
          {generateInsightsMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Gerando...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Gerar Novos Insights
            </>
          )}
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Insights</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Últimos 30 dias</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas Críticos</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.critical}</div>
            <p className="text-xs text-muted-foreground">Requerem ação imediata</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Oportunidades</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{stats.opportunities}</div>
            <p className="text-xs text-muted-foreground">Para explorar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Confiança Média</CardTitle>
            <Lightbulb className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgConfidence}%</div>
            <p className="text-xs text-muted-foreground">Qualidade dos dados</p>
          </CardContent>
        </Card>
      </div>

      {/* Trending Keywords */}
      <TrendingKeywords />

      {/* Filters */}
      <InsightFilters
        selectedType={selectedType}
        setSelectedType={setSelectedType}
        selectedPriority={selectedPriority}
        setSelectedPriority={setSelectedPriority}
        selectedCandidate={selectedCandidate}
        setSelectedCandidate={setSelectedCandidate}
        showDismissed={showDismissed}
        setShowDismissed={setShowDismissed}
        candidates={candidates || []}
      />

      {/* Insights List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : insights && insights.length > 0 ? (
        <div className="space-y-4">
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Nenhum insight disponível</h3>
            <p className="text-muted-foreground mb-4">
              Clique em "Gerar Novos Insights" para analisar seus dados
            </p>
            <Button onClick={() => generateInsightsMutation.mutate(undefined)}>
              <Sparkles className="mr-2 h-4 w-4" />
              Gerar Insights
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AIInsights;