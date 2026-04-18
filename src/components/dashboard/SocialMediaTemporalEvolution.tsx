import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { TrendingUp, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { DateRange } from "react-day-picker";
import { Skeleton } from "@/components/ui/skeleton";

interface SocialMediaTemporalEvolutionProps {
  selectedCandidate: string;
  dateRange: DateRange | undefined;
}

interface TemporalData {
  date: string;
  mentions: number;
  sentimentScore: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
}

const NETWORK_COLORS: Record<string, string> = {
  'Instagram': 'hsl(330, 80%, 55%)',
  'Twitter/X': 'hsl(203, 89%, 53%)',
  'Facebook': 'hsl(221, 44%, 41%)',
  'TikTok': 'hsl(0, 0%, 0%)',
  'YouTube': 'hsl(0, 100%, 50%)',
  'Threads': 'hsl(0, 0%, 20%)',
  'LinkedIn': 'hsl(201, 100%, 35%)',
  'Reddit': 'hsl(16, 100%, 50%)',
  'Outro': 'hsl(0, 0%, 42%)',
};

export const SocialMediaTemporalEvolution = ({ 
  selectedCandidate, 
  dateRange 
}: SocialMediaTemporalEvolutionProps) => {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selectedNetwork, setSelectedNetwork] = useState<string>("all");

  const { data: temporalData, isLoading } = useQuery({
    queryKey: ['social-media-temporal', selectedCandidate, selectedNetwork, dateRange, isAdmin],
    queryFn: async () => {
      // Buscar análises no período
      let analysesQuery = supabase
        .from('candidate_analyses')
        .select('id, created_at, sentiment_score, sentiment_label')
        .order('created_at', { ascending: true });

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
        return { networks: [], temporalDataByNetwork: {} };
      }

      // Buscar sources
      const analysisIds = analyses.map(a => a.id);
      let sourcesQuery = supabase
        .from('analysis_sources')
        .select('*')
        .in('analysis_id', analysisIds);

      if (selectedNetwork !== 'all') {
        sourcesQuery = sourcesQuery.eq('social_network', selectedNetwork);
      }

      const { data: sources, error: sourcesError } = await sourcesQuery;
      if (sourcesError) throw sourcesError;

      // Agrupar por rede social e data
      const networkMap: Record<string, Record<string, TemporalData>> = {};
      const networksSet = new Set<string>();

      sources?.forEach(source => {
        const network = source.social_network || 'Outro';
        networksSet.add(network);

        const analysis = analyses.find(a => a.id === source.analysis_id);
        if (!analysis) return;

        const date = new Date(source.created_at || analysis.created_at).toLocaleDateString('pt-BR');

        if (!networkMap[network]) {
          networkMap[network] = {};
        }

        if (!networkMap[network][date]) {
          networkMap[network][date] = {
            date,
            mentions: 0,
            sentimentScore: 0,
            positiveCount: 0,
            neutralCount: 0,
            negativeCount: 0,
          };
        }

        const mentions = (source.posts_collected || 0) + (source.comments_collected || 0);
        networkMap[network][date].mentions += mentions;

        // Contar sentimentos
        const sentiment = analysis.sentiment_label;
        if (sentiment === 'Positivo') {
          networkMap[network][date].positiveCount++;
        } else if (sentiment === 'Neutro') {
          networkMap[network][date].neutralCount++;
        } else if (sentiment === 'Negativo') {
          networkMap[network][date].negativeCount++;
        }

        // Calcular score médio
        if (analysis.sentiment_score) {
          networkMap[network][date].sentimentScore += Number(analysis.sentiment_score);
        }
      });

      // Converter para array e calcular médias
      const temporalDataByNetwork: Record<string, TemporalData[]> = {};
      
      Object.entries(networkMap).forEach(([network, dateMap]) => {
        temporalDataByNetwork[network] = Object.values(dateMap)
          .map(data => {
            const totalSentiments = data.positiveCount + data.neutralCount + data.negativeCount;
            return {
              ...data,
              sentimentScore: totalSentiments > 0 ? data.sentimentScore / totalSentiments : 0,
            };
          })
          .sort((a, b) => {
            const dateA = new Date(a.date.split('/').reverse().join('-'));
            const dateB = new Date(b.date.split('/').reverse().join('-'));
            return dateA.getTime() - dateB.getTime();
          });
      });

      return {
        networks: Array.from(networksSet).sort(),
        temporalDataByNetwork,
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

  if (!temporalData || temporalData.networks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Evolução Temporal por Rede Social</CardTitle>
          <CardDescription>Crescimento de menções e mudanças de sentimento ao longo do tempo</CardDescription>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Dados insuficientes para análise temporal no período selecionado
          </p>
        </CardContent>
      </Card>
    );
  }

  const availableNetworks = selectedNetwork === 'all' 
    ? temporalData.networks 
    : [selectedNetwork];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Evolução Temporal por Rede Social</h2>
        <p className="text-muted-foreground">
          Acompanhe o crescimento de menções e mudanças de sentimento ao longo do tempo
        </p>
      </div>

      {/* Filtro de Rede */}
      <Card>
        <CardHeader>
          <CardTitle>Selecionar Rede Social</CardTitle>
          <CardDescription>Escolha uma rede específica ou visualize todas</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedNetwork} onValueChange={setSelectedNetwork}>
            <SelectTrigger className="w-full md:w-[300px]">
              <SelectValue placeholder="Todas as redes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as redes sociais</SelectItem>
              {temporalData.networks.map(network => (
                <SelectItem key={network} value={network}>
                  {network}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Gráficos por Rede */}
      {selectedNetwork === 'all' ? (
        // Mostrar todas as redes em grid
        <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
          {availableNetworks.map(network => {
            const data = temporalData.temporalDataByNetwork[network] || [];
            const color = NETWORK_COLORS[network] || 'hsl(var(--primary))';

            return (
              <Card key={network}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span>{network}</span>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardTitle>
                  <CardDescription>
                    {data.length} pontos de dados no período
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="mentions" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="mentions">Menções</TabsTrigger>
                      <TabsTrigger value="sentiment">Sentimento</TabsTrigger>
                    </TabsList>

                    <TabsContent value="mentions" className="mt-4">
                      <ChartContainer
                        config={{
                          mentions: {
                            label: "Menções",
                            color: color,
                          },
                        }}
                        className="h-[250px]"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis 
                              dataKey="date" 
                              tick={{ fontSize: 11 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Area 
                              type="monotone" 
                              dataKey="mentions" 
                              stroke={color}
                              fill={color}
                              fillOpacity={0.3}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </TabsContent>

                    <TabsContent value="sentiment" className="mt-4">
                      <ChartContainer
                        config={{
                          sentimentScore: {
                            label: "Score de Sentimento",
                            color: color,
                          },
                        }}
                        className="h-[250px]"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis 
                              dataKey="date" 
                              tick={{ fontSize: 11 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis domain={[0, 100]} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Line 
                              type="monotone" 
                              dataKey="sentimentScore" 
                              stroke={color}
                              strokeWidth={2}
                              dot={{ r: 4 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        // Mostrar rede selecionada em detalhe
        <div className="space-y-6">
          {availableNetworks.map(network => {
            const data = temporalData.temporalDataByNetwork[network] || [];
            const color = NETWORK_COLORS[network] || 'hsl(var(--primary))';

            return (
              <div key={network} className="space-y-6">
                {/* Gráfico de Menções */}
                <Card>
                  <CardHeader>
                    <CardTitle>Evolução de Menções - {network}</CardTitle>
                    <CardDescription>
                      Crescimento do volume de menções ao longo do tempo
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        mentions: {
                          label: "Menções",
                          color: color,
                        },
                      }}
                      className="h-[350px]"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 12 }}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                          />
                          <YAxis />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Legend />
                          <Area 
                            type="monotone" 
                            dataKey="mentions" 
                            stroke={color}
                            fill={color}
                            fillOpacity={0.4}
                            name="Menções"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Gráfico de Sentimento */}
                <Card>
                  <CardHeader>
                    <CardTitle>Evolução de Sentimento - {network}</CardTitle>
                    <CardDescription>
                      Mudanças no score de sentimento ao longo do tempo (0-100)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        sentimentScore: {
                          label: "Score de Sentimento",
                          color: color,
                        },
                      }}
                      className="h-[350px]"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 12 }}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                          />
                          <YAxis domain={[0, 100]} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="sentimentScore" 
                            stroke={color}
                            strokeWidth={3}
                            dot={{ r: 5 }}
                            name="Score de Sentimento"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Gráfico de Distribuição de Sentimentos */}
                <Card>
                  <CardHeader>
                    <CardTitle>Distribuição de Sentimentos - {network}</CardTitle>
                    <CardDescription>
                      Evolução da quantidade de menções por tipo de sentimento
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        positiveCount: {
                          label: "Positivo",
                          color: "hsl(142, 76%, 36%)",
                        },
                        neutralCount: {
                          label: "Neutro",
                          color: "hsl(48, 96%, 53%)",
                        },
                        negativeCount: {
                          label: "Negativo",
                          color: "hsl(0, 84%, 60%)",
                        },
                      }}
                      className="h-[350px]"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 12 }}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                          />
                          <YAxis />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Legend />
                          <Area 
                            type="monotone" 
                            dataKey="positiveCount" 
                            stackId="1"
                            stroke="hsl(142, 76%, 36%)"
                            fill="hsl(142, 76%, 36%)"
                            name="Positivo"
                          />
                          <Area 
                            type="monotone" 
                            dataKey="neutralCount" 
                            stackId="1"
                            stroke="hsl(48, 96%, 53%)"
                            fill="hsl(48, 96%, 53%)"
                            name="Neutro"
                          />
                          <Area 
                            type="monotone" 
                            dataKey="negativeCount" 
                            stackId="1"
                            stroke="hsl(0, 84%, 60%)"
                            fill="hsl(0, 84%, 60%)"
                            name="Negativo"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
