import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { SocialMediaKPIs } from "@/components/dashboard/SocialMediaKPIs";
import { SocialMediaTable } from "@/components/dashboard/SocialMediaTable";
import { SocialMediaCharts } from "@/components/dashboard/SocialMediaCharts";
import { SocialMediaDetailedAnalysis } from "@/components/dashboard/SocialMediaDetailedAnalysis";
import { SocialMediaComparison } from "@/components/dashboard/SocialMediaComparison";
import { SocialMediaTemporalEvolution } from "@/components/dashboard/SocialMediaTemporalEvolution";
import { SocialMediaPeakHours } from "@/components/dashboard/SocialMediaPeakHours";
import { SocialMediaKeywordAnalysis } from "@/components/dashboard/SocialMediaKeywordAnalysis";
import { SocialMediaInfluencers } from "@/components/dashboard/SocialMediaInfluencers";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { fetchAllPaginated } from "@/lib/supabasePagination";
import { isHiddenNetwork } from "@/lib/networkVisibility";

export interface SocialMediaReportData {
  network: string;
  totalMentions: number;
  uniqueProfiles: number;
  totalInteractions: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  positivePercent: number;
  neutralPercent: number;
  negativePercent: number;
  dominantSentiment: "Positivo" | "Negativo" | "Neutro";
}

