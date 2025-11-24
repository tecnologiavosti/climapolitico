import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TraceabilityReportData } from "@/types/traceability";
import { Network, MapPin, TrendingUp, BarChart3, Users, MessageSquare, ThumbsUp, Hash, Globe, Activity } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface TraceabilityReportProps {
  data: TraceabilityReportData;
}

const COLORS = {
  primary: "hsl(var(--primary))",
  accent: "hsl(var(--accent))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  destructive: "hsl(var(--destructive))",
  muted: "hsl(var(--muted-foreground))",
};

const SENTIMENT_COLORS = {
  positive: COLORS.success,
  neutral: COLORS.muted,
  negative: COLORS.destructive,
};

export function TraceabilityReport({ data }: TraceabilityReportProps) {
  const { metadata, origin, quantitative, qualitative, geographic, summary } = data;

  return (
    <div className="space-y-6">
      {/* Header com Metadata */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Activity className="h-6 w-6 text-primary" />
                Relatório de Rastreabilidade
              </CardTitle>
              <CardDescription className="mt-2">
                {metadata.candidateName} • {new Date(metadata.periodStart).toLocaleDateString()} - {new Date(metadata.periodEnd).toLocaleDateString()}
              </CardDescription>
            </div>
            <Badge variant={metadata.dataQuality === 'high' ? 'default' : metadata.dataQuality === 'medium' ? 'secondary' : 'destructive'}>
              {metadata.dataQuality === 'high' ? '🟢 Alta Confiabilidade' : metadata.dataQuality === 'medium' ? '🟡 Média Confiabilidade' : '🔴 Baixa Confiabilidade'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Relatório gerado em {new Date(metadata.generatedAt).toLocaleString()}
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="origin" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="origin">Origem dos Dados</TabsTrigger>
          <TabsTrigger value="quantitative">Métricas Quantitativas</TabsTrigger>
          <TabsTrigger value="qualitative">Análise Qualitativa</TabsTrigger>
          <TabsTrigger value="geographic">Recorte Geográfico</TabsTrigger>
        </TabsList>

        {/* TAB 1: Origem dos Dados */}
        <TabsContent value="origin" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5 text-primary" />
                Origem dos Dados
              </CardTitle>
              <CardDescription>Fontes e metodologia de coleta de dados</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Método de Coleta */}
              <div>
                <h3 className="text-sm font-medium mb-2">Método de Coleta</h3>
                <Badge variant="outline">{origin.collectionMethod}</Badge>
              </div>

              {/* Redes Sociais */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Redes Sociais</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {origin.networks.map((network) => (
                    <Card key={network.network}>
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <p className="font-semibold">{network.network}</p>
                            <p className="text-2xl font-bold text-primary">{network.totalProfiles}</p>
                            <p className="text-xs text-muted-foreground">perfis totais</p>
                          </div>
                          <div className="text-right space-y-1">
                            <p className="text-lg font-semibold text-accent">{network.uniqueProfiles}</p>
                            <p className="text-xs text-muted-foreground">perfis únicos</p>
                            <Badge variant="secondary" className="mt-1">
                              {network.percentageOfTotal.toFixed(1)}% do total
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Distribuição por Rede */}
              <div>
                <h3 className="text-sm font-medium mb-4">Distribuição de Perfis por Rede</h3>
                <ChartContainer config={{}} className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={origin.networks}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="network" stroke="hsl(var(--foreground))" />
                      <YAxis stroke="hsl(var(--foreground))" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="totalProfiles" name="Total de Perfis" fill={COLORS.primary} />
                      <Bar dataKey="uniqueProfiles" name="Perfis Únicos" fill={COLORS.accent} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>

              {/* Estados de Origem */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Estados de Origem</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {origin.states.map((state) => (
                    <div key={state.stateCode} className="flex items-center gap-2 p-3 rounded-lg border bg-card">
                      <MapPin className="h-4 w-4 text-primary" />
                      <div>
                        <p className="font-semibold text-sm">{state.stateCode}</p>
                        <p className="text-xs text-muted-foreground">{state.profiles} perfis</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: Métricas Quantitativas */}
        <TabsContent value="quantitative" className="space-y-6">
          {/* KPIs Principais */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Perfis Analisados
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">{quantitative.profiles.total.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">{quantitative.profiles.unique.toLocaleString()} únicos</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-accent" />
                  Posts & Comentários
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-accent">{quantitative.content.totalPosts.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">{quantitative.content.totalComments.toLocaleString()} comentários</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ThumbsUp className="h-4 w-4 text-success" />
                  Interações Totais
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-success">{quantitative.interactions.total.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">{quantitative.interactions.avgPerPost.toFixed(1)} média/post</p>
              </CardContent>
            </Card>
          </div>

          {/* Perfis por Rede */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Perfis por Rede Social
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={{}} className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={quantitative.profiles.byNetwork} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--foreground))" />
                    <YAxis dataKey="network" type="category" stroke="hsl(var(--foreground))" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar dataKey="total" name="Total" fill={COLORS.primary} />
                    <Bar dataKey="unique" name="Únicos" fill={COLORS.accent} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Hashtags e Menções */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Hash className="h-4 w-4 text-primary" />
                  Top Hashtags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {quantitative.content.topHashtags.map((hashtag, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span className="text-sm font-medium">#{hashtag.keyword}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{hashtag.count}</Badge>
                        <span className="text-xs text-muted-foreground">{hashtag.percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-accent" />
                  Taxa de Engajamento
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {quantitative.interactions.engagementRateByNetwork.map((network, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{network.network}</span>
                        <span className="text-accent font-semibold">{network.engagementRate.toFixed(2)}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div 
                          className="bg-accent rounded-full h-2 transition-all"
                          style={{ width: `${Math.min(network.engagementRate, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Estatísticas de Conteúdo */}
          <Card>
            <CardHeader>
              <CardTitle>Estatísticas de Conteúdo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Total de Posts</p>
                  <p className="text-2xl font-bold">{quantitative.content.totalPosts.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Comentários</p>
                  <p className="text-2xl font-bold">{quantitative.content.totalComments.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Menções</p>
                  <p className="text-2xl font-bold">{quantitative.content.mentions.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Posts/Dia</p>
                  <p className="text-2xl font-bold">{quantitative.content.postsPerDay.toFixed(1)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: Análise Qualitativa */}
        <TabsContent value="qualitative" className="space-y-6">
          {/* Sentimento Geral */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Análise de Sentimento
              </CardTitle>
              <CardDescription>Distribuição de sentimentos nas menções</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Gráfico de Pizza - Sentimento Geral */}
                <div>
                  <h3 className="text-sm font-medium mb-4">Sentimento Geral</h3>
                  <ChartContainer config={{}} className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Positivo', value: qualitative.sentiment.overall.positive },
                            { name: 'Neutro', value: qualitative.sentiment.overall.neutral },
                            { name: 'Negativo', value: qualitative.sentiment.overall.negative },
                          ]}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={(entry) => `${entry.name}: ${entry.value}%`}
                          outerRadius={80}
                          fill={COLORS.primary}
                          dataKey="value"
                        >
                          {[SENTIMENT_COLORS.positive, SENTIMENT_COLORS.neutral, SENTIMENT_COLORS.negative].map((color, index) => (
                            <Cell key={`cell-${index}`} fill={color} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </div>

                {/* Sentimento por Rede */}
                <div>
                  <h3 className="text-sm font-medium mb-4">Sentimento por Rede Social</h3>
                  <div className="space-y-4">
                    {qualitative.sentiment.byNetwork.map((network, idx) => (
                      <div key={idx} className="space-y-2">
                        <p className="text-sm font-medium">{network.network}</p>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-success/20 rounded-full h-6 flex items-center justify-center">
                            <span className="text-xs font-medium">{network.sentiment.positive}%</span>
                          </div>
                          <div className="flex-1 bg-muted rounded-full h-6 flex items-center justify-center">
                            <span className="text-xs font-medium">{network.sentiment.neutral}%</span>
                          </div>
                          <div className="flex-1 bg-destructive/20 rounded-full h-6 flex items-center justify-center">
                            <span className="text-xs font-medium">{network.sentiment.negative}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ideologia */}
          <Card>
            <CardHeader>
              <CardTitle>Análise Ideológica</CardTitle>
              <CardDescription>Distribuição e polarização ideológica</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Ideologia Dominante</p>
                    <p className="text-2xl font-bold text-primary">{qualitative.ideology.dominant}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Índice de Polarização</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-3">
                        <div 
                          className="bg-warning rounded-full h-3 transition-all"
                          style={{ width: `${qualitative.ideology.polarizationScore}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold">{qualitative.ideology.polarizationScore}%</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-3">Distribuição Ideológica</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Esquerda</span>
                      <Badge>{qualitative.ideology.distribution.left}%</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Centro</span>
                      <Badge variant="secondary">{qualitative.ideology.distribution.center}%</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Direita</span>
                      <Badge variant="outline">{qualitative.ideology.distribution.right}%</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Temas Dominantes */}
          <Card>
            <CardHeader>
              <CardTitle>Temas e Palavras-Chave</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Keywords */}
                <div>
                  <h3 className="text-sm font-medium mb-4">Palavras-Chave Mais Frequentes</h3>
                  <div className="space-y-2">
                    {qualitative.themes.topKeywords.slice(0, 10).map((kw, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <span className="text-sm">{kw.keyword}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-muted rounded-full h-2">
                            <div 
                              className="bg-primary rounded-full h-2"
                              style={{ width: `${kw.percentage}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-12 text-right">{kw.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Temas Dominantes */}
                <div>
                  <h3 className="text-sm font-medium mb-4">Temas Dominantes</h3>
                  <div className="space-y-3">
                    {qualitative.themes.dominantThemes.map((theme, idx) => (
                      <Card key={idx}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold">{theme.name}</p>
                              <p className="text-xs text-muted-foreground mt-1">{theme.count} menções</p>
                            </div>
                            <Badge>{theme.percentage.toFixed(1)}%</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Recorte Geográfico */}
        <TabsContent value="geographic" className="space-y-6">
          {/* Estados com Maior Atividade */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Distribuição Geográfica
              </CardTitle>
              <CardDescription>Análise por estados e regiões</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Top Estados */}
                <div>
                  <h3 className="text-sm font-medium mb-4">Estados com Maior Atividade</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {geographic.byState.slice(0, 10).map((state, idx) => (
                      <Card key={idx}>
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <p className="font-semibold">{state.state}</p>
                              <p className="text-xs text-muted-foreground">{state.stateCode}</p>
                            </div>
                            <div className="text-right space-y-1">
                              <p className="text-lg font-bold text-primary">{state.mentions}</p>
                              <p className="text-xs text-muted-foreground">menções</p>
                            </div>
                          </div>
                          <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Perfis</p>
                              <p className="font-semibold">{state.profiles}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Sentimento</p>
                              <Badge variant={state.dominantSentiment === 'Positivo' ? 'default' : state.dominantSentiment === 'Negativo' ? 'destructive' : 'secondary'}>
                                {state.dominantSentiment}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Análise Regional */}
                <div>
                  <h3 className="text-sm font-medium mb-4">Análise por Região</h3>
                  <div className="space-y-3">
                    {geographic.byRegion.map((region, idx) => (
                      <Card key={idx}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="font-semibold">{region.region}</p>
                              <p className="text-xs text-muted-foreground">{region.states.join(', ')}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-bold">{region.mentions}</p>
                              <p className="text-xs text-muted-foreground">menções</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground text-xs">Perfis</p>
                              <p className="font-semibold">{region.profiles}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground text-xs">Sentimento Médio</p>
                              <div className="flex items-center gap-1">
                                <div className="w-16 bg-muted rounded-full h-2">
                                  <div 
                                    className="bg-success rounded-full h-2"
                                    style={{ width: `${((region.averageSentiment + 1) / 2) * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs">{region.averageSentiment.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Resumo Executivo */}
      <Card>
        <CardHeader>
          <CardTitle>Resumo Executivo</CardTitle>
          <CardDescription>Principais insights da análise</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {summary.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-primary mt-1">•</span>
                <span className="text-sm">{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
