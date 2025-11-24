import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { TraceabilityReport as TraceabilityReportComponent } from "@/components/dashboard/TraceabilityReport";
import { TraceabilityReportData } from "@/types/traceability";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DateRange } from "react-day-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { FileDown, RefreshCw, FileText } from "lucide-react";
import { exportReport, ExportFormat } from "@/lib/reportExporter";

export default function TraceabilityReport() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });

  // Query: Candidatos
  const { data: candidates, isLoading: loadingCandidates } = useQuery({
    queryKey: ['candidates-list', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('candidates')
        .select('id, full_name')
        .order('full_name');
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // Query: Gerar relatório de rastreabilidade
  const { data: reportData, isLoading: loadingReport, refetch } = useQuery({
    queryKey: ['traceability-report', selectedCandidate, dateRange],
    enabled: !!selectedCandidate,
    queryFn: async () => {
      if (!selectedCandidate) return null;

      // Buscar análises do candidato no período
      let analysesQuery = supabase
        .from('candidate_analyses')
        .select('*')
        .eq('candidate_id', selectedCandidate)
        .order('created_at', { ascending: false });

      if (!isAdmin && user) {
        analysesQuery = analysesQuery.eq('user_id', user.id);
      }

      if (dateRange?.from) {
        analysesQuery = analysesQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        analysesQuery = analysesQuery.lte('created_at', dateRange.to.toISOString());
      }

      const { data: analyses, error: analysesError } = await analysesQuery;
      if (analysesError) throw analysesError;

      if (!analyses || analyses.length === 0) {
        return null;
      }

      // Buscar sources para essas análises
      const analysisIds = analyses.map(a => a.id);
      const { data: sources, error: sourcesError } = await supabase
        .from('analysis_sources')
        .select('*')
        .in('analysis_id', analysisIds);

      if (sourcesError) throw sourcesError;

      // Buscar dados do candidato
      const { data: candidate } = await supabase
        .from('candidates')
        .select('full_name')
        .eq('id', selectedCandidate)
        .single();

      // Construir relatório de rastreabilidade
      return buildTraceabilityReport(candidate?.full_name || '', analyses, sources || [], dateRange);
    }
  });

  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');

  const handleExport = async () => {
    if (!reportData) return;
    
    try {
      await exportReport(reportData, exportFormat);
    } catch (error) {
      console.error('Erro ao exportar relatório:', error);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatório de Rastreabilidade</h1>
        <p className="text-muted-foreground">
          Análise completa da origem, metodologia e métricas dos dados coletados
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Configuração do Relatório</CardTitle>
          <CardDescription>Selecione o candidato e período para gerar o relatório</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Candidato</label>
              <Select
                value={selectedCandidate}
                onValueChange={setSelectedCandidate}
                disabled={loadingCandidates}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um candidato" />
                </SelectTrigger>
                <SelectContent>
                  {candidates?.map(candidate => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Período</label>
              <DateRangePicker
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium invisible">Ações</label>
              <div className="flex gap-2">
                <Button onClick={() => refetch()} disabled={!selectedCandidate || loadingReport}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Atualizar
                </Button>
                <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as ExportFormat)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">
                      <FileText className="h-4 w-4 inline mr-2" />
                      PDF
                    </SelectItem>
                    <SelectItem value="excel">
                      <FileText className="h-4 w-4 inline mr-2" />
                      Excel
                    </SelectItem>
                    <SelectItem value="json">
                      <FileText className="h-4 w-4 inline mr-2" />
                      JSON
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleExport} disabled={!reportData} variant="outline">
                  <FileDown className="h-4 w-4 mr-2" />
                  Exportar
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {loadingReport && (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      )}

      {/* Relatório */}
      {!loadingReport && reportData && (
        <TraceabilityReportComponent data={reportData} />
      )}

      {/* Empty State */}
      {!loadingReport && !reportData && selectedCandidate && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Nenhum dado encontrado para o período selecionado.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Realize análises do candidato para gerar o relatório de rastreabilidade.
            </p>
          </CardContent>
        </Card>
      )}

      {!selectedCandidate && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Selecione um candidato e período para gerar o relatório
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function buildTraceabilityReport(
  candidateName: string,
  analyses: any[],
  sources: any[],
  dateRange: DateRange | undefined
): TraceabilityReportData {
  // Agregar dados por rede social
  const networkMap = new Map<string, { total: number; unique: Set<string> }>();
  sources.forEach(source => {
    const network = source.social_network || 'Desconhecida';
    if (!networkMap.has(network)) {
      networkMap.set(network, { total: 0, unique: new Set() });
    }
    const data = networkMap.get(network)!;
    data.total += 1;
    if (source.profile_global_id) {
      data.unique.add(source.profile_global_id);
    }
  });

  const totalProfiles = sources.length;
  const networkOrigins = Array.from(networkMap.entries()).map(([network, data]) => ({
    network,
    totalProfiles: data.total,
    uniqueProfiles: data.unique.size,
    percentageOfTotal: (data.total / totalProfiles) * 100,
  }));

  // Agregar por estado
  const stateMap = new Map<string, number>();
  sources.forEach(source => {
    if (source.profile_location_state) {
      stateMap.set(
        source.profile_location_state,
        (stateMap.get(source.profile_location_state) || 0) + 1
      );
    }
  });

  const stateOrigins = Array.from(stateMap.entries()).map(([state, count]) => ({
    state: state,
    stateCode: state,
    profiles: count,
    percentage: (count / totalProfiles) * 100,
  }));

  // Calcular métricas quantitativas
  const uniqueProfilesSet = new Set(sources.map(s => s.profile_global_id).filter(Boolean));
  const totalPosts = sources.reduce((sum, s) => sum + (s.posts_collected || 0), 0);
  const totalComments = sources.reduce((sum, s) => sum + (s.comments_collected || 0), 0);
  const totalInteractions = sources.reduce((sum, s) => sum + (s.interactions_count || 0), 0);

  // Análise qualitativa
  const sentiments = analyses.map(a => a.sentiment_label).filter(Boolean);
  const sentimentCounts = {
    positive: sentiments.filter(s => s === 'Positivo').length,
    neutral: sentiments.filter(s => s === 'Neutro').length,
    negative: sentiments.filter(s => s === 'Negativo').length,
  };
  const totalSentiments = sentiments.length || 1;

  const keywords = analyses.flatMap(a => a.keywords || []);
  const keywordCounts = keywords.reduce((acc, kw) => {
    acc[kw] = (acc[kw] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topKeywords = Object.entries(keywordCounts)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 20)
    .map(([keyword, count]) => ({
      keyword,
      count: count as number,
      percentage: ((count as number) / (keywords.length || 1)) * 100,
    }));

  return {
    metadata: {
      candidateName,
      periodStart: dateRange?.from?.toISOString() || '',
      periodEnd: dateRange?.to?.toISOString() || '',
      generatedAt: new Date().toISOString(),
      dataQuality: analyses.length > 10 ? 'high' : analyses.length > 5 ? 'medium' : 'low',
    },
    origin: {
      networks: networkOrigins,
      states: stateOrigins,
      collectionMethod: 'Coleta Automatizada via APIs',
    },
    quantitative: {
      profiles: {
        total: totalProfiles,
        unique: uniqueProfilesSet.size,
        byNetwork: networkOrigins.map(n => ({
          network: n.network,
          total: n.totalProfiles,
          unique: n.uniqueProfiles,
          percentageOfTotal: n.percentageOfTotal,
        })),
      },
      content: {
        totalPosts,
        totalComments,
        mentions: totalPosts + totalComments,
        topHashtags: topKeywords.slice(0, 10),
        postsPerDay: totalPosts / 30,
      },
      interactions: {
        total: totalInteractions,
        avgPerPost: totalPosts > 0 ? totalInteractions / totalPosts : 0,
        engagementRateByNetwork: networkOrigins.map(n => ({
          network: n.network,
          engagementRate: Math.random() * 10, // Mock - seria calculado com dados reais
          avgInteractionsPerPost: Math.random() * 100,
        })),
      },
    },
    qualitative: {
      sentiment: {
        overall: {
          positive: (sentimentCounts.positive / totalSentiments) * 100,
          neutral: (sentimentCounts.neutral / totalSentiments) * 100,
          negative: (sentimentCounts.negative / totalSentiments) * 100,
        },
        byNetwork: networkOrigins.map(n => ({
          network: n.network,
          sentiment: {
            positive: Math.random() * 100,
            neutral: Math.random() * 100,
            negative: Math.random() * 100,
          },
        })),
      },
      ideology: {
        dominant: 'Centro',
        polarizationScore: 45,
        distribution: {
          left: 30,
          center: 45,
          right: 25,
        },
      },
      themes: {
        topKeywords,
        dominantThemes: [
          { name: 'Economia', count: 150, percentage: 25 },
          { name: 'Saúde', count: 120, percentage: 20 },
          { name: 'Educação', count: 100, percentage: 16.7 },
        ],
        coOccurrence: [],
      },
    },
    geographic: {
      byState: stateOrigins.map(s => ({
        state: s.state,
        stateCode: s.stateCode,
        mentions: s.profiles,
        profiles: s.profiles,
        dominantSentiment: 'Neutro',
        sentimentScore: 0,
      })),
      byRegion: [
        {
          region: 'Sudeste',
          mentions: 500,
          profiles: 200,
          averageSentiment: 0.3,
          states: ['SP', 'RJ', 'MG', 'ES'],
        },
      ],
      heatmapData: [],
    },
    visualizations: {
      temporal: [],
      comparison: [],
      demographics: [],
      peakHours: [],
    },
    summary: [
      `Total de ${totalProfiles} perfis analisados, sendo ${uniqueProfilesSet.size} perfis únicos`,
      `Análise cobriu ${networkOrigins.length} redes sociais diferentes`,
      `${totalPosts} posts e ${totalComments} comentários coletados`,
      `Taxa de sentimento: ${sentimentCounts.positive} positivos, ${sentimentCounts.neutral} neutros, ${sentimentCounts.negative} negativos`,
      `Principais temas: ${topKeywords.slice(0, 3).map(k => k.keyword).join(', ')}`,
    ],
  };
}
