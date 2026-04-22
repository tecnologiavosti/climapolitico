import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Users, MessageSquare, AlertCircle, Activity, LayoutDashboard, Download, Loader2, Newspaper } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { toast } from "sonner";
import { ptBR } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";
import { CandidateOverviewPanel } from "@/components/dashboard/CandidateOverviewPanel";
import { useAllCandidateMetrics, CandidateMetrics } from "@/hooks/useCandidateMetrics";

// Componentes temporariamente ocultos da Visão Geral (mantidos para uso futuro)
// import { AIModelsPanel } from "@/components/dashboard/AIModelsPanel";
// import { AIModelAgreementDashboard } from "@/components/dashboard/AIModelAgreementDashboard";

const COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', 'hsl(var(--warning))', 'hsl(var(--muted))'];

export default function Overview() {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [collecting, setCollecting] = useState(false);
  const [collectingNews, setCollectingNews] = useState(false);
  const { isAdmin } = useAdminCheck();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Query: Candidatos (for selector and basic info)
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

  // Auto-recalcula o cache de métricas para todos os candidatos ao montar a página
  // e a cada 2 minutos, garantindo que os KPIs reflitam os dados mais recentes.
  const recalcLockRef = useRef(false);
  useEffect(() => {
    if (!candidates || candidates.length === 0) return;

    const recalcAll = async () => {
      if (recalcLockRef.current) return;
      recalcLockRef.current = true;
      try {
        await Promise.allSettled(
          candidates.map((c) =>
            supabase.functions.invoke('recalculate-candidate-metrics', {
              body: { candidateId: c.id },
            })
          )
        );
        // Invalida queries para puxar o cache atualizado
        qc.invalidateQueries({ queryKey: ['all-candidate-metrics-cache'] });
        qc.invalidateQueries({ queryKey: ['candidate-metrics-cache'] });
      } catch (e) {
        console.warn('Falha ao recalcular métricas:', e);
      } finally {
        recalcLockRef.current = false;
      }
    };

    recalcAll();
    const interval = setInterval(recalcAll, 120000);
    return () => clearInterval(interval);
  }, [candidates, qc]);

  // Realtime: invalida queries quando cache de métricas ou interações sociais mudam
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('overview-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'candidate_metrics_cache' },
        () => {
          qc.invalidateQueries({ queryKey: ['all-candidate-metrics-cache'] });
          qc.invalidateQueries({ queryKey: ['candidate-metrics-cache'] });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'social_interactions' },
        () => {
          qc.invalidateQueries({ queryKey: ['social-interactions-overview'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'candidates' },
        () => {
          qc.invalidateQueries({ queryKey: ['candidates-overview'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  // Query: Métricas agregadas do cache (fonte única de verdade)
  const { data: allMetrics, isLoading: loadingMetrics } = useAllCandidateMetrics();

  // Query: Interações sociais para gráfico temporal (últimos 7 dias)
  // Atualiza a cada 60s para refletir coletas em andamento.
  const { data: socialInteractions, isLoading: loadingInteractions } = useQuery({
    queryKey: ['social-interactions-overview', isAdmin, user?.id],
    queryFn: async () => {
      if (!user) return [];
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let query = supabase
        .from('social_interactions')
        .select('id, candidate_id, sentiment_label, sentiment_score, likes_count, social_network, created_at, comment_author')
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10000);
      if (!isAdmin) query = query.eq('user_id', user.id);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
    staleTime: 30000,
  });

  // Query removida: Análises de fala (não mais exibida na Visão Geral)
  // const { data: speeches, isLoading: loadingSpeeches } = useQuery({...});

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

  // Aggregate metrics from cache (single source of truth)
  const aggregatedMetrics = allMetrics?.reduce(
    (acc, m) => ({
      totalMentions: acc.totalMentions + m.totalMentions,
      uniqueAuthors: acc.uniqueAuthors + m.uniqueAuthors,
      totalEngagement: acc.totalEngagement + m.totalEngagement,
      positiveCount: acc.positiveCount + m.positiveCount,
      neutralCount: acc.neutralCount + m.neutralCount,
      negativeCount: acc.negativeCount + m.negativeCount,
    }),
    { totalMentions: 0, uniqueAuthors: 0, totalEngagement: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0 }
  ) || { totalMentions: 0, uniqueAuthors: 0, totalEngagement: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0 };

  const totalMentions = aggregatedMetrics.totalMentions;
  const uniqueAuthors = aggregatedMetrics.uniqueAuthors;
  const totalCandidates = candidates?.length || 0;
  const totalSentimentItems = aggregatedMetrics.positiveCount + aggregatedMetrics.neutralCount + aggregatedMetrics.negativeCount;
  const avgSentiment = totalSentimentItems > 0
    ? Math.round(((aggregatedMetrics.positiveCount * 100) + (aggregatedMetrics.neutralCount * 50) + (aggregatedMetrics.negativeCount * 0)) / totalSentimentItems)
    : 0;

  // Preparar dados de sentimento por dia (últimos 7 dias) - usando social_interactions
  const sentimentData = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    
    const dayInteractions = socialInteractions?.filter(interaction => {
      const createdAt = new Date(interaction.created_at || '');
      return createdAt >= dayStart && createdAt <= dayEnd;
    }) || [];

    const positive = dayInteractions.filter(i => i.sentiment_label === 'Positivo').length;
    const negative = dayInteractions.filter(i => i.sentiment_label === 'Negativo').length;
    const neutral = dayInteractions.filter(i => i.sentiment_label === 'Neutro').length;

    return {
      name: format(date, 'EEE', { locale: ptBR }),
      positive,
      negative,
      neutral
    };
  });

  // Preparar dados de candidatos (top 5 por menções) — fallback para interactions se cache vazio
  const metricsMap = new Map<string, CandidateMetrics>();
  allMetrics?.forEach(m => metricsMap.set(m.candidateId, m));

  // Fallback: contar menções por candidato a partir de social_interactions
  const interactionsByCandidate: Record<string, { mentions: number; sentSum: number; sentCount: number }> = {};
  socialInteractions?.forEach(i => {
    const cid = i.candidate_id;
    if (!cid) return;
    if (!interactionsByCandidate[cid]) interactionsByCandidate[cid] = { mentions: 0, sentSum: 0, sentCount: 0 };
    interactionsByCandidate[cid].mentions++;
    if (typeof i.sentiment_score === 'number') {
      interactionsByCandidate[cid].sentSum += i.sentiment_score * 100;
      interactionsByCandidate[cid].sentCount++;
    }
  });

  const candidateData = candidates
    ?.map(c => {
      const cached = metricsMap.get(c.id);
      const fallback = interactionsByCandidate[c.id];
      const mentions = cached?.totalMentions || fallback?.mentions || 0;
      const sentiment = cached?.averageSentiment
        || (fallback && fallback.sentCount > 0 ? Math.round(fallback.sentSum / fallback.sentCount) : 0);
      return { name: c.full_name, mentions, sentiment };
    })
    .filter(d => d.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 5) || [];

  // Normaliza nomes de rede social (banco usa 'google_news', UI exibe 'Google News')
  const normalizeNetwork = (n: string): string => {
    const map: Record<string, string> = {
      'google_news': 'Google News',
      'googlenews': 'Google News',
      'youtube': 'YouTube',
      'twitter': 'Twitter/X',
      'x': 'Twitter/X',
      'reddit': 'Reddit',
      'telegram': 'Telegram',
      'instagram': 'Instagram',
      'facebook': 'Facebook',
      'tiktok': 'TikTok',
      'linkedin': 'LinkedIn',
      'threads': 'Threads',
      'wikipedia': 'Wikipedia',
    };
    return map[n?.toLowerCase?.()] || n || 'Outro';
  };

  // Distribuição por rede social (cache + fallback para social_interactions)
  const networkCount: Record<string, number> = {};
  allMetrics?.forEach(m => {
    m.networkBreakdown.forEach(nb => {
      const key = normalizeNetwork(nb.network);
      networkCount[key] = (networkCount[key] || 0) + nb.mentions;
    });
  });
  // Fallback: se cache vazio, agregar de social_interactions
  if (Object.keys(networkCount).length === 0) {
    socialInteractions?.forEach(i => {
      const net = normalizeNetwork(i.social_network || 'Outro');
      networkCount[net] = (networkCount[net] || 0) + 1;
    });
  }

  const NETWORK_COLORS: Record<string, string> = {
    'YouTube': '#FF0000',
    'Twitter': '#6B7280',
    'Twitter/X': '#6B7280',
    'X': '#6B7280',
    'Reddit': '#FF4500',
    'Telegram': '#0088CC',
    'Instagram': '#E4405F',
    'Facebook': '#1877F2',
    'TikTok': '#1F2937',
    'LinkedIn': '#0A66C2',
    'Threads': '#1F2937',
    'Wikipedia': '#636363',
    'Google News': '#22C55E',
  };

  const networkData = Object.entries(networkCount).map(([name, value], index) => ({
    name,
    value,
    color: NETWORK_COLORS[name] || COLORS[index % COLORS.length]
  })).filter(d => d.value > 0);

  const isLoading = loadingCandidates || loadingInteractions || loadingRankings || loadingMetrics;

  const handleCollectAll = async () => {
    if (!candidates || candidates.length === 0) {
      toast.error("Adicione candidatos antes de coletar dados.");
      return;
    }
    setCollecting(true);
    const t = toast.loading(`Iniciando coleta para ${candidates.length} candidato(s)...`);
    const sources = [
      { fn: 'search-youtube-mentions', label: 'YouTube' },
      { fn: 'search-twitter-mentions', label: 'Twitter/X' },
      { fn: 'search-google-news', label: 'Google News' },
      { fn: 'search-wikipedia', label: 'Wikipedia' },
      { fn: 'search-reddit-mentions', label: 'Reddit' },
      { fn: 'search-telegram-mentions', label: 'Telegram' },
    ];
    const totalJobs = candidates.length * sources.length;
    let dispatched = 0;
    for (const c of candidates) {
      for (const src of sources) {
        const body: Record<string, unknown> = { candidateId: c.id, candidateName: c.full_name };
        if (src.fn === 'search-youtube-mentions') {
          body.maxVideos = 8;
          body.maxCommentsPerVideo = 30;
          body.maxNewComments = 80;
        }
        if (src.fn === 'search-twitter-mentions') {
          body.maxTweets = 200;
          body.maxPages = 4;
        }
        supabase.functions.invoke(src.fn, { body })
          .catch((e) => console.warn(`${src.label} (${c.full_name}):`, e));
        dispatched++;
      }
    }
    toast.dismiss(t);
    // Notificação de conclusão que some em 5s
    toast.success(
      `Coleta concluída! ${dispatched}/${totalJobs} jobs enviados em background. Os dados aparecerão em poucos minutos.`,
      { duration: 5000 }
    );
    setTimeout(() => qc.invalidateQueries(), 30000);
    setCollecting(false);
  };

  // Coleta manual focada apenas em Google News (RSS oficial, sem API key)
  const handleCollectGoogleNews = async () => {
    if (!candidates || candidates.length === 0) {
      toast.error("Adicione candidatos antes de coletar notícias.");
      return;
    }
    setCollectingNews(true);
    const t = toast.loading(`Coletando notícias do Google News para ${candidates.length} candidato(s)...`);
    try {
      // Dispara a edge function global que itera sobre todos candidatos ativos
      const { error } = await supabase.functions.invoke('google-news-collector', { body: {} });
      if (error) throw error;
      toast.dismiss(t);
      toast.success(
        `Coleta do Google News iniciada em background. As notícias aparecerão em poucos minutos.`,
        { duration: 5000 }
      );
      setTimeout(() => qc.invalidateQueries(), 20000);
    } catch (e) {
      toast.dismiss(t);
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      toast.error(`Falha ao iniciar coleta do Google News: ${msg}`);
    } finally {
      setCollectingNews(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              Coleta global de dados
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Aciona a coleta automática em todas as redes sociais (YouTube, Twitter/X, Google News, Reddit, Telegram, Wikipedia) para todos os seus candidatos.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleCollectGoogleNews}
              disabled={collectingNews || !candidates?.length}
              variant="outline"
              size="lg"
              className="border-green-500/50 text-green-600 hover:bg-green-500/10 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            >
              {collectingNews ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Coletando notícias...</>
              ) : (
                <><Newspaper className="mr-2 h-4 w-4" /> Coletar Google News</>
              )}
            </Button>
            <Button onClick={handleCollectAll} disabled={collecting || !candidates?.length} size="lg">
              {collecting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Coletando...</>) : (<><Download className="mr-2 h-4 w-4" /> Coletar tudo</>)}
            </Button>
          </div>
        </div>
      </Card>

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
                <span>{uniqueAuthors} autores únicos</span>
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
              <p className="text-sm text-muted-foreground">Engajamento Total</p>
              {isLoading ? (
                <Skeleton className="h-10 w-16 mt-2" />
              ) : (
                <p className="text-3xl font-bold mt-2">{aggregatedMetrics.totalEngagement.toLocaleString('pt-BR')}</p>
              )}
              <div className="flex items-center gap-1 mt-2 text-muted-foreground text-sm">
                <Activity className="h-4 w-4" />
                <span>curtidas</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>
      </div>

      {/* Componentes de IA temporariamente ocultos da Visão Geral */}
      {/* <AIModelsPanel /> */}
      {/* <AIModelAgreementDashboard /> */}

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

        {/* Network Distribution */}
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-bold">Distribuição por Rede Social</h3>
            <p className="text-sm text-muted-foreground">Fontes de dados reais</p>
          </div>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : networkData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <p>Nenhum dado coletado ainda</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={networkData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {networkData.map((entry, index) => (
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
