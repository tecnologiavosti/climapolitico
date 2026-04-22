import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, MessageSquare, ThumbsUp, Youtube, BarChart3, Clock } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Area, AreaChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useAuth } from "@/hooks/useAuth";

// Componentes de análise demográfica temporariamente ocultos
// Motivo: YouTube Data API não fornece idade, gênero ou localização dos usuários
// Esses dados são tecnicamente inviáveis e foram removidos da interface

export default function Analytics() {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });

  // Query: Buscar dados reais de social_interactions (comentários coletados)
  const { data: interactions, isLoading } = useQuery({
    queryKey: ['analytics-interactions', dateRange, user?.id],
    queryFn: async () => {
      if (!user) return [];

      let query = supabase
        .from('social_interactions')
        .select('id, sentiment_label, sentiment_score, likes_count, social_network, created_at, comment_author')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        // Add one day to include the full end date
        const endDate = new Date(dateRange.to);
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt('created_at', endDate.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Calculate KPIs from real interactions
  const totalMentions = interactions?.length || 0;
  
  const positiveCount = interactions?.filter(i => i.sentiment_label === 'Positivo').length || 0;
  const negativeCount = interactions?.filter(i => i.sentiment_label === 'Negativo').length || 0;
  const neutralCount = interactions?.filter(i => i.sentiment_label === 'Neutro').length || 0;
  
  const positiveRate = totalMentions > 0 ? Math.round((positiveCount / totalMentions) * 100) : 0;
  
  const averageSentiment = totalMentions > 0
    ? Math.round(((positiveCount * 100) + (neutralCount * 50) + (negativeCount * 0)) / totalMentions)
    : 50;

  const generalTrend = positiveCount > negativeCount ? "positive" : negativeCount > positiveCount ? "negative" : "neutral";

  // Unique authors
  const uniqueAuthors = new Set(interactions?.map(i => i.comment_author).filter(Boolean)).size;

  // Total engagement (likes)
  const totalLikes = interactions?.reduce((sum, i) => sum + (i.likes_count || 0), 0) || 0;

  // Normalize network names for consistent display
  const normalizeNetwork = (n: string | null | undefined): string => {
    if (!n) return 'Outro';
    const map: Record<string, string> = {
      google_news: 'Google News',
      googlenews: 'Google News',
      'google news': 'Google News',
      youtube: 'YouTube',
      twitter: 'Twitter/X',
      x: 'Twitter/X',
      'twitter/x': 'Twitter/X',
      instagram: 'Instagram',
      facebook: 'Facebook',
      tiktok: 'TikTok',
      tik_tok: 'TikTok',
      linkedin: 'LinkedIn',
      threads: 'Threads',
      telegram: 'Telegram',
      reddit: 'Reddit',
      wikipedia: 'Wikipedia',
    };
    return map[n.toLowerCase()] || n;
  };

  // Social Network Distribution (from real data)
  const networkData = interactions?.reduce((acc: Record<string, number>, i) => {
    const network = normalizeNetwork(i.social_network);
    acc[network] = (acc[network] || 0) + 1;
    return acc;
  }, {}) || {};

  const networkChartData = Object.entries(networkData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const NETWORK_COLORS: Record<string, string> = {
    'YouTube': '#FF0000',
    'Instagram': '#E4405F',
    'Twitter/X': '#1DA1F2',
    'Facebook': '#4267B2',
    'TikTok': '#000000',
    'LinkedIn': '#0077B5',
    'Google News': '#22C55E',
    'Threads': '#1F2937',
    'Telegram': '#0088CC',
    'Reddit': '#FF4500',
    'Wikipedia': '#636363',
    'Outro': '#6B7280',
  };

  // Top network for the source badge
  const topNetwork = networkChartData[0]?.name;
  const sourcesCount = networkChartData.length;

  // Sentiment Distribution (pie chart)
  const sentimentChartData = [
    { name: 'Positivo', value: positiveCount, color: 'hsl(var(--success))' },
    { name: 'Neutro', value: neutralCount, color: 'hsl(var(--warning))' },
    { name: 'Negativo', value: negativeCount, color: 'hsl(var(--destructive))' },
  ].filter(d => d.value > 0);

  // Temporal Evolution - group by day
  const timelineData = interactions?.reduce((acc: Record<string, { date: string; positive: number; neutral: number; negative: number; total: number }>, i) => {
    const date = new Date(i.created_at).toLocaleDateString('pt-BR');
    if (!acc[date]) {
      acc[date] = { date, positive: 0, neutral: 0, negative: 0, total: 0 };
    }
    if (i.sentiment_label === 'Positivo') acc[date].positive += 1;
    else if (i.sentiment_label === 'Negativo') acc[date].negative += 1;
    else acc[date].neutral += 1;
    acc[date].total += 1;
    return acc;
  }, {}) || {};

  const timelineChartData = Object.values(timelineData).map(item => ({
    date: item.date,
    positive: item.positive,
    neutral: item.neutral,
    negative: item.negative,
    total: item.total,
    sentiment: item.total > 0 
      ? Math.round(((item.positive * 100) + (item.neutral * 50) + (item.negative * 0)) / item.total)
      : 50,
  }));

  // Get date range text
  const dateRangeText = dateRange?.from && dateRange?.to
    ? `${dateRange.from.toLocaleDateString('pt-BR')} - ${dateRange.to.toLocaleDateString('pt-BR')}`
    : 'Período não selecionado';

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Analytics Avançado</h1>
          <p className="text-muted-foreground">Análise estatística baseada em dados reais coletados</p>
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-8 w-8 text-primary" />
            Analytics Avançado
          </h1>
          <p className="text-muted-foreground">Análise estatística baseada em dados reais coletados</p>
        </div>
        <Badge variant="outline" className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {sourcesCount > 0
            ? `${sourcesCount} ${sourcesCount === 1 ? 'fonte' : 'fontes'}${topNetwork ? ` • principal: ${topNetwork}` : ''}`
            : 'Multi-fonte: YouTube, Google News, TikTok, Reddit, Telegram, Wikipedia, X'}
        </Badge>
      </div>

      <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />

      {/* Period Info */}
      <Card className="bg-muted/30">
        <CardContent className="py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Período analisado: <strong>{dateRangeText}</strong></span>
            <span className="mx-2">•</span>
            <span>{totalMentions.toLocaleString('pt-BR')} comentários encontrados</span>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sentimento Médio</CardTitle>
            {generalTrend === "positive" ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : generalTrend === "negative" ? (
              <TrendingDown className="h-4 w-4 text-destructive" />
            ) : (
              <TrendingUp className="h-4 w-4 text-warning" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageSentiment}%</div>
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
            <div className="text-2xl font-bold">{totalMentions.toLocaleString('pt-BR')}</div>
            <p className="text-xs text-muted-foreground">{uniqueAuthors} autores únicos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa Positiva</CardTitle>
            <ThumbsUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{positiveRate}%</div>
            <p className="text-xs text-muted-foreground">{positiveCount} comentários positivos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Engajamento</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLikes.toLocaleString('pt-BR')}</div>
            <p className="text-xs text-muted-foreground">curtidas nos comentários</p>
          </CardContent>
        </Card>
      </div>

      {/* Temporal Evolution - Full Width */}
      <Card>
        <CardHeader>
          <CardTitle>Evolução do Sentimento</CardTitle>
          <CardDescription>Distribuição de sentimentos ao longo do tempo (dados reais)</CardDescription>
        </CardHeader>
        <CardContent>
          {timelineChartData.length > 0 ? (
            <ChartContainer
              config={{
                positive: { label: "Positivo", color: "hsl(var(--success))" },
                neutral: { label: "Neutro", color: "hsl(var(--warning))" },
                negative: { label: "Negativo", color: "hsl(var(--destructive))" },
              }}
              className="h-[350px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area 
                    type="monotone" 
                    dataKey="positive" 
                    stackId="1" 
                    stroke="hsl(var(--success))" 
                    fill="hsl(var(--success))" 
                    fillOpacity={0.6}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="neutral" 
                    stackId="1" 
                    stroke="hsl(var(--warning))" 
                    fill="hsl(var(--warning))" 
                    fillOpacity={0.6}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="negative" 
                    stackId="1" 
                    stroke="hsl(var(--destructive))" 
                    fill="hsl(var(--destructive))" 
                    fillOpacity={0.6}
                  />
                  <Legend />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-[350px] flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Sem dados no período selecionado</p>
                <p className="text-sm mt-2">Colete comentários do YouTube para visualizar a evolução</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Sentiment Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de Sentimento</CardTitle>
            <CardDescription>Proporção de comentários por sentimento</CardDescription>
          </CardHeader>
          <CardContent>
            {sentimentChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={sentimentChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    dataKey="value"
                  >
                    {sentimentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [value, 'Comentários']} />
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

        {/* Network Distribution - only show if there's data */}
        <Card>
          <CardHeader>
            <CardTitle>Origem dos Dados</CardTitle>
            <CardDescription>Comentários por rede social</CardDescription>
          </CardHeader>
          <CardContent>
            {networkChartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={networkChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      width={80}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip formatter={(value: number) => [value.toLocaleString('pt-BR'), 'Comentários']} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {networkChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={NETWORK_COLORS[entry.name] || NETWORK_COLORS['Outro']} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                
                {/* Network breakdown list */}
                <div className="space-y-2 mt-4">
                  {networkChartData.map((network) => (
                    <div key={network.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: NETWORK_COLORS[network.name] || NETWORK_COLORS['Outro'] }}
                        />
                        <span className="text-sm font-medium">{network.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {network.value.toLocaleString('pt-BR')} comentários ({totalMentions > 0 ? Math.round((network.value / totalMentions) * 100) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Sem dados no período selecionado
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Volume Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Volume de Menções</CardTitle>
          <CardDescription>Total de comentários coletados por dia</CardDescription>
        </CardHeader>
        <CardContent>
          {timelineChartData.length > 0 ? (
            <ChartContainer
              config={{
                total: { label: "Comentários", color: "hsl(var(--primary))" },
              }}
              className="h-[250px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line 
                    type="monotone" 
                    dataKey="total" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-muted-foreground">
              Sem dados no período selecionado
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Info Footer */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Youtube className="h-4 w-4 text-destructive" />
            <span>
              Todas as métricas são calculadas a partir dos comentários reais coletados do YouTube.
              Dados demográficos (idade, gênero, localização) não são fornecidos pela API do YouTube.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 
        Seção de Análise Demográfica removida temporariamente.
        
        Motivo técnico: A YouTube Data API não fornece informações pessoais dos usuários
        como idade, gênero ou localização geográfica. Essas métricas são tecnicamente 
        inviáveis de serem calculadas e foram removidas para evitar dados falsos.
        
        Os componentes abaixo podem ser reativados quando houver integração com APIs
        que forneçam esses dados (ex: Meta Graph API para Facebook/Instagram):
        
        - Distribuição Regional
        - Faixa Etária  
        - Distribuição por Gênero
      */}
    </div>
  );
}
