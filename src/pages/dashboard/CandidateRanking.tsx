import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Trophy, TrendingUp, TrendingDown, Users, MessageSquare, Heart, Youtube, Clock
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { HelpTooltip } from "@/components/ui/help-tooltip";

// Cores para gráficos
const CHART_COLORS = {
  mentions: 'hsl(var(--primary))',
  authors: 'hsl(var(--chart-2))',
  sentiment: 'hsl(var(--success))',
  engagement: 'hsl(var(--warning))',
};

// Interface para ranking calculado
interface CandidateRankingData {
  candidateId: string;
  candidateName: string;
  party: string | null;
  region: string | null;
  totalMentions: number;
  uniqueAuthors: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  averageSentiment: number;
  totalEngagement: number;
  overallScore: number;
  rankPosition: number;
}

/**
 * Fórmula do Score Geral (0-100):
 * Cada métrica entra com peso TOTAL (100%) — média simples das 4 dimensões normalizadas.
 * - Menções normalizadas: 100%
 * - Autores únicos normalizados: 100%
 * - Sentimento médio: 100%
 * - Engajamento normalizado: 100%
 */
function calculateOverallScore(
  mentions: number,
  maxMentions: number,
  authors: number,
  maxAuthors: number,
  sentiment: number,
  engagement: number,
  maxEngagement: number
): number {
  const mentionsScore = maxMentions > 0 ? (mentions / maxMentions) * 100 : 0;
  const authorsScore = maxAuthors > 0 ? (authors / maxAuthors) * 100 : 0;
  const sentimentScore = sentiment; // Já é 0-100
  const engagementScore = maxEngagement > 0 ? (engagement / maxEngagement) * 100 : 0;

  // Cada métrica contribui integralmente (100%); média final mantém escala 0-100.
  return Math.round((mentionsScore + authorsScore + sentimentScore + engagementScore) / 4);
}

