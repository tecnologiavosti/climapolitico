import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Users, MessageSquare, Eye, AlertCircle, Activity, LayoutDashboard } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";
import { AIModelsPanel } from "@/components/dashboard/AIModelsPanel";
import { AIModelAgreementDashboard } from "@/components/dashboard/AIModelAgreementDashboard";
import { CandidateOverviewPanel } from "@/components/dashboard/CandidateOverviewPanel";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', 'hsl(var(--warning))', 'hsl(var(--muted))'];

export default function Overview() {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const { isAdmin } = useAdminCheck();
  const { user } = useAuth();

  // Query: Total de candidatos
  const { data: candidates, isLoading: loadingCandidates } = useQuery({
    queryKey: ['candidates-overview', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, full_name, mentions, sentiment, party, region');
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // Query: Análises de candidatos
  const { data: analyses, isLoading: loadingAnalyses } = useQuery({
    queryKey: ['analyses-overview', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('candidate_analyses')
        .select('id, candidate_id, sentiment_score, mentions_count, ideology_label, created_at, sentiment_label');
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // Query: Análises de fala
  const { data: speeches, isLoading: loadingSpeeches } = useQuery({
    queryKey: ['speeches-overview', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('speech_analyses')
        .select('id, risk_level, negative_perception_score, created_at');
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // Query: Rankings
  const { data: rankings, isLoading: loadingRankings } = useQuery({
    queryKey: ['rankings-overview', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('candidate_rankings')
        .select(`
          id,
          candidate_id,
          overall_score,
          rank_position,
          rank_change,
          created_at,
          user_id,
          candidates!candidate_rankings_candidate_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // Calcular métricas
  const totalMentions = analyses?.reduce((sum, a) => sum + (a.mentions_count || 0), 0) || 0;
  const totalCandidates = candidates?.length || 0;
  const avgSentiment = analyses?.length 
    ? Math.round(analyses.reduce((sum, a) => sum + (a.sentiment_score || 0), 0) / analyses.length)
    : 0;
  const totalSpeeches = speeches?.length || 0;

  // Preparar dados de sentimento por dia (últimos 7 dias)
  const sentimentData = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    
    const dayAnalyses = analyses?.filter(a => {
      const createdAt = new Date(a.created_at || '');
      return createdAt >= dayStart && createdAt <= dayEnd;
    }) || [];

    const positive = dayAnalyses.filter(a => a.sentiment_label === 'Positivo').length;
    const negative = dayAnalyses.filter(a => a.sentiment_label === 'Negativo').length;
    const neutral = dayAnalyses.filter(a => a.sentiment_label === 'Neutro').length;

    return {
      name: format(date, 'EEE', { locale: ptBR }),
      positive,
      negative,
      neutral
    };
  });

  // Preparar dados de candidatos (top 5 por menções)
  const candidateData = candidates
    ?.sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
    .slice(0, 5)
    .map(c => ({
      name: c.full_name,
      mentions: c.mentions || 0,
      sentiment: Math.round((c.sentiment || 0) * 100)
    })) || [];

  // Preparar dados de ideologia
  const ideologyCount = analyses?.reduce((acc, a) => {
    const ideology = a.ideology_label || 'Neutro';
    acc[ideology] = (acc[ideology] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const ideologyData = [
    { name: "Esquerda", value: ideologyCount['Esquerda'] || 0, color: COLORS[0] },
    { name: "Centro", value: ideologyCount['Centro'] || 0, color: COLORS[2] },
    { name: "Direita", value: ideologyCount['Direita'] || 0, color: COLORS[1] },
    { name: "Neutro", value: ideologyCount['Neutro'] || 0, color: COLORS[3] },
  ].filter(d => d.value > 0);

  const isLoading = loadingCandidates || loadingAnalyses || loadingSpeeches || loadingRankings;
  return (
    <div className="space-y-6">
      {/* Candidate Selector for Consolidated View */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <span className="font-medium">Visão Consolidada do Candidato</span>
          </div>
          <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Selecione um candidato para análise detalhada" />
            </SelectTrigger>
            <SelectContent>
              {candidates?.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedCandidateId && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedCandidateId("")}>
              Limpar seleção
            </Button>
          )}
        </div>
      </Card>

      {/* Consolidated Candidate Panel - when a candidate is selected */}
      {selectedCandidateId && (
        <CandidateOverviewPanel candidateId={selectedCandidateId} />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Menções Total</p>
              {isLoading ? (
                <Skeleton className="h-10 w-24 mt-2" />
              ) : (
                <p className="text-3xl font-bold mt-2">{totalMentions.toLocaleString('pt-BR')}</p>
              )}
              <div className="flex items-center gap-1 mt-2 text-muted-foreground text-sm">
                <Activity className="h-4 w-4" />
                <span>{analyses?.length || 0} análises</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <MessageSquare className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Candidatos</p>
              {isLoading ? (
                <Skeleton className="h-10 w-16 mt-2" />
              ) : (
                <p className="text-3xl font-bold mt-2">{totalCandidates}</p>
              )}
              <div className="flex items-center gap-1 mt-2 text-muted-foreground text-sm">
                <Activity className="h-4 w-4" />
                <span>monitorados</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Sentimento Médio</p>
              {isLoading ? (
                <Skeleton className="h-10 w-20 mt-2" />
              ) : (
                <p className="text-3xl font-bold mt-2">{avgSentiment}%</p>
              )}
              <div className="flex items-center gap-1 mt-2 text-muted-foreground text-sm">
                {avgSentiment >= 50 ? (
                  <TrendingUp className="h-4 w-4 text-success" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
                <span>{avgSentiment >= 50 ? 'Positivo' : 'Atenção'}</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Análises de Fala</p>
              {isLoading ? (
                <Skeleton className="h-10 w-16 mt-2" />
              ) : (
                <p className="text-3xl font-bold mt-2">{totalSpeeches}</p>
              )}
              <div className="flex items-center gap-1 mt-2 text-muted-foreground text-sm">
                <Activity className="h-4 w-4" />
                <span>discursos</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <Eye className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>
      </div>

      {/* AI Models Panel */}
      <AIModelsPanel />

      {/* AI Model Agreement Dashboard */}
      <AIModelAgreementDashboard />

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sentiment Over Time */}
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-bold">Sentimento ao Longo do Tempo</h3>
            <p className="text-sm text-muted-foreground">Últimos 7 dias</p>
          </div>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : sentimentData.every(d => d.positive === 0 && d.negative === 0 && d.neutral === 0) ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <p>Nenhuma análise nos últimos 7 dias</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={sentimentData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-muted-foreground" />
                <YAxis className="text-muted-foreground" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="positive" stroke="hsl(var(--success))" strokeWidth={2} name="Positivo" />
                <Line type="monotone" dataKey="negative" stroke="hsl(var(--destructive))" strokeWidth={2} name="Negativo" />
                <Line type="monotone" dataKey="neutral" stroke="hsl(var(--warning))" strokeWidth={2} name="Neutro" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Ideology Distribution */}
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-bold">Distribuição Ideológica</h3>
            <p className="text-sm text-muted-foreground">Análise do público</p>
          </div>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : ideologyData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <p>Nenhum dado de ideologia disponível</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={ideologyData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {ideologyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Candidates Performance */}
      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-bold">Performance dos Candidatos (Top 5)</h3>
          <p className="text-sm text-muted-foreground">Menções vs Sentimento</p>
        </div>
        {isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : candidateData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            <p>Nenhum candidato cadastrado ainda</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={candidateData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" className="text-muted-foreground" />
              <YAxis yAxisId="left" orientation="left" className="text-muted-foreground" />
              <YAxis yAxisId="right" orientation="right" className="text-muted-foreground" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="mentions" fill="hsl(var(--primary))" name="Menções" />
              <Bar yAxisId="right" dataKey="sentiment" fill="hsl(var(--success))" name="Sentimento %" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Rankings */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold">Rankings Recentes</h3>
            <p className="text-sm text-muted-foreground">Últimas posições calculadas</p>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : rankings && rankings.length > 0 ? (
          <div className="space-y-3">
            {rankings.slice(0, 5).map((rank) => {
              const candidate = rank.candidates as any;
              const changeColor = rank.rank_change > 0 
                ? 'text-success' 
                : rank.rank_change < 0 
                ? 'text-destructive' 
                : 'text-muted-foreground';
              
              return (
                <div key={rank.id} className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center text-white font-bold text-sm">
                      {rank.rank_position}
                    </div>
                    <div>
                      <p className="font-medium">{candidate?.full_name || 'N/A'}</p>
                      <p className="text-sm text-muted-foreground">
                        Score: {rank.overall_score.toFixed(1)}
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 ${changeColor}`}>
                    {rank.rank_change > 0 && <TrendingUp className="h-4 w-4" />}
                    {rank.rank_change < 0 && <TrendingDown className="h-4 w-4" />}
                    {rank.rank_change !== 0 && (
                      <span className="text-sm font-medium">
                        {Math.abs(rank.rank_change)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-40 flex flex-col items-center justify-center text-center text-muted-foreground p-6">
            <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
            <p>Nenhum ranking disponível</p>
            <p className="text-sm mt-1">Execute o cálculo de ranking para visualizar</p>
          </div>
        )}
      </Card>
    </div>
  );
}
