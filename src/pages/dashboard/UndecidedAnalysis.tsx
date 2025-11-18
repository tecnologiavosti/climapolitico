import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { 
  Users, 
  TrendingUp, 
  Brain, 
  Target, 
  Lightbulb, 
  AlertCircle,
  Loader2,
  Trash2,
  Eye,
  MessageSquare
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export default function UndecidedAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminCheck();
  const { user } = useAuth();

  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedAnalysis, setSelectedAnalysis] = useState<any>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });

  // Fetch candidates
  const { data: candidates } = useQuery({
    queryKey: ['candidates', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, full_name, region, party')
        .order('full_name');
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch undecided analyses
  const { data: analyses, isLoading: analysesLoading } = useQuery({
    queryKey: ['undecided-analyses', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('undecided_analyses')
        .select('*, candidates(full_name, party, region)')
        .order('created_at', { ascending: false });
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Analyze mutation
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCandidateId) {
        throw new Error('Selecione um candidato');
      }

      const { data, error } = await supabase.functions.invoke('analyze-undecided', {
        body: {
          candidate_id: selectedCandidateId,
          period_start: dateRange?.from?.toISOString(),
          period_end: dateRange?.to?.toISOString(),
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Análise concluída!",
        description: "A análise de eleitores indecisos foi concluída com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['undecided-analyses'] });
      setSelectedAnalysis(data.analysis);
    },
    onError: (error: any) => {
      console.error('Analysis error:', error);
      toast({
        title: "Erro na análise",
        description: error.message || "Não foi possível realizar a análise.",
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('undecided_analyses')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Análise excluída",
        description: "A análise foi removida com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['undecided-analyses'] });
      if (selectedAnalysis) {
        setSelectedAnalysis(null);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao excluir",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getImpactColor = (impact: string) => {
    switch (impact?.toLowerCase()) {
      case 'alto':
      case 'alta':
        return 'bg-red-500';
      case 'médio':
      case 'média':
        return 'bg-yellow-500';
      case 'baixo':
      case 'baixa':
        return 'bg-green-500';
      default:
        return 'bg-muted';
    }
  };

  const getPriorityVariant = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'alta':
        return 'destructive';
      case 'média':
        return 'default';
      case 'baixa':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Análise de Público Indeciso</h1>
        <p className="text-muted-foreground">
          Detecte padrões comportamentais e estratégias para converter eleitores indecisos
        </p>
      </div>

      <Tabs defaultValue="new" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="new">Nova Análise</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configurar Análise</CardTitle>
              <CardDescription>
                Selecione o candidato e o período para analisar o comportamento dos eleitores indecisos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="candidate">Candidato</Label>
                <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
                  <SelectTrigger id="candidate">
                    <SelectValue placeholder="Selecione um candidato" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates?.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Período de Análise</Label>
                <DateRangePicker
                  dateRange={dateRange}
                  onDateRangeChange={setDateRange}
                />
              </div>

              <Button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending || !selectedCandidateId}
                className="w-full"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analisando...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Analisar Eleitores Indecisos
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {selectedAnalysis && (
            <div className="space-y-6">
              {/* KPIs */}
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Eleitores Indecisos</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {selectedAnalysis.undecided_percentage?.toFixed(1)}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedAnalysis.neutral_profiles_count} de {selectedAnalysis.total_profiles_analyzed} perfis
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Volatilidade</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {selectedAnalysis.sentiment_fluctuation_score}/100
                    </div>
                    <Progress 
                      value={selectedAnalysis.sentiment_fluctuation_score} 
                      className="mt-2"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Confiança da Análise</CardTitle>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {selectedAnalysis.confidence_score}/100
                    </div>
                    <Progress 
                      value={selectedAnalysis.confidence_score} 
                      className="mt-2"
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Evolução Temporal da Indecisão */}
              {selectedAnalysis?.temporal_evolution && selectedAnalysis.temporal_evolution.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Evolução Temporal da Indecisão
                    </CardTitle>
                    <CardDescription>
                      Acompanhe como a indecisão evoluiu ao longo do período analisado
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={selectedAnalysis.temporal_evolution}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis 
                          dataKey="date" 
                          tickFormatter={(date) => format(new Date(date), 'dd/MM', { locale: ptBR })}
                          className="text-xs"
                        />
                        <YAxis 
                          label={{ value: '% Indecisos', angle: -90, position: 'insideLeft' }}
                          className="text-xs"
                        />
                        <Tooltip 
                          labelFormatter={(date) => format(new Date(date), 'dd/MM/yyyy', { locale: ptBR })}
                          formatter={(value: number) => [`${value.toFixed(1)}%`, 'Indecisão']}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Legend />
                        <Line 
                          type="monotone" 
                          dataKey="undecided_percentage" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth={2}
                          name="% Indecisos"
                          dot={{ fill: 'hsl(var(--primary))' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Redes Sociais Analisadas */}
              {selectedAnalysis?.social_media_breakdown?.sources && selectedAnalysis.social_media_breakdown.sources.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      Redes Sociais Analisadas
                    </CardTitle>
                    <CardDescription>
                      Distribuição das fontes de dados por rede social
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={selectedAnalysis.social_media_breakdown.sources}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="network" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip 
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Legend />
                        <Bar dataKey="posts" fill="hsl(var(--chart-1))" name="Posts" />
                        <Bar dataKey="comments" fill="hsl(var(--chart-2))" name="Comentários" />
                        <Bar dataKey="interactions" fill="hsl(var(--chart-3))" name="Interações" />
                      </BarChart>
                    </ResponsiveContainer>

                    <Table className="mt-4">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rede Social</TableHead>
                          <TableHead className="text-right">Posts</TableHead>
                          <TableHead className="text-right">Comentários</TableHead>
                          <TableHead className="text-right">Interações</TableHead>
                          <TableHead className="text-right">Perfis</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedAnalysis.social_media_breakdown.sources.map((source: any) => (
                          <TableRow key={source.network}>
                            <TableCell className="font-medium">{source.network}</TableCell>
                            <TableCell className="text-right">{source.posts.toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right">{source.comments.toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right">{source.interactions.toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right">{source.profiles}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t">
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Posts</p>
                        <p className="text-2xl font-bold">{selectedAnalysis.social_media_breakdown.total_posts?.toLocaleString('pt-BR')}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Comentários</p>
                        <p className="text-2xl font-bold">{selectedAnalysis.social_media_breakdown.total_comments?.toLocaleString('pt-BR')}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Interações</p>
                        <p className="text-2xl font-bold">{selectedAnalysis.social_media_breakdown.total_interactions?.toLocaleString('pt-BR')}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Perfis</p>
                        <p className="text-2xl font-bold">{selectedAnalysis.social_media_breakdown.total_profiles?.toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Comparação Entre Candidatos */}
              {selectedAnalysis?.candidates_comparison && selectedAnalysis.candidates_comparison.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Comparação Entre Candidatos
                    </CardTitle>
                    <CardDescription>
                      Intenção de voto positiva vs negativa por candidato
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={Math.max(300, selectedAnalysis.candidates_comparison.length * 60)}>
                      <BarChart 
                        data={selectedAnalysis.candidates_comparison}
                        layout="vertical"
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis 
                          type="number" 
                          label={{ value: '% Intenção', position: 'bottom' }}
                          className="text-xs"
                        />
                        <YAxis 
                          dataKey="candidate_name" 
                          type="category" 
                          width={150}
                          className="text-xs"
                        />
                        <Tooltip 
                          formatter={(value: number) => `${value.toFixed(1)}%`}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Legend />
                        <Bar dataKey="positive_percentage" fill="hsl(var(--chart-2))" name="Intenção Positiva" />
                        <Bar dataKey="negative_percentage" fill="hsl(var(--destructive))" name="Intenção Negativa" />
                        <Bar dataKey="neutral_percentage" fill="hsl(var(--muted))" name="Neutros/Indecisos" />
                      </BarChart>
                    </ResponsiveContainer>

                    <Table className="mt-4">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Candidato</TableHead>
                          <TableHead className="text-right">Positiva</TableHead>
                          <TableHead className="text-right">Negativa</TableHead>
                          <TableHead className="text-right">Neutra</TableHead>
                          <TableHead className="text-right">Total Menções</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedAnalysis.candidates_comparison
                          ?.sort((a: any, b: any) => b.positive_percentage - a.positive_percentage)
                          .map((candidate: any) => (
                          <TableRow key={candidate.candidate_id}>
                            <TableCell className="font-medium">{candidate.candidate_name}</TableCell>
                            <TableCell className="text-right">
                              <Badge className="bg-green-600">{candidate.positive_percentage.toFixed(1)}%</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="destructive">{candidate.negative_percentage.toFixed(1)}%</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="secondary">{candidate.neutral_percentage.toFixed(1)}%</Badge>
                            </TableCell>
                            <TableCell className="text-right">{candidate.total_mentions.toLocaleString('pt-BR')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Padrões Comportamentais */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="w-5 h-5" />
                    Padrões Comportamentais
                  </CardTitle>
                  <CardDescription>
                    Comportamentos identificados em eleitores indecisos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-4">
                      {selectedAnalysis.behavioral_patterns?.map((pattern: any, index: number) => (
                        <div key={index} className="border-l-4 border-primary pl-4 py-2">
                          <div className="flex items-start justify-between mb-2">
                            <h4 className="font-medium">{pattern.pattern}</h4>
                            <Badge variant="outline">{pattern.frequency}</Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-sm text-muted-foreground">Impacto:</span>
                            <Badge className={getImpactColor(pattern.impact)}>
                              {pattern.impact}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Gatilhos de Decisão */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Gatilhos de Decisão
                  </CardTitle>
                  <CardDescription>
                    Fatores que podem influenciar a escolha dos indecisos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {selectedAnalysis.decision_triggers?.map((trigger: any, index: number) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{trigger.trigger}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs">
                              Efetividade: {trigger.effectiveness}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {trigger.timing}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Perfil Demográfico */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Perfil Demográfico
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <h4 className="font-medium mb-2">Faixas Etárias</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedAnalysis.demographic_profile?.age_groups?.map((age: string, i: number) => (
                          <Badge key={i} variant="secondary">{age}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Regiões</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedAnalysis.demographic_profile?.regions?.map((region: string, i: number) => (
                          <Badge key={i} variant="secondary">{region}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Preocupações</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedAnalysis.demographic_profile?.concerns?.map((concern: string, i: number) => (
                          <Badge key={i} variant="outline">{concern}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tópicos-Chave */}
              <Card>
                <CardHeader>
                  <CardTitle>Tópicos que Geram Indecisão</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {selectedAnalysis.key_topics?.map((topic: string, index: number) => (
                      <Badge key={index} variant="default" className="text-sm">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Estratégias de Persuasão */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="w-5 h-5" />
                    Estratégias de Persuasão
                  </CardTitle>
                  <CardDescription>
                    Ações práticas para converter eleitores indecisos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-4">
                      {selectedAnalysis.persuasion_strategies?.map((strategy: any, index: number) => (
                        <div key={index} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-start justify-between">
                            <h4 className="font-medium flex-1">{strategy.strategy}</h4>
                            <Badge variant={getPriorityVariant(strategy.priority)}>
                              {strategy.priority}
                            </Badge>
                          </div>
                          <div className="grid gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">Público-alvo:</span>
                              <span className="ml-2 font-medium">{strategy.target}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Canal:</span>
                              <Badge variant="outline" className="ml-2">{strategy.channel}</Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Análises</CardTitle>
              <CardDescription>
                Análises anteriores de eleitores indecisos
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analysesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : analyses && analyses.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidato</TableHead>
                      <TableHead>% Indecisos</TableHead>
                      <TableHead>Volatilidade</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyses.map((analysis: any) => (
                      <TableRow key={analysis.id}>
                        <TableCell className="font-medium">
                          {(analysis.candidates as any)?.full_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {analysis.undecided_percentage?.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {analysis.sentiment_fluctuation_score}/100
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Progress 
                            value={analysis.confidence_score} 
                            className="w-20"
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(analysis.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedAnalysis(analysis)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteMutation.mutate(analysis.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Nenhuma análise encontrada</AlertTitle>
                  <AlertDescription>
                    Crie sua primeira análise de eleitores indecisos usando a aba "Nova Análise"
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}