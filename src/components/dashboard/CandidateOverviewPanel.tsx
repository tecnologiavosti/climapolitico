import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Users, MessageSquare, TrendingUp, TrendingDown, 
  ThumbsUp, ThumbsDown, Minus, Share2, Heart,
  AlertTriangle, CheckCircle, Info
} from "lucide-react";
import { useCandidateMetrics } from "@/hooks/useCandidateMetrics";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

interface CandidateOverviewPanelProps {
  candidateId: string;
}

const SENTIMENT_COLORS = {
  positive: "hsl(var(--success))",
  neutral: "hsl(var(--warning))",
  negative: "hsl(var(--destructive))"
};

const NETWORK_COLORS: Record<string, string> = {
  "Instagram": "#E4405F",
  "Twitter/X": "#1DA1F2",
  "Facebook": "#1877F2",
  "TikTok": "#000000",
  "YouTube": "#FF0000",
  "LinkedIn": "#0A66C2",
  "Threads": "#000000",
  "Outro": "#6B7280"
};

export function CandidateOverviewPanel({ candidateId }: CandidateOverviewPanelProps) {
  // Use the single source of truth hook
  const { data: metrics, isLoading } = useCandidateMetrics(candidateId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-warning" />
          <p className="text-muted-foreground">Nenhum dado disponível para este candidato.</p>
          <p className="text-sm text-muted-foreground mt-2">Execute uma coleta do YouTube para começar a coletar dados.</p>
        </CardContent>
      </Card>
    );
  }

  // Use derived values from hook
  const sentimentPieData = [
    { name: "Positivo", value: metrics.sentimentDistribution.positive, color: SENTIMENT_COLORS.positive },
    { name: "Neutro", value: metrics.sentimentDistribution.neutral, color: SENTIMENT_COLORS.neutral },
    { name: "Negativo", value: metrics.sentimentDistribution.negative, color: SENTIMENT_COLORS.negative }
  ].filter(d => d.value > 0);

  const confidenceLabel = {
    high: { text: "Alta Confiança", icon: CheckCircle, color: "text-success" },
    medium: { text: "Média Confiança", icon: Info, color: "text-warning" },
    low: { text: "Baixa Confiança", icon: AlertTriangle, color: "text-destructive" }
  }[metrics.dataConfidence];

  const ConfidenceIcon = confidenceLabel.icon;

  return (
    <div className="space-y-6">
      {/* Data Confidence Banner */}
      <Card className={`border-l-4 ${metrics.dataConfidence === 'high' ? 'border-l-success' : metrics.dataConfidence === 'medium' ? 'border-l-warning' : 'border-l-destructive'}`}>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ConfidenceIcon className={`h-5 w-5 ${confidenceLabel.color}`} />
              <span className="font-medium">{confidenceLabel.text}</span>
              <span className="text-sm text-muted-foreground">
                • {metrics.analysisCount} análise(s) • Última: {
                  metrics.lastAnalysisDate 
                    ? new Date(metrics.lastAnalysisDate).toLocaleDateString('pt-BR')
                    : 'N/A'
                }
              </span>
            </div>
            {metrics.dataConfidence === 'low' && (
              <span className="text-xs text-muted-foreground">
                Recomendamos mais análises para resultados mais precisos
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Mentions */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total de Menções</p>
                <p className="text-3xl font-bold mt-1">{metrics.totalMentions.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Todas as redes sociais
                </p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unique Authors */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pessoas Citando</p>
                <p className="text-3xl font-bold mt-1">{metrics.uniqueAuthors.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Autores únicos identificados
                </p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <Users className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Engagement */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Engajamento Total</p>
                <p className="text-3xl font-bold mt-1">{metrics.totalEngagement.toLocaleString('pt-BR')}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3" /> {metrics.totalLikes.toLocaleString('pt-BR')}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> {metrics.totalReplies.toLocaleString('pt-BR')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Share2 className="h-3 w-3" /> {metrics.totalShares.toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <Heart className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Average Sentiment */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="w-full">
                <p className="text-sm text-muted-foreground">Sentimento Médio</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-3xl font-bold">{metrics.averageSentiment}%</p>
                  <Badge variant={
                    metrics.dominantSentiment === 'Positivo' ? 'default' :
                    metrics.dominantSentiment === 'Negativo' ? 'destructive' :
                    'secondary'
                  }>
                    {metrics.dominantSentiment}
                  </Badge>
                </div>
                <Progress 
                  value={metrics.averageSentiment} 
                  className="h-2 mt-2"
                />
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                {metrics.averageSentiment >= 50 ? (
                  <TrendingUp className="h-6 w-6 text-success" />
                ) : (
                  <TrendingDown className="h-6 w-6 text-destructive" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sentiment Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ThumbsUp className="h-5 w-5" />
              Distribuição de Sentimento
            </CardTitle>
            <CardDescription>
              Proporção de menções positivas, neutras e negativas
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sentimentPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={sentimentPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}%`}
                  >
                    {sentimentPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [`${value}%`, 'Percentual']}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                Dados insuficientes para exibir
              </div>
            )}

            {/* Sentiment bars */}
            <div className="space-y-3 mt-4">
              <div className="flex items-center gap-3">
                <ThumbsUp className="h-4 w-4 text-success" />
                <span className="text-sm w-20">Positivo</span>
                <Progress value={metrics.sentimentDistribution.positive} className="flex-1 h-2" />
                <span className="text-sm font-medium w-12 text-right">{metrics.sentimentDistribution.positive}%</span>
              </div>
              <div className="flex items-center gap-3">
                <Minus className="h-4 w-4 text-warning" />
                <span className="text-sm w-20">Neutro</span>
                <Progress value={metrics.sentimentDistribution.neutral} className="flex-1 h-2" />
                <span className="text-sm font-medium w-12 text-right">{metrics.sentimentDistribution.neutral}%</span>
              </div>
              <div className="flex items-center gap-3">
                <ThumbsDown className="h-4 w-4 text-destructive" />
                <span className="text-sm w-20">Negativo</span>
                <Progress value={metrics.sentimentDistribution.negative} className="flex-1 h-2" />
                <span className="text-sm font-medium w-12 text-right">{metrics.sentimentDistribution.negative}%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Network Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Menções por Rede Social
            </CardTitle>
            <CardDescription>
              Em quais redes o candidato é mais citado
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.networkBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={metrics.networkBreakdown.slice(0, 6)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" className="text-muted-foreground" />
                  <YAxis 
                    type="category" 
                    dataKey="network" 
                    width={80}
                    className="text-muted-foreground"
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    formatter={(value: number) => [value.toLocaleString('pt-BR'), 'Menções']}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar 
                    dataKey="mentions" 
                    fill="hsl(var(--primary))" 
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                Nenhuma rede social identificada
              </div>
            )}

            {/* Network details */}
            <div className="space-y-2 mt-4">
              {metrics.networkBreakdown.slice(0, 4).map((network) => (
                <div key={network.network} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: NETWORK_COLORS[network.network] || NETWORK_COLORS['Outro'] }}
                    />
                    <span className="text-sm font-medium">{network.network}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{network.mentions.toLocaleString('pt-BR')} menções</span>
                    <Badge variant={network.avgSentiment >= 60 ? 'default' : network.avgSentiment >= 40 ? 'secondary' : 'destructive'}>
                      {network.avgSentiment}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Notice */}
      {metrics.dataConfidence === 'low' && (
        <Card className="bg-warning/5 border-warning/20">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
              <div>
                <p className="font-medium text-warning">Dados Limitados</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Os dados exibidos são baseados em análises de IA e podem não refletir o volume real de menções nas redes sociais.
                  Para obter dados mais precisos, é necessário integrar APIs de coleta de dados sociais como Twitter API, 
                  Meta Graph API, ou ferramentas especializadas de social listening.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