export default function SocialMediaReport() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });
  const [selectedCandidate, setSelectedCandidate] = useState<string>("all");
  const [selectedNetwork, setSelectedNetwork] = useState<string>("all");

  // Query: Candidatos do usuário
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

  // Query: Dados de redes sociais agregados
  const { data: reportData, isLoading: loadingReport } = useQuery({
    queryKey: ['social-media-report', selectedCandidate, selectedNetwork, dateRange, isAdmin],
    queryFn: async () => {
      // Buscar análises no período
      let analysesQuery = supabase
        .from('candidate_analyses')
        .select('id, candidate_id, sentiment_label')
        .order('created_at', { ascending: false });

      if (!isAdmin && user) {
        analysesQuery = analysesQuery.eq('user_id', user.id);
      }

      if (selectedCandidate !== 'all') {
        analysesQuery = analysesQuery.eq('candidate_id', selectedCandidate);
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
        return [];
      }

      // Buscar sources para essas análises
      const analysisIds = analyses.map(a => a.id);
      let sourcesQuery = supabase
        .from('analysis_sources')
        .select('*')
        .in('analysis_id', analysisIds);

      // Filtrar por rede social se selecionada
      if (selectedNetwork !== 'all') {
        sourcesQuery = sourcesQuery.eq('social_network', selectedNetwork);
      }

      const { data: sources, error: sourcesError } = await sourcesQuery;

      if (sourcesError) throw sourcesError;

      // Agregar dados por rede social
      return aggregateByNetwork(sources || [], analyses);
    }
  });

  function aggregateByNetwork(
    sources: any[],
    analyses: any[]
  ): SocialMediaReportData[] {
    const networkMap: Record<string, any> = {};

    sources.forEach(source => {
      const network = source.social_network || 'Desconhecida';
      const analysis = analyses.find(a => a.id === source.analysis_id);

      if (!networkMap[network]) {
        networkMap[network] = {
          network,
          totalMentions: 0,
          uniqueProfiles: new Set(),
          totalInteractions: 0,
          sentiments: { Positivo: 0, Negativo: 0, Neutro: 0 }
        };
      }

      // Somar menções
      networkMap[network].totalMentions += 
        (source.posts_collected || 0) + (source.comments_collected || 0);
      
      // Adicionar perfil único
      if (source.profile_unique_id) {
        networkMap[network].uniqueProfiles.add(source.profile_unique_id);
      }
      
      // Somar interações
      networkMap[network].totalInteractions += source.interactions_count || 0;

      // Contar sentimento
      if (analysis?.sentiment_label) {
        const sentiment = analysis.sentiment_label;
        if (networkMap[network].sentiments[sentiment] !== undefined) {
          networkMap[network].sentiments[sentiment]++;
        }
      }
    });

    // Converter para array e calcular percentuais
    return Object.values(networkMap).map((data: any) => {
      const total = Object.values(data.sentiments).reduce((a: number, b: any) => a + Number(b), 0) as number;
      const uniqueCount = data.uniqueProfiles.size;
      
      const positiveCount = Number(data.sentiments.Positivo) || 0;
      const neutralCount = Number(data.sentiments.Neutro) || 0;
      const negativeCount = Number(data.sentiments.Negativo) || 0;

      const positivePercent = total > 0 ? (positiveCount / total * 100) : 0;
      const neutralPercent = total > 0 ? (neutralCount / total * 100) : 0;
      const negativePercent = total > 0 ? (negativeCount / total * 100) : 0;

      let dominantSentiment: "Positivo" | "Negativo" | "Neutro" = "Neutro";
      const maxCount = Math.max(positiveCount, neutralCount, negativeCount);
      if (maxCount === positiveCount && positiveCount > 0) dominantSentiment = "Positivo";
      else if (maxCount === negativeCount && negativeCount > 0) dominantSentiment = "Negativo";

      return {
        network: data.network,
        totalMentions: data.totalMentions,
        uniqueProfiles: uniqueCount,
        totalInteractions: data.totalInteractions,
        positiveCount,
        neutralCount,
        negativeCount,
        positivePercent: parseFloat(positivePercent.toFixed(1)),
        neutralPercent: parseFloat(neutralPercent.toFixed(1)),
        negativePercent: parseFloat(negativePercent.toFixed(1)),
        dominantSentiment
      };
    }).sort((a, b) => b.totalMentions - a.totalMentions);
  }

  const isLoading = loadingCandidates || loadingReport;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <HelpTooltip text="Relatório completo de cada rede social: quem fala mais, onde fala e como fala.">
        <h1 className="text-3xl font-bold tracking-tight">Relatório por Rede Social</h1>
      </HelpTooltip>
        <p className="text-muted-foreground">
          Análise detalhada de menções, sentimentos e engajamento por plataforma
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>
            Selecione o candidato e o período para análise
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                  <SelectItem value="all">Todos os candidatos</SelectItem>
                  {candidates?.map(candidate => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Rede Social</label>
              <Select
                value={selectedNetwork}
                onValueChange={setSelectedNetwork}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas as redes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as redes sociais</SelectItem>
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  <SelectItem value="Twitter/X">Twitter/X</SelectItem>
                  <SelectItem value="Facebook">Facebook</SelectItem>
                  <SelectItem value="TikTok">TikTok</SelectItem>
                  <SelectItem value="YouTube">YouTube</SelectItem>
                  
                  <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                  <SelectItem value="Reddit">Reddit</SelectItem>
                  <SelectItem value="Telegram">Telegram</SelectItem>
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
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      )}

      {/* Content */}
      {!isLoading && reportData && (
        <>
          {/* KPIs */}
          <SocialMediaKPIs data={reportData} />

          {/* Tabela Detalhada */}
          <SocialMediaTable data={reportData} />

          {/* Gráficos */}
          <SocialMediaCharts data={reportData} />

          {/* Análise Detalhada por Rede */}
          <SocialMediaDetailedAnalysis data={reportData} />

          {/* Comparação Entre Redes */}
          <SocialMediaComparison data={reportData} />

          {/* Evolução Temporal */}
          <SocialMediaTemporalEvolution 
            selectedCandidate={selectedCandidate}
            dateRange={dateRange}
          />

          {/* Horários de Pico */}
          <SocialMediaPeakHours 
            selectedCandidate={selectedCandidate}
            dateRange={dateRange}
          />

          {/* Análise de Palavras-Chave */}
          <SocialMediaKeywordAnalysis 
            selectedCandidate={selectedCandidate}
            dateRange={dateRange}
          />

          {/* Análise de Influenciadores */}
          <SocialMediaInfluencers 
            selectedCandidate={selectedCandidate}
            dateRange={dateRange}
          />
        </>
      )}

      {/* Empty State */}
      {!isLoading && (!reportData || reportData.length === 0) && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Nenhum dado encontrado para o período selecionado.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Realize análises de candidatos para visualizar o relatório por rede social.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
