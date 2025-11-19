import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Clock, TrendingUp, Calendar, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { DateRange } from "react-day-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface SocialMediaPeakHoursProps {
  selectedCandidate: string;
  dateRange: DateRange | undefined;
}

interface HourData {
  hour: string;
  mentions: number;
  interactions: number;
  engagementRate: number;
}

interface DayData {
  day: string;
  mentions: number;
  interactions: number;
  engagementRate: number;
}

const DAYS_OF_WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const HOUR_COLORS = [
  'hsl(220, 70%, 50%)', 'hsl(210, 70%, 50%)', 'hsl(200, 70%, 50%)',
  'hsl(190, 70%, 50%)', 'hsl(180, 70%, 50%)', 'hsl(170, 70%, 50%)',
  'hsl(160, 70%, 50%)', 'hsl(150, 70%, 50%)', 'hsl(140, 70%, 50%)',
  'hsl(130, 70%, 50%)', 'hsl(120, 70%, 50%)', 'hsl(110, 70%, 50%)',
  'hsl(100, 70%, 50%)', 'hsl(90, 70%, 50%)', 'hsl(80, 70%, 50%)',
  'hsl(70, 70%, 50%)', 'hsl(60, 70%, 50%)', 'hsl(50, 70%, 50%)',
  'hsl(40, 70%, 50%)', 'hsl(30, 70%, 50%)', 'hsl(20, 70%, 50%)',
  'hsl(10, 70%, 50%)', 'hsl(0, 70%, 50%)', 'hsl(350, 70%, 50%)',
];

