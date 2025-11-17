import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, TrendingUp, TrendingDown, Minus, Filter, X } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";

export default function AnalysisHistory() {
  const [sentimentFilter, setSentimentFilter] = useState<string>("all");
  const [ideologyFilter, setIdeologyFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });

  const { data: analyses, isLoading } = useQuery({
    queryKey: ['candidate-analyses', dateRange],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let query = supabase
        .from('candidate_analyses')
        .select(`
          *,
          candidates (
            full_name,
            region
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Apply filters
  const filteredAnalyses = analyses?.filter((analysis) => {
    const sentimentMatch = sentimentFilter === "all" || 
      analysis.sentiment_label?.toLowerCase().includes(sentimentFilter.toLowerCase());
    const ideologyMatch = ideologyFilter === "all" || 
      analysis.ideology_label?.toLowerCase() === ideologyFilter.toLowerCase();
    
    return sentimentMatch && ideologyMatch;
  }) || [];

  const chartData = filteredAnalyses?.map(a => ({
    date: format(new Date(a.created_at), 'dd/MM'),
    sentimentScore: a.sentiment_score,
    candidate: (a.candidates as any)?.full_name || 'Unknown',
  })) || [];

  const handleClearFilters = () => {
    setSentimentFilter("all");
    setIdeologyFilter("all");
    setDateRange({
      from: new Date(new Date().setDate(new Date().getDate() - 30)),
      to: new Date(),
    });
  };

  const hasActiveFilters = sentimentFilter !== "all" || ideologyFilter !== "all";

  const getSentimentColor = (score: number | null) => {
    if (!score) return 'bg-muted';
    if (score >= 60) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getTrendIcon = (trend: string | null) => {
    const trendLower = trend?.toLowerCase() || '';
    if (trendLower === 'up' || trendLower === 'alta') return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trendLower === 'down' || trendLower === 'baixa') return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Histórico de Análises</h1>
        <p className="text-muted-foreground">Visualize todas as análises multi-IA realizadas</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros
              </CardTitle>
              <CardDescription>Filtre as análises por sentimento, ideologia e período</CardDescription>
            </div>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={handleClearFilters}>
                <X className="h-4 w-4 mr-2" />
                Limpar Filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Período</label>
              <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Sentimento</label>
                <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="Selecione o sentimento" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="positiv">Positivo</SelectItem>
                    <SelectItem value="neutro">Neutro</SelectItem>
                    <SelectItem value="negativ">Negativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Ideologia</label>
                <Select value={ideologyFilter} onValueChange={setIdeologyFilter}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="Selecione a ideologia" />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="esquerda">Esquerda</SelectItem>
                    <SelectItem value="centro-esquerda">Centro-Esquerda</SelectItem>
                    <SelectItem value="centro">Centro</SelectItem>
                    <SelectItem value="centro-direita">Centro-Direita</SelectItem>
                    <SelectItem value="direita">Direita</SelectItem>
                    <SelectItem value="neutro">Neutro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          
          {hasActiveFilters && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <span>Mostrando {filteredAnalyses.length} de {analyses?.length || 0} análises</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sentiment Evolution Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Evolução do Sentimento</CardTitle>
          <CardDescription>Acompanhe a variação do sentimento ao longo do tempo</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="sentimentScore" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  name="Score de Sentimento"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              Nenhuma análise realizada ainda
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis Table */}
      <Card>
        <CardHeader>
          <CardTitle>Todas as Análises</CardTitle>
          <CardDescription>Histórico completo com detalhes de cada análise</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : analyses && analyses.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidato</TableHead>
                  <TableHead>IAs Utilizadas</TableHead>
                  <TableHead>Sentimento</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Tendência</TableHead>
                  <TableHead>Keywords</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAnalyses.map((analysis) => (
                  <TableRow key={analysis.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{(analysis.candidates as any)?.full_name || 'N/A'}</p>
                        <p className="text-sm text-muted-foreground">{(analysis.candidates as any)?.region || 'N/A'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {analysis.ai_models_used?.map((model) => (
                          <Badge key={model} variant="outline" className="text-xs">
                            <Brain className="h-3 w-3 mr-1" />
                            {model}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        analysis.sentiment_label?.toLowerCase().includes('positiv') ? 'default' :
                        analysis.sentiment_label?.toLowerCase().includes('negativ') ? 'destructive' :
                        'secondary'
                      }>
                        {analysis.sentiment_label || 'N/A'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{analysis.sentiment_score?.toFixed(0) || 0}%</span>
                        </div>
                        <Progress 
                          value={analysis.sentiment_score || 0} 
                          className="h-2"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {getTrendIcon(analysis.trend)}
                        <span className="text-sm capitalize">{analysis.trend || 'neutral'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {analysis.keywords?.slice(0, 3).map((keyword) => (
                          <Badge key={keyword} variant="secondary" className="text-xs">
                            {keyword}
                          </Badge>
                        ))}
                        {analysis.keywords && analysis.keywords.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{analysis.keywords.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(analysis.created_at), "dd/MM/yyyy HH:mm")}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : hasActiveFilters ? (
            <div className="text-center py-12 text-muted-foreground">
              <Filter className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma análise encontrada com esses filtros</p>
              <Button variant="outline" className="mt-4" onClick={handleClearFilters}>
                Limpar Filtros
              </Button>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma análise realizada ainda</p>
              <p className="text-sm">Vá para Candidatos e clique em "Analisar" para começar</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
