import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Hash, TrendingUp, Award, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { DateRange } from "react-day-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface SocialMediaKeywordAnalysisProps {
  selectedCandidate: string;
  dateRange: DateRange | undefined;
}

interface KeywordData {
  keyword: string;
  count: number;
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
  };
  networks: string[];
}

const SENTIMENT_COLORS = {
  positive: 'hsl(142, 76%, 36%)',
  neutral: 'hsl(48, 96%, 53%)',
  negative: 'hsl(0, 84%, 60%)',
};

export const SocialMediaKeywordAnalysis = ({ 
  selectedCandidate, 
  dateRange 
}: SocialMediaKeywordAnalysisProps) => {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selectedNetwork, setSelectedNetwork] = useState<string>("all");
  const [limit, setLimit] = useState<number>(20);

  const { data: keywordData, isLoading } = useQuery({
    queryKey: ['social-media-keywords', selectedCandidate, selectedNetwork, dateRange, isAdmin, limit],
    queryFn: async () => {
      // Buscar análises no período com keywords
      let analysesQuery = supabase
        .from('candidate_analyses')
        .select('id, keywords, sentiment_label')
        .not('keywords', 'is', null)
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
        return { networks: [], keywords: [], topKeywords: [] };
      }

      // Buscar sources para identificar redes sociais
      const analysisIds = analyses.map(a => a.id);
      let sourcesQuery = supabase
        .from('analysis_sources')
        .select('analysis_id, social_network')
        .in('analysis_id', analysisIds);

      if (selectedNetwork !== 'all') {
        sourcesQuery = sourcesQuery.eq('social_network', selectedNetwork);
      }

      const { data: sources, error: sourcesError } = await sourcesQuery;
      if (sourcesError) throw sourcesError;

      // Criar mapa de análise -> redes sociais
      const analysisNetworkMap: Record<string, Set<string>> = {};
      const networksSet = new Set<string>();

      sources?.forEach(source => {
        const network = source.social_network || 'Outro';
        networksSet.add(network);

        if (!analysisNetworkMap[source.analysis_id]) {
          analysisNetworkMap[source.analysis_id] = new Set();
        }
        analysisNetworkMap[source.analysis_id].add(network);
      });

      // Agrupar keywords
      const keywordMap: Record<string, {
        count: number;
        sentiment: { positive: number; neutral: number; negative: number };
        networks: Set<string>;
      }> = {};

      analyses.forEach(analysis => {
        // Pular se não tem redes associadas (filtrado)
        if (!analysisNetworkMap[analysis.id]) return;

        const keywords = analysis.keywords as string[];
        const sentiment = analysis.sentiment_label?.toLowerCase() || 'neutral';
        const networks = analysisNetworkMap[analysis.id];

        keywords?.forEach(keyword => {
          const normalizedKeyword = keyword.toLowerCase().trim();
          
          if (!keywordMap[normalizedKeyword]) {
            keywordMap[normalizedKeyword] = {
              count: 0,
              sentiment: { positive: 0, neutral: 0, negative: 0 },
              networks: new Set(),
            };
          }

          keywordMap[normalizedKeyword].count++;
          
          // Contar sentimento
          if (sentiment === 'positivo') {
            keywordMap[normalizedKeyword].sentiment.positive++;
          } else if (sentiment === 'negativo') {
            keywordMap[normalizedKeyword].sentiment.negative++;
          } else {
            keywordMap[normalizedKeyword].sentiment.neutral++;
          }

          // Adicionar redes
          networks.forEach(network => {
            keywordMap[normalizedKeyword].networks.add(network);
          });
        });
      });

      // Converter para array e ordenar
      const keywords: KeywordData[] = Object.entries(keywordMap)
        .map(([keyword, data]) => ({
          keyword,
          count: data.count,
          sentiment: data.sentiment,
          networks: Array.from(data.networks),
        }))
        .sort((a, b) => b.count - a.count);

      const topKeywords = keywords.slice(0, limit);

      return {
        networks: Array.from(networksSet).sort(),
        keywords,
        topKeywords,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!keywordData || keywordData.keywords.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Análise de Palavras-Chave e Hashtags</CardTitle>
          <CardDescription>Tópicos mais mencionados nas redes sociais</CardDescription>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <Hash className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Nenhuma palavra-chave encontrada no período selecionado
          </p>
        </CardContent>
      </Card>
    );
  }

  const getDominantSentiment = (sentiment: KeywordData['sentiment']) => {
    const total = sentiment.positive + sentiment.neutral + sentiment.negative;
    if (total === 0) return 'neutral';
    
    const positivePercent = (sentiment.positive / total) * 100;
    const negativePercent = (sentiment.negative / total) * 100;
    
    if (positivePercent > 50) return 'positive';
    if (negativePercent > 50) return 'negative';
    return 'neutral';
  };

  const getSentimentColor = (dominant: string) => {
    if (dominant === 'positive') return SENTIMENT_COLORS.positive;
    if (dominant === 'negative') return SENTIMENT_COLORS.negative;
    return SENTIMENT_COLORS.neutral;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Análise de Palavras-Chave e Hashtags</h2>
        <p className="text-muted-foreground">
          Identifique os tópicos e termos mais mencionados nas redes sociais
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros de Análise</CardTitle>
          <CardDescription>Personalize a visualização de palavras-chave</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Rede Social</label>
              <Select value={selectedNetwork} onValueChange={setSelectedNetwork}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as redes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as redes sociais</SelectItem>
                  {keywordData.networks.map(network => (
                    <SelectItem key={network} value={network}>
                      {network}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Número de Palavras-Chave</label>
              <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Top 10</SelectItem>
                  <SelectItem value="20">Top 20</SelectItem>
                  <SelectItem value="30">Top 30</SelectItem>
                  <SelectItem value="50">Top 50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top 3 Keywords */}
      <div className="grid gap-4 md:grid-cols-3">
        {keywordData.topKeywords.slice(0, 3).map((keyword, index) => {
          const dominant = getDominantSentiment(keyword.sentiment);
          const color = getSentimentColor(dominant);
          const icons = [Award, TrendingUp, Hash];
          const Icon = icons[index] || Hash;

          return (
            <Card key={keyword.keyword} className="border-2" style={{ borderColor: color }}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div 
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: color, opacity: 0.9 }}
                  >
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-base">#{index + 1} Mais Mencionada</CardTitle>
                    <CardDescription className="text-xs">
                      {keyword.count} menções
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold truncate" title={keyword.keyword}>
                  {keyword.keyword}
                </p>
                <div className="flex flex-wrap gap-1">
                  {keyword.networks.map(network => (
                    <Badge key={network} variant="outline" className="text-xs">
                      {network}
                    </Badge>
                  ))}
                </div>
                <div className="pt-2 text-xs text-muted-foreground">
                  Sentimento: <span className="font-semibold" style={{ color }}>
                    {dominant === 'positive' ? 'Positivo' : dominant === 'negative' ? 'Negativo' : 'Neutro'}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Gráfico de Barras */}
      <Card>
        <CardHeader>
          <CardTitle>Top Palavras-Chave por Frequência</CardTitle>
          <CardDescription>
            {selectedNetwork === 'all' 
              ? 'Palavras-chave mais mencionadas em todas as redes' 
              : `Palavras-chave mais mencionadas em ${selectedNetwork}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              count: {
                label: "Menções",
                color: "hsl(var(--primary))",
              },
            }}
            className="h-[400px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={keywordData.topKeywords}
                layout="vertical"
                margin={{ left: 100 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis 
                  dataKey="keyword" 
                  type="category" 
                  width={100}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip 
                  content={<ChartTooltipContent />}
                  cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }}
                />
                <Bar dataKey="count" name="Menções" radius={[0, 4, 4, 0]}>
                  {keywordData.topKeywords.map((entry, index) => {
                    const dominant = getDominantSentiment(entry.sentiment);
                    const color = getSentimentColor(dominant);
                    return <Cell key={`cell-${index}`} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Tabela Detalhada */}
      <Card>
        <CardHeader>
          <CardTitle>Análise Detalhada de Palavras-Chave</CardTitle>
          <CardDescription>
            Frequência, sentimento e redes sociais onde cada termo aparece
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 font-semibold">#</th>
                  <th className="text-left p-3 font-semibold">Palavra-Chave</th>
                  <th className="text-center p-3 font-semibold">Menções</th>
                  <th className="text-center p-3 font-semibold">Positivo</th>
                  <th className="text-center p-3 font-semibold">Neutro</th>
                  <th className="text-center p-3 font-semibold">Negativo</th>
                  <th className="text-left p-3 font-semibold">Redes Sociais</th>
                  <th className="text-center p-3 font-semibold">Sentimento</th>
                </tr>
              </thead>
              <tbody>
                {keywordData.topKeywords.map((keyword, index) => {
                  const dominant = getDominantSentiment(keyword.sentiment);
                  const color = getSentimentColor(dominant);
                  const total = keyword.sentiment.positive + keyword.sentiment.neutral + keyword.sentiment.negative;

                  return (
                    <tr key={keyword.keyword} className="border-b hover:bg-muted/50">
                      <td className="p-3 font-medium text-muted-foreground">
                        {index + 1}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Search className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{keyword.keyword}</span>
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <Badge variant="secondary">
                          {keyword.count}
                        </Badge>
                      </td>
                      <td className="text-center p-3 text-green-600 font-medium">
                        {keyword.sentiment.positive} 
                        {total > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({((keyword.sentiment.positive / total) * 100).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="text-center p-3 text-yellow-600 font-medium">
                        {keyword.sentiment.neutral}
                        {total > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({((keyword.sentiment.neutral / total) * 100).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="text-center p-3 text-red-600 font-medium">
                        {keyword.sentiment.negative}
                        {total > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({((keyword.sentiment.negative / total) * 100).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {keyword.networks.map(network => (
                            <Badge key={network} variant="outline" className="text-xs">
                              {network}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <Badge 
                          style={{ 
                            backgroundColor: color,
                            color: 'white',
                            border: 'none'
                          }}
                        >
                          {dominant === 'positive' ? 'Positivo' : 
                           dominant === 'negative' ? 'Negativo' : 'Neutro'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Estatísticas Gerais */}
      <Card>
        <CardHeader>
          <CardTitle>Estatísticas Gerais</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Total de Palavras-Chave</p>
              <p className="text-2xl font-bold">{keywordData.keywords.length}</p>
            </div>
            
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Total de Menções</p>
              <p className="text-2xl font-bold">
                {keywordData.keywords.reduce((sum, k) => sum + k.count, 0).toLocaleString()}
              </p>
            </div>
            
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Redes Analisadas</p>
              <p className="text-2xl font-bold">{keywordData.networks.length}</p>
            </div>
            
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Palavra Mais Popular</p>
              <p className="text-lg font-bold truncate" title={keywordData.topKeywords[0]?.keyword}>
                {keywordData.topKeywords[0]?.keyword || 'N/A'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
