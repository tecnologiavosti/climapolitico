import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Trophy, TrendingUp, TrendingDown, ArrowUpRight, 
  ArrowDownRight, RefreshCw, Loader2, AlertCircle 
} from "lucide-react";
import { toast } from "sonner";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer
} from "recharts";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";

const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'];

function TrendIndicator({ value }: { value: number }) {
  if (value > 60) {
    return (
      <Badge variant="default" className="bg-green-500 hover:bg-green-600">
        <TrendingUp className="w-3 h-3 mr-1" />
        {value.toFixed(1)}
      </Badge>
    );
  } else if (value < 40) {
    return (
      <Badge variant="destructive">
        <TrendingDown className="w-3 h-3 mr-1" />
        {value.toFixed(1)}
      </Badge>
    );
  } else {
    return (
      <Badge variant="secondary">
        {value.toFixed(1)}
      </Badge>
    );
  }
}

export default function CandidateRanking() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminCheck();
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });

  // Query: Fetch existing rankings
  const { data: rankings, isLoading } = useQuery({
    queryKey: ['rankings', dateRange, isAdmin],
    queryFn: async () => {
      if (!dateRange?.from || !dateRange?.to) return [];

      let query = supabase
        .from('candidate_rankings')
        .select(`
          *,
          candidates!candidate_rankings_candidate_id_fkey(
            id,
            full_name,
            party,
            region
          )
        `)
        .gte('period_start', dateRange.from.toISOString())
        .lte('period_end', dateRange.to.toISOString())
        .order('rank_position', { ascending: true });

      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!dateRange?.from && !!dateRange?.to
  });

  // Mutation: Calculate ranking
  const calculateRankingMutation = useMutation({
    mutationFn: async () => {
      if (!dateRange?.from || !dateRange?.to) {
        throw new Error('Selecione um período válido');
      }

      const { data, error } = await supabase.functions.invoke('calculate-ranking', {
        body: {
          period_start: dateRange.from.toISOString(),
          period_end: dateRange.to.toISOString()
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Ranking calculado com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['rankings'] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao calcular ranking: ${error.message}`);
    }
  });

  // Calculate insights - VERSÃO CORRIGIDA
  const topCandidate = rankings?.[0];

  // Maior crescimento (apenas se rank_change > 0)
  const mostImproved = rankings?.filter(r => r.rank_change > 0)
    .reduce((max, r) => 
      !max || r.rank_change > max.rank_change ? r : max
    , null as any);

  // Maior queda (apenas se rank_change < 0)
  const mostDeclined = rankings?.filter(r => r.rank_change < 0)
    .reduce((min, r) => 
      !min || r.rank_change < min.rank_change ? r : min
    , null as any);

  // Flags para controlar exibição
  const hasImprovement = mostImproved && mostImproved.rank_change > 0;
  const hasDecline = mostDeclined && mostDeclined.rank_change < 0;

  // Prepare radar chart data
  const radarData = [
    { metric: 'Alcance', ...Object.fromEntries(rankings?.slice(0, 5).map(r => [(r.candidates as any)?.full_name || 'N/A', r.reach_score]) || []) },
    { metric: 'Engajamento', ...Object.fromEntries(rankings?.slice(0, 5).map(r => [(r.candidates as any)?.full_name || 'N/A', r.engagement_score]) || []) },
    { metric: 'Percepção+', ...Object.fromEntries(rankings?.slice(0, 5).map(r => [(r.candidates as any)?.full_name || 'N/A', r.positive_perception]) || []) },
    { metric: 'Impacto Falas', ...Object.fromEntries(rankings?.slice(0, 5).map(r => [(r.candidates as any)?.full_name || 'N/A', r.speech_impact_score || 50]) || []) },
    { metric: 'Tendência', ...Object.fromEntries(rankings?.slice(0, 5).map(r => [(r.candidates as any)?.full_name || 'N/A', r.trend_score]) || []) },
  ];

  // Prepare bar chart data
  const barChartData = rankings?.slice(0, 10).map(r => ({
    name: ((r.candidates as any)?.full_name || 'N/A').split(' ')[0],
    Alcance: r.reach_score,
    Engajamento: r.engagement_score,
    'Percepção+': r.positive_perception,
  })) || [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Trophy className="h-8 w-8 text-yellow-500" />
              Ranking de Candidatos
            </h1>
            <p className="text-muted-foreground">
              Compare o desempenho de todos os candidatos em um período
            </p>
          </div>
          <Button
            onClick={() => calculateRankingMutation.mutate()}
            disabled={calculateRankingMutation.isPending}
          >
            {calculateRankingMutation.isPending ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" /> 
                Calculando...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" /> 
                Atualizar Ranking
              </>
            )}
          </Button>
        </div>

        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
      </div>

      {/* Insights Cards */}
      {rankings && rankings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                Melhor Desempenho
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(topCandidate?.candidates as any)?.full_name || 'N/A'}</div>
              <p className="text-xs text-muted-foreground">
                Score: {topCandidate?.overall_score.toFixed(1)}
              </p>
            </CardContent>
          </Card>

          {mostImproved && mostImproved.rank_change > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  Maior Crescimento
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(mostImproved.candidates as any)?.full_name || 'N/A'}</div>
                <p className="text-xs text-green-600">
                  +{mostImproved.rank_change} posições
                </p>
              </CardContent>
            </Card>
          )}

          {mostDeclined && mostDeclined.rank_change < 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  Maior Queda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(mostDeclined.candidates as any)?.full_name || 'N/A'}</div>
                <p className="text-xs text-red-600">
                  {mostDeclined.rank_change} posições
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Ranking Table */}
      <Card>
        <CardHeader>
          <CardTitle>Ranking Geral</CardTitle>
          <CardDescription>
            Ordenado por Score Geral (ponderação de todas as métricas)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !rankings || rankings.length === 0 ? (
            <div className="text-center py-12">
              <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Nenhum ranking calculado para este período.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Clique em "Atualizar Ranking" para calcular.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Pos.</TableHead>
                  <TableHead className="w-[80px]">Mudança</TableHead>
                  <TableHead>Candidato</TableHead>
                  <TableHead className="text-right">Score Geral</TableHead>
                  <TableHead className="text-right">Alcance</TableHead>
                  <TableHead className="text-right">Engajamento</TableHead>
                  <TableHead className="text-right">Percepção+</TableHead>
                  <TableHead className="text-right">Percepção-</TableHead>
                  <TableHead className="text-right">Falas</TableHead>
                  <TableHead className="text-right">Tendência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankings.map((rank, index) => (
                  <TableRow key={rank.id}>
                    <TableCell>
                      <Badge variant={index < 3 ? "default" : "secondary"}>
                        #{rank.rank_position}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {rank.rank_change > 0 && (
                        <div className="flex items-center text-green-600">
                          <ArrowUpRight className="w-4 h-4" />
                          <span className="text-sm">+{rank.rank_change}</span>
                        </div>
                      )}
                      {rank.rank_change < 0 && (
                        <div className="flex items-center text-red-600">
                          <ArrowDownRight className="w-4 h-4" />
                          <span className="text-sm">{rank.rank_change}</span>
                        </div>
                      )}
                      {rank.rank_change === 0 && (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{(rank.candidates as any)?.full_name || 'N/A'}</div>
                        <div className="text-sm text-muted-foreground">
                          {(rank.candidates as any)?.party} • {(rank.candidates as any)?.region}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={rank.overall_score} className="w-16 h-2" />
                        <span className="font-bold">{rank.overall_score.toFixed(1)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{rank.reach_score.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{rank.engagement_score.toFixed(1)}</TableCell>
                    <TableCell className="text-right text-green-600 font-medium">
                      {rank.positive_perception.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right text-red-600 font-medium">
                      {rank.negative_perception.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {rank.speech_impact_score?.toFixed(1) || 'N/A'}
                    </TableCell>
                    <TableCell className="text-right">
                      <TrendIndicator value={rank.trend_score} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Charts */}
      {rankings && rankings.length > 0 && (
        <Tabs defaultValue="radar" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="radar">Comparação Radar</TabsTrigger>
            <TabsTrigger value="bars">Comparação por Métrica</TabsTrigger>
          </TabsList>

          <TabsContent value="radar">
            <Card>
              <CardHeader>
                <CardTitle>Comparação Multidimensional - Top 5</CardTitle>
                <CardDescription>
                  Visualize múltiplas métricas em um único gráfico
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} />
                    {rankings.slice(0, 5).map((rank, i) => (
                      <Radar
                        key={rank.id}
                        name={(rank.candidates as any)?.full_name || 'N/A'}
                        dataKey={(rank.candidates as any)?.full_name || 'N/A'}
                        stroke={COLORS[i]}
                        fill={COLORS[i]}
                        fillOpacity={0.3}
                      />
                    ))}
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bars">
            <Card>
              <CardHeader>
                <CardTitle>Comparação Direta por Métrica - Top 10</CardTitle>
                <CardDescription>
                  Compare candidatos lado a lado em cada dimensão
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={barChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Alcance" fill="#8b5cf6" />
                    <Bar dataKey="Engajamento" fill="#06b6d4" />
                    <Bar dataKey="Percepção+" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}