export const SocialMediaPeakHours = ({ 
  selectedCandidate, 
  dateRange 
}: SocialMediaPeakHoursProps) => {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selectedNetwork, setSelectedNetwork] = useState<string>("all");

  const { data: peakData, isLoading } = useQuery({
    queryKey: ['social-media-peak-hours', selectedCandidate, selectedNetwork, dateRange, isAdmin],
    queryFn: async () => {
      // Buscar análises no período
      let analysesQuery = supabase
        .from('candidate_analyses')
        .select('id, created_at')
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
        return { networks: [], hourlyData: {}, dailyData: {}, recommendations: {} };
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

      // Agrupar por rede social, hora e dia da semana
      const networkMap: Record<string, {
        hourly: Record<number, { mentions: number; interactions: number }>;
        daily: Record<number, { mentions: number; interactions: number }>;
      }> = {};
      
      const networksSet = new Set<string>();

      sources?.forEach(source => {
        const network = source.social_network || 'Outro';
        networksSet.add(network);

        if (!networkMap[network]) {
          networkMap[network] = {
            hourly: {},
            daily: {},
          };
        }

        // Usar collection_date se disponível, senão created_at
        const timestamp = new Date(source.collection_date || source.created_at);
        const hour = timestamp.getHours();
        const day = timestamp.getDay(); // 0-6 (Domingo-Sábado)

        const mentions = (source.posts_collected || 0) + (source.comments_collected || 0);
        const interactions = source.interactions_count || 0;

        // Agrupar por hora
        if (!networkMap[network].hourly[hour]) {
          networkMap[network].hourly[hour] = { mentions: 0, interactions: 0 };
        }
        networkMap[network].hourly[hour].mentions += mentions;
        networkMap[network].hourly[hour].interactions += interactions;

        // Agrupar por dia da semana
        if (!networkMap[network].daily[day]) {
          networkMap[network].daily[day] = { mentions: 0, interactions: 0 };
        }
        networkMap[network].daily[day].mentions += mentions;
        networkMap[network].daily[day].interactions += interactions;
      });

      // Converter para arrays formatados
      const hourlyData: Record<string, HourData[]> = {};
      const dailyData: Record<string, DayData[]> = {};
      const recommendations: Record<string, {
        bestHours: string[];
        bestDays: string[];
        peakEngagementHour: string;
        peakEngagementDay: string;
      }> = {};

      Object.entries(networkMap).forEach(([network, data]) => {
        // Dados por hora
        hourlyData[network] = Array.from({ length: 24 }, (_, hour) => {
          const hourData = data.hourly[hour] || { mentions: 0, interactions: 0 };
          const engagementRate = hourData.mentions > 0 
            ? (hourData.interactions / hourData.mentions) 
            : 0;
          
          return {
            hour: `${hour.toString().padStart(2, '0')}:00`,
            mentions: hourData.mentions,
            interactions: hourData.interactions,
            engagementRate: parseFloat(engagementRate.toFixed(2)),
          };
        });

        // Dados por dia da semana
        dailyData[network] = Array.from({ length: 7 }, (_, day) => {
          const dayData = data.daily[day] || { mentions: 0, interactions: 0 };
          const engagementRate = dayData.mentions > 0 
            ? (dayData.interactions / dayData.mentions) 
            : 0;
          
          return {
            day: DAYS_OF_WEEK[day],
            mentions: dayData.mentions,
            interactions: dayData.interactions,
            engagementRate: parseFloat(engagementRate.toFixed(2)),
          };
        });

        // Recomendações
        const topHours = hourlyData[network]
          .filter(h => h.mentions > 0)
          .sort((a, b) => b.engagementRate - a.engagementRate)
          .slice(0, 3);

        const topDays = dailyData[network]
          .filter(d => d.mentions > 0)
          .sort((a, b) => b.engagementRate - a.engagementRate)
          .slice(0, 3);

        recommendations[network] = {
          bestHours: topHours.map(h => h.hour),
          bestDays: topDays.map(d => d.day),
          peakEngagementHour: topHours[0]?.hour || 'N/A',
          peakEngagementDay: topDays[0]?.day || 'N/A',
        };
      });

      return {
        networks: Array.from(networksSet).sort(),
        hourlyData,
        dailyData,
        recommendations,
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

  if (!peakData || peakData.networks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Horários de Pico de Engajamento</CardTitle>
          <CardDescription>Melhores momentos para publicação em cada rede social</CardDescription>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Dados insuficientes para análise de horários no período selecionado
          </p>
        </CardContent>
      </Card>
    );
  }

  const availableNetworks = selectedNetwork === 'all' 
    ? peakData.networks 
    : [selectedNetwork];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Horários de Pico de Engajamento</h2>
        <p className="text-muted-foreground">
          Identifique os melhores momentos para publicação em cada rede social
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
              {peakData.networks.map(network => (
                <SelectItem key={network} value={network}>
                  {network}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Aviso sobre limitações dos dados */}
      <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                Nota sobre os dados
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                A análise é baseada nos horários de coleta e análise dos dados. Para resultados mais precisos, 
                recomendamos realizar coletas distribuídas ao longo do dia.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Análise por Rede */}
      {availableNetworks.map(network => {
        const hourlyData = peakData.hourlyData[network] || [];
        const dailyData = peakData.dailyData[network] || [];
        const recommendations = peakData.recommendations[network];

        if (!recommendations) return null;

        // Calcular intensidade de cor baseada no engajamento
        const maxEngagement = Math.max(...hourlyData.map(h => h.engagementRate));

        return (
          <div key={network} className="space-y-6">
            {/* Recomendações */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Melhores Horários - {network}
                </CardTitle>
                <CardDescription>
                  Recomendações baseadas em análise de engajamento
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Melhor Horário */}
                  <div className="space-y-3 p-4 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />
                      <h4 className="font-semibold">Horário de Pico</h4>
                    </div>
                    <p className="text-3xl font-bold text-primary">
                      {recommendations.peakEngagementHour}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Maior taxa de engajamento detectada
                    </p>
                    
                    <div className="pt-2 border-t">
                      <p className="text-xs font-medium mb-2">Top 3 Horários:</p>
                      <div className="flex flex-wrap gap-2">
                        {recommendations.bestHours.map((hour, idx) => (
                          <Badge key={idx} variant="secondary">
                            {hour}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Melhor Dia */}
                  <div className="space-y-3 p-4 rounded-lg bg-gradient-to-br from-chart-2/10 to-chart-2/5 border border-chart-2/20">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" style={{ color: 'hsl(var(--chart-2))' }} />
                      <h4 className="font-semibold">Melhor Dia</h4>
                    </div>
                    <p className="text-3xl font-bold" style={{ color: 'hsl(var(--chart-2))' }}>
                      {recommendations.peakEngagementDay}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Dia com melhor performance
                    </p>
                    
                    <div className="pt-2 border-t">
                      <p className="text-xs font-medium mb-2">Top 3 Dias:</p>
                      <div className="flex flex-wrap gap-2">
                        {recommendations.bestDays.map((day, idx) => (
                          <Badge key={idx} variant="outline">
                            {day}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Gráfico por Hora */}
            <Card>
              <CardHeader>
                <CardTitle>Engajamento por Hora do Dia - {network}</CardTitle>
                <CardDescription>
                  Taxa de engajamento (interações por menção) em cada hora
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    engagementRate: {
                      label: "Taxa de Engajamento",
                      color: "hsl(var(--primary))",
                    },
                  }}
                  className="h-[350px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="hour" 
                        tick={{ fontSize: 11 }}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis />
                      <ChartTooltip 
                        content={<ChartTooltipContent />}
                        cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }}
                      />
                      <Legend />
                      <Bar 
                        dataKey="engagementRate" 
                        name="Taxa de Engajamento"
                        radius={[4, 4, 0, 0]}
                      >
                        {hourlyData.map((entry, index) => {
                          const intensity = maxEngagement > 0 
                            ? entry.engagementRate / maxEngagement 
                            : 0;
                          const color = `hsl(${120 * intensity}, 70%, 50%)`;
                          return <Cell key={`cell-${index}`} fill={color} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Gráfico por Dia da Semana */}
            <Card>
              <CardHeader>
                <CardTitle>Engajamento por Dia da Semana - {network}</CardTitle>
                <CardDescription>
                  Taxa de engajamento média por dia da semana
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    engagementRate: {
                      label: "Taxa de Engajamento",
                      color: "hsl(var(--chart-2))",
                    },
                  }}
                  className="h-[300px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar 
                        dataKey="engagementRate" 
                        fill="hsl(var(--chart-2))"
                        name="Taxa de Engajamento"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Tabela Detalhada por Hora */}
            <Card>
              <CardHeader>
                <CardTitle>Detalhamento por Hora - {network}</CardTitle>
                <CardDescription>
                  Menções, interações e taxa de engajamento para cada horário
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-semibold">Horário</th>
                        <th className="text-right p-2 font-semibold">Menções</th>
                        <th className="text-right p-2 font-semibold">Interações</th>
                        <th className="text-right p-2 font-semibold">Taxa Engajamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourlyData
                        .filter(h => h.mentions > 0)
                        .sort((a, b) => b.engagementRate - a.engagementRate)
                        .map((hour, idx) => (
                          <tr key={idx} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-medium">{hour.hour}</td>
                            <td className="text-right p-2">{hour.mentions.toLocaleString()}</td>
                            <td className="text-right p-2">{hour.interactions.toLocaleString()}</td>
                            <td className="text-right p-2">
                              <Badge variant={hour.engagementRate > 1 ? "default" : "secondary"}>
                                {hour.engagementRate.toFixed(2)}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
};