export default function CandidateRanking() {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });

  // Query: Buscar candidatos do usuário
  const { data: candidates, isLoading: loadingCandidates } = useQuery({
    queryKey: ['ranking-candidates', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name, party, region')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Query: Buscar interações reais do período (paginado para evitar limite de 1000 linhas)
  const { data: interactions, isLoading: loadingInteractions } = useQuery({
    queryKey: ['ranking-interactions', dateRange, user?.id],
    queryFn: async () => {
      if (!user || !dateRange?.from || !dateRange?.to) return [];

      const endDate = new Date(dateRange.to);
      endDate.setDate(endDate.getDate() + 1);

      // Filtra pela data real do comentário (original_posted_at) com fallback para created_at
      const orFilter = `and(original_posted_at.gte.${dateRange.from.toISOString()},original_posted_at.lt.${endDate.toISOString()}),and(original_posted_at.is.null,created_at.gte.${dateRange.from.toISOString()},created_at.lt.${endDate.toISOString()})`;

      const PAGE_SIZE = 1000;
      const MAX_ROWS = 200000;
      const all: any[] = [];
      let offset = 0;
      while (offset < MAX_ROWS) {
        const { data, error } = await supabase
          .from('social_interactions')
          .select('candidate_id, sentiment_label, sentiment_score, likes_count, comment_author')
          .eq('user_id', user.id)
          .not('social_network', 'in', '(mastodon,lemmy)')
          .or(orFilter)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      return all;
    },
    enabled: !!user && !!dateRange?.from && !!dateRange?.to,
  });

  // Calcular ranking automaticamente a partir dos dados reais
  const rankings = useMemo<CandidateRankingData[]>(() => {
    if (!candidates || !interactions) return [];

    // Agregar métricas por candidato
    const metricsMap = new Map<string, {
      totalMentions: number;
      authors: Set<string>;
      positiveCount: number;
      negativeCount: number;
      neutralCount: number;
      totalEngagement: number;
      sentimentSum: number;
    }>();

    // Inicializar para todos os candidatos
    candidates.forEach(c => {
      metricsMap.set(c.id, {
        totalMentions: 0,
        authors: new Set(),
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        totalEngagement: 0,
        sentimentSum: 0,
      });
    });

    // Agregar interações
    interactions.forEach(i => {
      const metrics = metricsMap.get(i.candidate_id);
      if (!metrics) return;

      metrics.totalMentions++;
      if (i.comment_author) metrics.authors.add(i.comment_author);
      metrics.totalEngagement += i.likes_count || 0;

      if (i.sentiment_label === 'Positivo') {
        metrics.positiveCount++;
        metrics.sentimentSum += 100;
      } else if (i.sentiment_label === 'Negativo') {
        metrics.negativeCount++;
        metrics.sentimentSum += 0;
      } else {
        metrics.neutralCount++;
        metrics.sentimentSum += 50;
      }
    });

    // Calcular valores máximos para normalização
    let maxMentions = 0;
    let maxAuthors = 0;
    let maxEngagement = 0;

    metricsMap.forEach(m => {
      if (m.totalMentions > maxMentions) maxMentions = m.totalMentions;
      if (m.authors.size > maxAuthors) maxAuthors = m.authors.size;
      if (m.totalEngagement > maxEngagement) maxEngagement = m.totalEngagement;
    });

    // Construir array de ranking
    const rankingData: CandidateRankingData[] = [];

    candidates.forEach(c => {
      const metrics = metricsMap.get(c.id);
      if (!metrics) return;

      const uniqueAuthors = metrics.authors.size;
      const averageSentiment = metrics.totalMentions > 0
        ? Math.round(metrics.sentimentSum / metrics.totalMentions)
        : 50;

      const overallScore = calculateOverallScore(
        metrics.totalMentions,
        maxMentions,
        uniqueAuthors,
        maxAuthors,
        averageSentiment,
        metrics.totalEngagement,
        maxEngagement
      );

      rankingData.push({
        candidateId: c.id,
        candidateName: c.full_name,
        party: c.party,
        region: c.region,
        totalMentions: metrics.totalMentions,
        uniqueAuthors,
        positiveCount: metrics.positiveCount,
        negativeCount: metrics.negativeCount,
        neutralCount: metrics.neutralCount,
        averageSentiment,
        totalEngagement: metrics.totalEngagement,
        overallScore,
        rankPosition: 0, // Será preenchido abaixo
      });
    });

    // Ordenar por score geral (decrescente)
    rankingData.sort((a, b) => b.overallScore - a.overallScore);

    // Atribuir posições
    rankingData.forEach((r, i) => {
      r.rankPosition = i + 1;
    });

    return rankingData;
  }, [candidates, interactions]);

  // Preparar dados para gráfico de barras
  const barChartData = rankings.slice(0, 10).map(r => ({
    name: r.candidateName.split(' ')[0],
    Menções: r.totalMentions,
    Autores: r.uniqueAuthors,
    Engajamento: r.totalEngagement,
  }));

  // Preparar dados para gráfico de sentimento
  const sentimentChartData = rankings.slice(0, 10).map(r => ({
    name: r.candidateName.split(' ')[0],
    Positivo: r.positiveCount,
    Neutro: r.neutralCount,
    Negativo: r.negativeCount,
  }));

  // Top candidate
  const topCandidate = rankings[0];

  // Get date range text
  const dateRangeText = dateRange?.from && dateRange?.to
    ? `${dateRange.from.toLocaleDateString('pt-BR')} - ${dateRange.to.toLocaleDateString('pt-BR')}`
    : 'Período não selecionado';

  const isLoading = loadingCandidates || loadingInteractions;
  const totalInteractions = interactions?.length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <HelpTooltip text="Quem está ganhando e quem está perdendo nas redes nos últimos 30 dias.">
        <h1 className="text-3xl font-bold flex items-center gap-2">
            <Trophy className="h-8 w-8 text-yellow-500" />
            Ranking de Candidatos
          </h1>
      </HelpTooltip>
          <p className="text-muted-foreground">
            Comparativo automático baseado em dados reais do YouTube
          </p>
        </div>
        <Badge variant="outline" className="flex items-center gap-2">
          <Youtube className="h-4 w-4 text-destructive" />
          Fonte: YouTube
        </Badge>
      </div>

      <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />

      {/* Period Info */}
      <Card className="bg-muted/30">
        <CardContent className="py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Período: <strong>{dateRangeText}</strong></span>
            <span className="mx-2">•</span>
            <span>{totalInteractions.toLocaleString('pt-BR')} comentários analisados</span>
            <span className="mx-2">•</span>
            <span>{rankings.length} candidatos ranqueados</span>
          </div>
        </CardContent>
      </Card>

      {/* Insights Cards */}
      {rankings.length > 0 && topCandidate && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <HelpTooltip text="Quem está em primeiro lugar no ranking geral.">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  Líder do Ranking
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">{topCandidate.candidateName}</div>
                <p className="text-xs text-muted-foreground">
                  Score: {topCandidate.overallScore}
                </p>
              </CardContent>
            </Card>
          </HelpTooltip>

          <HelpTooltip text="Quem teve mais comentários sobre ele no período.">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  Mais Mencionado
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const most = [...rankings].sort((a, b) => b.totalMentions - a.totalMentions)[0];
                  return (
                    <>
                      <div className="text-xl font-bold">{most?.candidateName}</div>
                      <p className="text-xs text-muted-foreground">
                        {most?.totalMentions.toLocaleString('pt-BR')} menções
                      </p>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </HelpTooltip>

          <HelpTooltip text="Quem o povo mais elogiou no período.">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-success" />
                  Melhor Sentimento
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const best = [...rankings].filter(r => r.totalMentions > 0).sort((a, b) => b.averageSentiment - a.averageSentiment)[0];
                  return best ? (
                    <>
                      <div className="text-xl font-bold">{best.candidateName}</div>
                      <p className="text-xs text-success">
                        {best.averageSentiment}% positivo
                      </p>
                    </>
                  ) : (
                    <div className="text-muted-foreground">N/A</div>
                  );
                })()}
              </CardContent>
            </Card>
          </HelpTooltip>

          <HelpTooltip text="Quem mais teve curtidas, respostas e compartilhamentos.">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Heart className="w-4 h-4 text-pink-500" />
                  Maior Engajamento
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const top = [...rankings].sort((a, b) => b.totalEngagement - a.totalEngagement)[0];
                  return (
                    <>
                      <div className="text-xl font-bold">{top?.candidateName}</div>
                      <p className="text-xs text-muted-foreground">
                        {top?.totalEngagement.toLocaleString('pt-BR')} curtidas
                      </p>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </HelpTooltip>
        </div>
      )}

      {/* Ranking Table */}
      <Card>
        <CardHeader>
          <HelpTooltip text="Tabela completa: cada candidato com sua nota e os números que entram no cálculo.">
            <CardTitle>Ranking Geral</CardTitle>
          </HelpTooltip>
          <CardDescription>
            Score calculado automaticamente: 100% menções + 100% autores + 100% sentimento + 100% engajamento
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rankings.length === 0 ? (
            <div className="text-center py-12">
              <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Nenhum dado encontrado para este período.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Colete comentários do YouTube para seus candidatos primeiro.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Pos.</TableHead>
                  <TableHead>Candidato</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Menções</TableHead>
                  <TableHead className="text-right">Autores</TableHead>
                  <TableHead className="text-right">Sentimento</TableHead>
                  <TableHead className="text-right">Engajamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankings.map((rank) => (
                  <TableRow key={rank.candidateId}>
                    <TableCell>
                      <Badge variant={rank.rankPosition <= 3 ? "default" : "secondary"}>
                        #{rank.rankPosition}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{rank.candidateName}</div>
                        <div className="text-sm text-muted-foreground">
                          {rank.party || 'Sem partido'} • {rank.region || 'Sem região'}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={rank.overallScore} className="w-16 h-2" />
                        <span className="font-bold w-8">{rank.overallScore}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <MessageSquare className="h-3 w-3 text-muted-foreground" />
                        {rank.totalMentions.toLocaleString('pt-BR')}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Users className="h-3 w-3 text-muted-foreground" />
                        {rank.uniqueAuthors.toLocaleString('pt-BR')}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={
                        rank.averageSentiment >= 60 ? 'default' :
                        rank.averageSentiment <= 40 ? 'destructive' :
                        'secondary'
                      }>
                        {rank.averageSentiment}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Heart className="h-3 w-3 text-muted-foreground" />
                        {rank.totalEngagement.toLocaleString('pt-BR')}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Charts */}
      {rankings.length > 0 && (
        <Tabs defaultValue="metrics" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="metrics">Comparação por Métrica</TabsTrigger>
            <TabsTrigger value="sentiment">Distribuição de Sentimento</TabsTrigger>
          </TabsList>

          <TabsContent value="metrics">
            <Card>
              <CardHeader>
                <CardTitle>Comparação Direta - Top 10</CardTitle>
                <CardDescription>
                  Compare candidatos lado a lado em cada dimensão
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={barChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="Menções" fill="hsl(var(--primary))" />
                    <Bar dataKey="Autores" fill="hsl(var(--chart-2))" />
                    <Bar dataKey="Engajamento" fill="hsl(var(--warning))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sentiment">
            <Card>
              <CardHeader>
                <CardTitle>Distribuição de Sentimento - Top 10</CardTitle>
                <CardDescription>
                  Compare a proporção de comentários positivos, neutros e negativos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={sentimentChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="Positivo" stackId="a" fill="hsl(var(--success))" />
                    <Bar dataKey="Neutro" stackId="a" fill="hsl(var(--warning))" />
                    <Bar dataKey="Negativo" stackId="a" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Formula Explanation */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Trophy className="h-4 w-4 mt-0.5 text-yellow-500" />
            <div>
              <p className="font-medium text-foreground">Fórmula do Score Geral</p>
              <p className="mt-1">
                O ranking é calculado automaticamente a partir dos comentários reais coletados.
                A fórmula do score combina: <strong>100% volume de menções</strong> + <strong>100% diversidade de autores</strong> + 
                <strong>100% sentimento médio</strong> + <strong>100% engajamento (curtidas)</strong>.
                Cada dimensão entra com peso integral e o score final é a média das 4 métricas normalizadas (escala 0-100).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}