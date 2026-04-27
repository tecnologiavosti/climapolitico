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
import { useTokenValidator } from "@/hooks/useTokenValidator";
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
  MessageSquare,
  CheckCircle,
  MapPin
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HelpTooltip } from "@/components/ui/help-tooltip";
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

// Region Validation Alert Component
const RegionValidationAlert = ({ candidate, analysis }: any) => {
  if (!candidate || !analysis) return null;
  
  const candidateRegion = candidate.region?.toUpperCase() || 'BRASIL';
  const analysisScope = analysis.geographic_scope || 'desconhecido';
  
  const isValid = 
    (candidateRegion === 'BRASIL' && analysisScope === 'nacional') ||
    (candidateRegion === 'NACIONAL' && analysisScope === 'nacional') ||
    analysisScope.includes(candidateRegion.toLowerCase().replace(/ /g, '_'));
  
  if (isValid) {
    return (
      <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-800 dark:text-green-400">Região Validada ✓</AlertTitle>
        <AlertDescription className="text-green-700 dark:text-green-500">
          Análise feita com dados da região correta: <strong>{candidateRegion}</strong>
        </AlertDescription>
      </Alert>
    );
  }
  
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Aviso de Região ⚠️</AlertTitle>
      <AlertDescription>
        Esta análise pode conter dados de regiões diferentes da região do candidato ({candidateRegion}).
        Considere refazer a análise com dados da região correta.
      </AlertDescription>
    </Alert>
  );
};

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
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [socialNetworkFilter, setSocialNetworkFilter] = useState<string>("all");

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

  const { validateToken } = useTokenValidator();
  
  // Analyze mutation with retry logic and pre-flight validation
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCandidateId) {
        throw new Error('Selecione um candidato');
      }

      // 🔥 PRE-FLIGHT TOKEN VALIDATION
      console.group('🔐 PRE-FLIGHT AUTH CHECK');
      const isTokenValid = await validateToken();
      console.groupEnd();
      
      if (!isTokenValid) {
        throw new Error('Token inválido. Redirecionando para login...');
      }

      let retries = 2;
      
      while (retries > 0) {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        console.log('🔑 Token status before undecided analysis:', {
          hasSession: !!session,
          hasAccessToken: !!session?.access_token,
          tokenExpiry: session?.expires_at,
          isExpired: session?.expires_at ? new Date(session.expires_at * 1000) < new Date() : true,
          retriesLeft: retries
        });
        
        if (sessionError || !session) {
          throw new Error('Sessão inválida. Por favor, faça login novamente.');
        }

        try {
          const { data, error } = await supabase.functions.invoke('analyze-undecided', {
            body: {
              candidate_id: selectedCandidateId,
              period_start: dateRange?.from?.toISOString(),
              period_end: dateRange?.to?.toISOString(),
            },
          });

          // FASE 1.3: Implementar retry automático com refresh em caso de 401
          if (error) {
            const isAuthError = error.message?.includes('Unauthorized') || 
                               error.message?.includes('JWT') ||
                               error.message?.includes('authorization') ||
                               error.message?.includes('401');
            
            if (isAuthError && retries > 1) {
              console.log('🔄 Authentication error detected, attempting token refresh...');
              const { error: refreshError } = await supabase.auth.refreshSession();
              
              if (refreshError) {
                console.error('❌ Token refresh failed:', refreshError);
                throw new Error('Sessão expirada. Por favor, faça login novamente.');
              }
              
              console.log('✅ Token refreshed successfully, retrying...');
              retries--;
              continue;
            }
            
            if (isAuthError) {
              console.error('🔒 Authentication error after retry');
              throw new Error('Sessão expirada. Por favor, faça login novamente.');
            }
            
            throw error;
          }
          
          console.log('✅ Undecided analysis completed successfully');
          return data;
        } catch (e: any) {
          if (retries === 1) throw e;
          retries--;
        }
      }
      
      throw new Error('Falha ao analisar após múltiplas tentativas');
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
      
      // 🔥 AGGRESSIVE AUTH ERROR DETECTION
      const authErrorKeywords = ['Unauthorized', 'JWT', 'authorization', '401', 'session', 'token', 'expired', 'Invalid', 'Sessão expirada'];
      const isAuthError = authErrorKeywords.some(keyword => 
        error.message?.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isAuthError) {
        toast({
          title: "Sessão Inválida 🔒",
          description: "Sua sessão está corrompida. Redirecionando para login...",
          variant: "destructive",
        });
        
        // Force immediate logout
        setTimeout(async () => {
          await supabase.auth.signOut();
          window.location.href = '/auth';
        }, 1500);
        return;
      }
      
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

  // Extract unique regions and social networks from analysis data
  const availableRegions = selectedAnalysis?.candidates_comparison
    ? Array.from(new Set(
        candidates
          ?.filter(c => selectedAnalysis.candidates_comparison.some((comp: any) => comp.candidate_id === c.id))
          .map(c => c.region)
          .filter(Boolean)
      )).sort()
    : [];

  const availableSocialNetworks = selectedAnalysis?.social_media_breakdown?.sources
    ? selectedAnalysis.social_media_breakdown.sources.map((s: any) => s.network).sort()
    : [];

  // Filter data based on selected filters
  const getFilteredData = () => {
    if (!selectedAnalysis) return null;

    let filteredAnalysis = { ...selectedAnalysis };

    // Normalize social media breakdown to avoid runtime errors when fields are missing
    const normalizeSource = (s: any) => ({
      network: s?.network ?? 'Outro',
      mentions: Number(s?.mentions ?? 0),
      engagement: Number(s?.engagement ?? 0),
      neutralCount: Number(s?.neutralCount ?? s?.neutral_count ?? 0),
    });

    if (filteredAnalysis.social_media_breakdown?.sources) {
      filteredAnalysis.social_media_breakdown = {
        ...filteredAnalysis.social_media_breakdown,
        sources: filteredAnalysis.social_media_breakdown.sources.map(normalizeSource),
      };
    }

    // Filter social media breakdown
    if (socialNetworkFilter !== "all" && filteredAnalysis.social_media_breakdown?.sources) {
      const filteredSources = filteredAnalysis.social_media_breakdown.sources.filter(
        (s: any) => s.network === socialNetworkFilter
      );
      filteredAnalysis.social_media_breakdown = {
        sources: filteredSources,
        total_mentions: filteredSources.reduce((sum: number, s: any) => sum + Number(s.mentions ?? 0), 0),
        total_engagement: filteredSources.reduce((sum: number, s: any) => sum + Number(s.engagement ?? 0), 0),
        total_neutral: filteredSources.reduce((sum: number, s: any) => sum + Number(s.neutralCount ?? 0), 0),
      };
    }

    // Filter candidates comparison by region
    if (regionFilter !== "all" && filteredAnalysis.candidates_comparison) {
      const candidatesInRegion = candidates?.filter(c => c.region === regionFilter).map(c => c.id) || [];
      filteredAnalysis.candidates_comparison = filteredAnalysis.candidates_comparison.filter(
        (comp: any) => candidatesInRegion.includes(comp.candidate_id)
      );
    }

    return filteredAnalysis;
  };

  const filteredAnalysis = getFilteredData();

  // Generate strategic insights
  const generateInsights = () => {
    if (!filteredAnalysis) return [];

    const insights: { type: 'success' | 'warning' | 'info'; message: string }[] = [];

    // Insight 1: Undecided percentage
    if (filteredAnalysis.undecided_percentage > 30) {
      insights.push({
        type: 'warning',
        message: `Alta taxa de indecisão (${filteredAnalysis.undecided_percentage.toFixed(1)}%) - Grande oportunidade de conversão com estratégias direcionadas.`
      });
    } else if (filteredAnalysis.undecided_percentage < 15) {
      insights.push({
        type: 'success',
        message: `Baixa taxa de indecisão (${filteredAnalysis.undecided_percentage.toFixed(1)}%) - Eleitorado está mais definido.`
      });
    }

    // Insight 2: Volatility
    if (filteredAnalysis.sentiment_fluctuation_score > 70) {
      insights.push({
        type: 'warning',
        message: `Alta volatilidade (${filteredAnalysis.sentiment_fluctuation_score}/100) - Eleitores indecisos mudam de opinião frequentemente. Necessário reforço constante de mensagem.`
      });
    }

    // Insight 3: Top social network
    if (filteredAnalysis.social_media_breakdown?.sources?.length > 0) {
      const topNetwork = [...filteredAnalysis.social_media_breakdown.sources]
        .sort((a: any, b: any) => (b.engagement || b.mentions || 0) - (a.engagement || a.mentions || 0))[0];
      const engagementValue = topNetwork?.engagement || topNetwork?.mentions || 0;
      if (topNetwork?.network && engagementValue > 0) {
        insights.push({
          type: 'info',
          message: `${topNetwork.network} é a rede mais engajada com ${engagementValue.toLocaleString('pt-BR')} interações - Priorize investimento nesta plataforma.`
        });
      }
    }

    // Insight 4: Candidate comparison
    if (filteredAnalysis.candidates_comparison?.length > 1) {
      const topCandidate = [...filteredAnalysis.candidates_comparison]
        .sort((a: any, b: any) => b.positive_percentage - a.positive_percentage)[0];
      const diff = topCandidate.positive_percentage - topCandidate.negative_percentage;
      
      if (diff > 20) {
        insights.push({
          type: 'success',
          message: `${topCandidate.candidate_name} lidera com ${diff.toFixed(1)} pontos de diferença entre intenção positiva e negativa.`
        });
      } else if (diff < 5) {
        insights.push({
          type: 'warning',
          message: `${topCandidate.candidate_name} tem margem pequena (${diff.toFixed(1)} pontos) - Eleição muito disputada entre indecisos.`
        });
      }
    }

    // Insight 5: Key topics
    if (filteredAnalysis.key_topics?.length > 0) {
      insights.push({
        type: 'info',
        message: `Tópicos mais relevantes para indecisos: ${filteredAnalysis.key_topics.slice(0, 3).join(', ')} - Use estes temas em campanhas.`
      });
    }

    return insights;
  };

  const strategicInsights = generateInsights();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <HelpTooltip text="Descubra o que pensa quem ainda não decidiu o voto e como conquistar essas pessoas.">
        <h1 className="text-3xl font-bold mb-2">Análise de Público Indeciso</h1>
      </HelpTooltip>
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
              {/* Region Validation Alert */}
              <RegionValidationAlert 
                candidate={candidates?.find(c => c.id === selectedCandidateId)} 
                analysis={selectedAnalysis} 
              />
              
              {/* Filtros */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Filtros de Análise
                  </CardTitle>
                  <CardDescription>
                    Refine a visualização por região geográfica ou rede social
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="region-filter">Região Geográfica</Label>
                      <Select value={regionFilter} onValueChange={setRegionFilter}>
                        <SelectTrigger id="region-filter" className="bg-background">
                          <SelectValue placeholder="Todas as regiões" />
                        </SelectTrigger>
                        <SelectContent className="bg-card z-50">
                          <SelectItem value="all">Todas as regiões</SelectItem>
                          {availableRegions.map((region) => (
                            <SelectItem key={region} value={region}>
                              {region}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="network-filter">Rede Social</Label>
                      <Select value={socialNetworkFilter} onValueChange={setSocialNetworkFilter}>
                        <SelectTrigger id="network-filter" className="bg-background">
                          <SelectValue placeholder="Todas as redes" />
                        </SelectTrigger>
                        <SelectContent className="bg-card z-50">
                          <SelectItem value="all">Todas as redes</SelectItem>
                          {availableSocialNetworks.map((network) => (
                            <SelectItem key={network} value={network}>
                              {network}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {(regionFilter !== "all" || socialNetworkFilter !== "all") && (
                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRegionFilter("all");
                          setSocialNetworkFilter("all");
                        }}
                      >
                        Limpar Filtros
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        {regionFilter !== "all" && `Região: ${regionFilter}`}
                        {regionFilter !== "all" && socialNetworkFilter !== "all" && " • "}
                        {socialNetworkFilter !== "all" && `Rede: ${socialNetworkFilter}`}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Insights Estratégicos */}
              {strategicInsights.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5" />
                      Insights Estratégicos
                    </CardTitle>
                    <CardDescription>
                      Recomendações baseadas na análise dos dados
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {strategicInsights.map((insight, index) => (
                      <Alert key={index} variant={insight.type === 'warning' ? 'destructive' : 'default'}>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{insight.message}</AlertDescription>
                      </Alert>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* KPIs */}
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Região Analisada</CardTitle>
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {filteredAnalysis.geographic_scope === 'nacional' 
                        ? '🇧🇷 Nacional' 
                        : `📍 ${candidates?.find(c => c.id === selectedCandidateId)?.region || 'N/A'}`}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {filteredAnalysis.geographic_scope === 'nacional'
                        ? 'Dados de todo o Brasil'
                        : 'Dados exclusivos da região'}
                    </p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Eleitores Indecisos</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {filteredAnalysis.undecided_percentage?.toFixed(1)}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {filteredAnalysis.neutral_profiles_count} de {filteredAnalysis.total_profiles_analyzed} perfis
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
                      {filteredAnalysis.sentiment_fluctuation_score}/100
                    </div>
                    <Progress 
                      value={filteredAnalysis.sentiment_fluctuation_score} 
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
                      {filteredAnalysis.confidence_score}/100
                    </div>
                    <Progress 
                      value={filteredAnalysis.confidence_score} 
                      className="mt-2"
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Evolução Temporal da Indecisão */}
              {filteredAnalysis?.temporal_evolution && filteredAnalysis.temporal_evolution.length > 0 && (
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
                      <LineChart data={filteredAnalysis.temporal_evolution}>
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
              {filteredAnalysis?.social_media_breakdown?.sources && filteredAnalysis.social_media_breakdown.sources.length > 0 && (
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
                      <BarChart data={filteredAnalysis.social_media_breakdown.sources}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="network" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip 
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                        />
                        <Legend />
                        <Bar dataKey="mentions" fill="hsl(var(--chart-1))" name="Menções" />
                        <Bar dataKey="engagement" fill="hsl(var(--chart-2))" name="Engajamento" />
                        <Bar dataKey="neutralCount" fill="hsl(var(--chart-3))" name="Neutras" />
                      </BarChart>
                    </ResponsiveContainer>

                    <Table className="mt-4">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rede Social</TableHead>
                          <TableHead className="text-right">Menções</TableHead>
                          <TableHead className="text-right">Engajamento</TableHead>
                          <TableHead className="text-right">Neutras</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAnalysis.social_media_breakdown.sources.map((source: any) => (
                          <TableRow key={source.network}>
                            <TableCell className="font-medium">{source.network}</TableCell>
                            <TableCell className="text-right">{Number(source.mentions ?? 0).toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right">{Number(source.engagement ?? 0).toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="text-right">{Number(source.neutralCount ?? 0).toLocaleString('pt-BR')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t">
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Menções</p>
                        <p className="text-2xl font-bold">{Number(filteredAnalysis.social_media_breakdown.total_mentions ?? 0).toLocaleString('pt-BR')}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Engajamento</p>
                        <p className="text-2xl font-bold">{Number(filteredAnalysis.social_media_breakdown.total_engagement ?? 0).toLocaleString('pt-BR')}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Total Neutras</p>
                        <p className="text-2xl font-bold">{Number(filteredAnalysis.social_media_breakdown.total_neutral ?? 0).toLocaleString('pt-BR')}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Redes</p>
                        <p className="text-2xl font-bold">{Number(filteredAnalysis.social_media_breakdown.sources?.length ?? 0).toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Comparação Entre Candidatos */}
              {filteredAnalysis?.candidates_comparison && filteredAnalysis.candidates_comparison.length > 0 && (
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
                    <ResponsiveContainer width="100%" height={Math.max(300, filteredAnalysis.candidates_comparison.length * 60)}>
                      <BarChart 
                        data={filteredAnalysis.candidates_comparison}
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
                        {filteredAnalysis.candidates_comparison
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
                            <TableCell className="text-right">{Number(candidate.total_mentions ?? 0).toLocaleString('pt-BR')}</TableCell>
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
                      {filteredAnalysis.behavioral_patterns?.map((pattern: any, index: number) => (
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
                    {filteredAnalysis.decision_triggers?.map((trigger: any, index: number) => (
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
                        {filteredAnalysis.demographic_profile?.age_groups?.map((age: string, i: number) => (
                          <Badge key={i} variant="secondary">{age}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Regiões</h4>
                      <div className="flex flex-wrap gap-2">
                        {filteredAnalysis.demographic_profile?.regions?.map((region: string, i: number) => (
                          <Badge key={i} variant="secondary">{region}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Preocupações</h4>
                      <div className="flex flex-wrap gap-2">
                        {filteredAnalysis.demographic_profile?.concerns?.map((concern: string, i: number) => (
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
                    {filteredAnalysis.key_topics?.map((topic: string, index: number) => (
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
                      {filteredAnalysis.persuasion_strategies?.map((strategy: any, index: number) => (
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