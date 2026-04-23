import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Users, MessageSquare, AlertCircle, Activity, LayoutDashboard, Download, Loader2 } from "lucide-react";
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
  const [calculatingRanking, setCalculatingRanking] = useState(false);
  const { isAdmin } = useAdminCheck();
  const { user } = useAuth();
  const qc = useQueryClient();

  const handleCalculateRanking = async () => {
    setCalculatingRanking(true);
    const t = toast.loading("Calculando rankings dos últimos 30 dias...");
    try {
      const period_end = new Date().toISOString();
      const period_start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase.functions.invoke('calculate-ranking', {
        body: { period_start, period_end },
      });
      if (error) throw error;
      toast.dismiss(t);
      toast.success(`Ranking calculado! ${data?.rankings?.length ?? data?.count ?? ''} candidatos processados.`);
      qc.invalidateQueries({ queryKey: ['rankings-overview'] });
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(`Falha ao calcular ranking: ${e.message || e}`);
    } finally {
      setCalculatingRanking(false);
    }
  };

  // Query: Candidatos (for selector and basic info)
  // IMPORTANTE: filtra status='active' para bater EXATAMENTE com a aba Ranking
  const { data: candidates, isLoading: loadingCandidates } = useQuery({
    queryKey: ['candidates-overview', isAdmin, user?.id],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, full_name, mentions, sentiment, party, region, status')
        .eq('status', 'active');
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
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
      // Pagina em lotes de 1000 (limite padrão do Supabase) para garantir
      // que TODAS as interações dos últimos 7 dias sejam carregadas, mesmo
      // quando o volume passa de dezenas de milhares.
      const PAGE_SIZE = 1000;
      const MAX_ROWS = 100000; // teto de segurança
      const all: any[] = [];
      let from = 0;
      while (from < MAX_ROWS) {
        let query = supabase
          .from('social_interactions')
          .select('id, candidate_id, sentiment_label, sentiment_score, likes_count, social_network, created_at, original_posted_at, comment_author')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (!isAdmin) query = query.eq('user_id', user.id);
        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return all;
    },
    enabled: !!user,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
    staleTime: 30000,
  });

  // Query removida: Análises de fala (não mais exibida na Visão Geral)
  // const { data: speeches, isLoading: loadingSpeeches } = useQuery({...});

  // Query: Rankings calculados em tempo real (últimos 30 dias)
  // Usa exatamente a mesma fórmula da página "Ranking de Candidatos"
  // (30% menções + 20% autores + 30% sentimento + 20% engajamento)
  // para garantir consistência entre Visão Geral e a aba de Ranking.
  const { data: rankingInteractions, isLoading: loadingRankings } = useQuery({
    queryKey: ['rankings-overview-interactions', isAdmin, user?.id],
    queryFn: async () => {
      if (!user) return [];
      // Mesma janela usada por padrão na aba Ranking:
      // from = hoje - 30 dias (sem zerar horas), to = hoje + 1 dia (exclusivo via .lt)
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const to = new Date();
      to.setDate(to.getDate() + 1);
      const PAGE_SIZE = 1000;
      const MAX_ROWS = 100000;
      const all: any[] = [];
      let offset = 0;
      while (offset < MAX_ROWS) {
        let q = supabase
          .from('social_interactions')
          .select('candidate_id, sentiment_label, sentiment_score, likes_count, comment_author')
          .gte('created_at', from.toISOString())
          .lt('created_at', to.toISOString())
          .range(offset, offset + PAGE_SIZE - 1);
        if (!isAdmin) q = q.eq('user_id', user.id);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      return all;
    },
    enabled: !!user,
    staleTime: 60000,
  });

  // Calcula ranking com a mesma fórmula da página Ranking
  const rankings = (() => {
    if (!candidates || !rankingInteractions) return [] as Array<{ id: string; candidate_id: string; overall_score: number; rank_change: number; candidates: { full_name: string } }>;
    const map = new Map<string, { mentions: number; authors: Set<string>; engagement: number; sentSum: number }>();
    candidates.forEach((c: any) => map.set(c.id, { mentions: 0, authors: new Set(), engagement: 0, sentSum: 0 }));
    rankingInteractions.forEach((i: any) => {
      const m = map.get(i.candidate_id);
      if (!m) return;
      m.mentions++;
      if (i.comment_author) m.authors.add(i.comment_author);
      m.engagement += i.likes_count || 0;
      const lbl = (i.sentiment_label || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (lbl.startsWith('pos')) m.sentSum += 100;
      else if (lbl.startsWith('neg')) m.sentSum += 0;
      else m.sentSum += 50;
    });
    let maxM = 0, maxA = 0, maxE = 0;
    map.forEach(m => { if (m.mentions > maxM) maxM = m.mentions; if (m.authors.size > maxA) maxA = m.authors.size; if (m.engagement > maxE) maxE = m.engagement; });
    const arr = candidates.map((c: any) => {
      const m = map.get(c.id)!;
      const avgSent = m.mentions > 0 ? m.sentSum / m.mentions : 50;
      const mScore = maxM > 0 ? (m.mentions / maxM) * 100 : 0;
      const aScore = maxA > 0 ? (m.authors.size / maxA) * 100 : 0;
      const eScore = maxE > 0 ? (m.engagement / maxE) * 100 : 0;
      const overall = Math.round(mScore * 0.3 + aScore * 0.2 + avgSent * 0.3 + eScore * 0.2);
      return { id: c.id, candidate_id: c.id, overall_score: overall, rank_change: 0, candidates: { full_name: c.full_name } };
    });
    arr.sort((a, b) => b.overall_score - a.overall_score);
    return arr;
  })();

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

  // Preparar dados de sentimento por dia (últimos 7 dias)
  // Usa created_at (data de coleta) para garantir que toda interação coletada
  // nos últimos 7 dias apareça no gráfico, independentemente de quando foi postada.
  // Normaliza labels (case-insensitive + acentos) para não perder linhas com
  // variações como "positivo", "POSITIVO", "Positive", etc.
  const normalizeSentiment = (label?: string | null, score?: number | null): 'positive' | 'negative' | 'neutral' | null => {
    if (label) {
      const l = label
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      if (l.startsWith('pos')) return 'positive';
      if (l.startsWith('neg')) return 'negative';
      if (l.startsWith('neu')) return 'neutral';
    }
    if (typeof score === 'number') {
      if (score >= 0.6) return 'positive';
      if (score <= 0.4) return 'negative';
      return 'neutral';
    }
    return null;
  };

  const sentimentData = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    let positive = 0, negative = 0, neutral = 0;
    socialInteractions?.forEach(interaction => {
      const d = new Date(interaction.created_at || '');
      if (isNaN(d.getTime()) || d < dayStart || d > dayEnd) return;
      const s = normalizeSentiment(interaction.sentiment_label, interaction.sentiment_score as number | null);
      if (s === 'positive') positive++;
      else if (s === 'negative') negative++;
      else if (s === 'neutral') neutral++;
    });

    return {
      name: format(date, 'EEE dd/MM', { locale: ptBR }),
      positive,
      negative,
      neutral,
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
      'tik_tok': 'TikTok',
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
    'TikTok': '#000000',
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
      { fn: 'tiktok-collector', label: 'TikTok' },
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
            <ResponsiveContainer width="100%" height={340}>
              <PieChart>
                <Pie
                  data={networkData}
                  cx="50%"
                  cy="42%"
                  labelLine={false}
                  label={false}
                  outerRadius={90}
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
                  formatter={(value: number, name: string) => {
                    const total = networkData.reduce((s, d) => s + d.value, 0);
                    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                    return [`${value.toLocaleString('pt-BR')} (${pct}%)`, name];
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={64}
                  iconSize={10}
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px', lineHeight: '20px' }}
                  formatter={(value: string) => {
                    const item = networkData.find(d => d.name === value);
                    const total = networkData.reduce((s, d) => s + d.value, 0);
                    const pct = item && total > 0 ? ((item.value / total) * 100).toFixed(0) : '0';
                    return `${value} (${pct}%)`;
                  }}
                />
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
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-bold">Rankings Recentes</h3>
            <p className="text-sm text-muted-foreground">Mesma fórmula da aba Ranking · últimos 30 dias</p>
          </div>
          <Button
            onClick={handleCalculateRanking}
            disabled={calculatingRanking || !candidates?.length}
            size="sm"
          >
            {calculatingRanking ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Calculando...</>
            ) : (
              <><Activity className="mr-2 h-4 w-4" /> Calcular ranking</>
            )}
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : rankings && rankings.length > 0 ? (
          <div className="space-y-3">
            {(() => {
              // Deduplica por nome do candidato (case-insensitive, sem acentos), mantendo o de maior score
              const norm = (s: string) => (s || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();
              const bestByName = new Map<string, typeof rankings[number]>();
              for (const r of rankings) {
                const name = norm(((r.candidates as any)?.full_name) || '');
                if (!name) continue;
                const existing = bestByName.get(name);
                if (!existing || (r.overall_score ?? 0) > (existing.overall_score ?? 0)) {
                  bestByName.set(name, r);
                }
              }
              const unique = Array.from(bestByName.values())
                .sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0))
                .slice(0, 5);

              return unique.map((rank, idx) => {
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
                        {idx + 1}
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
              });
            })()}
          </div>
        ) : (
          <div className="h-40 flex flex-col items-center justify-center text-center text-muted-foreground p-6 gap-3">
            <AlertCircle className="h-8 w-8 opacity-50" />
            <p>Nenhum ranking disponível</p>
            <Button
              onClick={handleCalculateRanking}
              disabled={calculatingRanking || !candidates?.length}
              size="sm"
              variant="outline"
            >
              {calculatingRanking ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Calculando...</>
              ) : (
                <><Activity className="mr-2 h-4 w-4" /> Calcular ranking agora</>
              )}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
