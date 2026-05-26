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

  // Query: agregados por rede a partir de social_interactions (SSOT)
  const { data: reportData, isLoading: loadingReport } = useQuery({
    queryKey: ['social-media-report-v2', selectedCandidate, selectedNetwork, dateRange, isAdmin, user?.id],
    queryFn: async () => {
      const rows = await fetchAllPaginated<any>((from, to) => {
        let q = supabase
          .from('social_interactions')
          .select('social_network, sentiment_label, comment_author, author_profile_url, likes_count, replies_count, shares_count, created_at')
          .not('social_network', 'in', '(mastodon,lemmy,pinterest,gdelt)');

        if (!isAdmin && user) q = q.eq('user_id', user.id);
        if (selectedCandidate !== 'all') q = q.eq('candidate_id', selectedCandidate);
        if (selectedNetwork !== 'all') q = q.eq('social_network', selectedNetwork);
        if (dateRange?.from) q = q.gte('created_at', dateRange.from.toISOString());
        if (dateRange?.to) q = q.lte('created_at', dateRange.to.toISOString());

        return q.range(from, to);
      });

      return aggregateByNetwork(rows);
    },
    enabled: !!user,
  });

  function aggregateByNetwork(rows: any[]): SocialMediaReportData[] {
    const networkMap: Record<string, any> = {};

    rows.forEach((r) => {
      const network = r.social_network || 'Desconhecida';
      if (isHiddenNetwork(network)) return;

      if (!networkMap[network]) {
        networkMap[network] = {
          network,
          totalMentions: 0,
          uniqueProfiles: new Set<string>(),
          totalInteractions: 0,
          sentiments: { Positivo: 0, Negativo: 0, Neutro: 0 },
        };
      }

      const bucket = networkMap[network];
      bucket.totalMentions += 1;
      const profileKey = r.author_profile_url || r.comment_author;
      if (profileKey) bucket.uniqueProfiles.add(String(profileKey).toLowerCase());
      bucket.totalInteractions += (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0);

      const s = r.sentiment_label;
      if (s === 'Positivo' || s === 'Negativo' || s === 'Neutro') {
        bucket.sentiments[s]++;
      }
    });

    return Object.values(networkMap).map((data: any) => {
      const positiveCount = data.sentiments.Positivo;
      const neutralCount = data.sentiments.Neutro;
      const negativeCount = data.sentiments.Negativo;
      const total = positiveCount + neutralCount + negativeCount;

      const positivePercent = total > 0 ? (positiveCount / total) * 100 : 0;
      const neutralPercent = total > 0 ? (neutralCount / total) * 100 : 0;
      const negativePercent = total > 0 ? (negativeCount / total) * 100 : 0;

      let dominantSentiment: "Positivo" | "Negativo" | "Neutro" = "Neutro";
      const maxCount = Math.max(positiveCount, neutralCount, negativeCount);
      if (maxCount === positiveCount && positiveCount > 0) dominantSentiment = "Positivo";
      else if (maxCount === negativeCount && negativeCount > 0) dominantSentiment = "Negativo";

      return {
        network: data.network,
        totalMentions: data.totalMentions,
        uniqueProfiles: data.uniqueProfiles.size,
        totalInteractions: data.totalInteractions,
        positiveCount,
        neutralCount,
        negativeCount,
        positivePercent: parseFloat(positivePercent.toFixed(1)),
        neutralPercent: parseFloat(neutralPercent.toFixed(1)),
        negativePercent: parseFloat(negativePercent.toFixed(1)),
        dominantSentiment,
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
