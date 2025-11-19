import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, MessageSquare, FileCheck } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";

export default function Analytics() {
  const { isAdmin } = useAdminCheck();
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });

  const { data: analyses, isLoading } = useQuery({
    queryKey: ['analytics', dateRange, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('candidate_analyses')
        .select('*, candidates(full_name, party)')
        .order('created_at', { ascending: true });

      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }

      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Calculate KPIs
  const averageSentiment = analyses?.length
    ? (analyses.reduce((sum, a) => sum + (Number(a.sentiment_score) || 0), 0) / analyses.length).toFixed(1)
    : "0";

  const totalMentions = analyses?.reduce((sum, a) => sum + (a.mentions_count || 0), 0) || 0;
  const totalAnalyses = analyses?.length || 0;

  const positiveCount = analyses?.filter(a => Number(a.sentiment_score) > 60).length || 0;
  const negativeCount = analyses?.filter(a => Number(a.sentiment_score) < 40).length || 0;
  const generalTrend = positiveCount > negativeCount ? "positive" : negativeCount > positiveCount ? "negative" : "neutral";

  // Social Network Distribution
  const socialNetworkData = analyses?.reduce((acc: Record<string, number>, analysis) => {
    const network = analysis.social_network || 'Outro';
    acc[network] = (acc[network] || 0) + 1;
    return acc;
  }, {});

  const socialNetworkChartData = socialNetworkData
    ? Object.entries(socialNetworkData).map(([name, value]) => ({
        name,
        value,
      }))
    : [];

  const SOCIAL_COLORS = {
    'Instagram': '#E4405F',
    'Twitter/X': '#1DA1F2',
    'Facebook': '#4267B2',
    'TikTok': '#000000',
    'YouTube': '#FF0000',
    'LinkedIn': '#0077B5',
    'Outro': '#6B7280',
  };

  // Region Distribution
  const regionData = analyses?.reduce((acc: Record<string, number>, analysis) => {
    if (analysis.region_distribution) {
      Object.entries(analysis.region_distribution as Record<string, number>).forEach(([region, percentage]) => {
        acc[region] = (acc[region] || 0) + percentage;
      });
    }
    return acc;
  }, {});

  const regionChartData = regionData
    ? Object.entries(regionData)
        .map(([region, value]) => ({
          region,
          percentage: Math.round(value / (analyses?.length || 1)),
        }))
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 5)
    : [];

  // Age Distribution
  const ageData = analyses?.reduce((acc: Record<string, number>, analysis) => {
    if (analysis.age_distribution) {
      Object.entries(analysis.age_distribution as Record<string, number>).forEach(([age, percentage]) => {
        acc[age] = (acc[age] || 0) + percentage;
      });
    }
    return acc;
  }, {});

  const ageChartData = ageData
    ? Object.entries(ageData).map(([age, value]) => ({
        age,
        percentage: Math.round(value / (analyses?.length || 1)),
      }))
    : [];

  // Gender Distribution
  const genderData = analyses?.reduce((acc: Record<string, number>, analysis) => {
    if (analysis.gender_distribution) {
      Object.entries(analysis.gender_distribution as Record<string, number>).forEach(([gender, percentage]) => {
        acc[gender] = (acc[gender] || 0) + percentage;
      });
    }
    return acc;
  }, {});

  const genderChartData = genderData
    ? Object.entries(genderData).map(([name, value]) => ({
        name,
        value: Math.round(value / (analyses?.length || 1)),
      }))
    : [];

  const GENDER_COLORS = {
    'Masculino': '#3B82F6',
    'Feminino': '#EC4899',
    'Outros': '#8B5CF6',
  };

  // Temporal Evolution
  const timelineData = analyses?.reduce((acc: Record<string, { date: string; sentiment: number; count: number }>, analysis) => {
    const date = new Date(analysis.created_at).toLocaleDateString('pt-BR');
    if (!acc[date]) {
      acc[date] = { date, sentiment: 0, count: 0 };
    }
    acc[date].sentiment += Number(analysis.sentiment_score) || 0;
    acc[date].count += 1;
    return acc;
  }, {});

  const timelineChartData = timelineData
    ? Object.values(timelineData).map(item => ({
        date: item.date,
        sentiment: Math.round(item.sentiment / item.count),
      }))
    : [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Analytics Avançado</h1>
          <p className="text-muted-foreground">Análise temporal e demográfica dos candidatos</p>
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Analytics Avançado</h1>
        <p className="text-muted-foreground">Análise temporal e demográfica dos candidatos</p>
      </div>

      <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sentimento Médio</CardTitle>
            {generalTrend === "positive" ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : generalTrend === "negative" ? (
              <TrendingDown className="h-4 w-4 text-red-500" />
            ) : (
              <TrendingUp className="h-4 w-4 text-yellow-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageSentiment}/100</div>
            <p className="text-xs text-muted-foreground">
              {generalTrend === "positive" ? "Tendência positiva" : generalTrend === "negative" ? "Tendência negativa" : "Estável"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Menções</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMentions.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">No período selecionado</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Análises Realizadas</CardTitle>
            <FileCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAnalyses}</div>
            <p className="text-xs text-muted-foreground">Candidatos analisados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa Positiva</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalAnalyses ? Math.round((positiveCount / totalAnalyses) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">{positiveCount} análises positivas</p>
          </CardContent>
        </Card>
      </div>

      {/* Temporal Evolution - Full Width */}
      <Card>
        <CardHeader>
          <CardTitle>Evolução do Sentimento</CardTitle>
          <CardDescription>Sentimento médio ao longo do tempo</CardDescription>
        </CardHeader>
        <CardContent>
          {timelineChartData.length > 0 ? (
            <ChartContainer
              config={{
                sentiment: {
                  label: "Sentimento",
                  color: "hsl(var(--primary))",
                },
              }}
              className="h-[350px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="sentiment" stroke="hsl(var(--primary))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-[350px] flex items-center justify-center text-muted-foreground">
              Sem dados no período selecionado
            </div>
          )}
        </CardContent>
      </Card>

      {/* Demographic Analysis Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Análise Demográfica</h2>
          <p className="text-muted-foreground">Distribuição do público por plataforma, região, idade e gênero</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Social Network Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Distribuição por Rede Social</CardTitle>
              <CardDescription>Análises por plataforma</CardDescription>
            </CardHeader>
            <CardContent>
              {socialNetworkChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={socialNetworkChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {socialNetworkChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={SOCIAL_COLORS[entry.name as keyof typeof SOCIAL_COLORS] || '#6B7280'} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Sem dados no período selecionado
                </div>
              )}
            </CardContent>
          </Card>

          {/* Regional Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Distribuição Regional</CardTitle>
              <CardDescription>Top 5 regiões</CardDescription>
            </CardHeader>
            <CardContent>
              {regionChartData.length > 0 ? (
                <ChartContainer
                  config={{
                    percentage: {
                      label: "Percentual",
                      color: "hsl(var(--primary))",
                    },
                  }}
                  className="h-[300px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={regionChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="region" type="category" width={100} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="percentage" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Sem dados disponíveis
                </div>
              )}
            </CardContent>
          </Card>

          {/* Age Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Faixa Etária</CardTitle>
              <CardDescription>Distribuição por idade</CardDescription>
            </CardHeader>
            <CardContent>
              {ageChartData.length > 0 ? (
                <ChartContainer
                  config={{
                    percentage: {
                      label: "Percentual",
                      color: "hsl(var(--chart-2))",
                    },
                  }}
                  className="h-[300px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ageChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="age" />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="percentage" fill="hsl(var(--chart-2))" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Sem dados disponíveis
                </div>
              )}
            </CardContent>
          </Card>

          {/* Gender Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Distribuição por Gênero</CardTitle>
              <CardDescription>Público por gênero</CardDescription>
            </CardHeader>
            <CardContent>
              {genderChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={genderChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {genderChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={GENDER_COLORS[entry.name as keyof typeof GENDER_COLORS] || '#8B5CF6'} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Sem dados disponíveis
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
