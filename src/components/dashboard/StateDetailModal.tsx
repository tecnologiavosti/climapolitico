import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { TrendingUp, Hash, Network, Calendar, Activity } from "lucide-react";
import { StateOpportunityData } from "@/lib/opportunityCalculator";

interface StateDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  stateData: StateOpportunityData | null;
  detailedData?: {
    temporalEvolution: Array<{ date: string; sentiment: number; mentions: number; undecided: number }>;
    topKeywords: Array<{ keyword: string; count: number; sentiment: number }>;
    socialNetworks: Array<{ network: string; mentions: number; engagement: number }>;
  };
}

export const StateDetailModal = ({ isOpen, onClose, stateData, detailedData }: StateDetailModalProps) => {
  if (!stateData) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            {stateData.state} ({stateData.stateCode})
          </DialogTitle>
          <DialogDescription>
            Análise detalhada da região - Score de Oportunidade: <span className="font-bold text-lg">{stateData.opportunityScore}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Público Indeciso</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stateData.undecidedPercentage.toFixed(1)}%</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Sentimento Médio</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stateData.avgSentiment > 0 ? "+" : ""}{stateData.avgSentiment.toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total de Menções</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stateData.totalMentions.toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs for different views */}
          <Tabs defaultValue="evolution" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="evolution">
                <TrendingUp className="h-4 w-4 mr-2" />
                Evolução
              </TabsTrigger>
              <TabsTrigger value="keywords">
                <Hash className="h-4 w-4 mr-2" />
                Keywords
              </TabsTrigger>
              <TabsTrigger value="networks">
                <Network className="h-4 w-4 mr-2" />
                Redes Sociais
              </TabsTrigger>
            </TabsList>

            {/* Temporal Evolution */}
            <TabsContent value="evolution" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Evolução Temporal do Sentimento
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {detailedData?.temporalEvolution && detailedData.temporalEvolution.length > 0 ? (
                    <ChartContainer
                      config={{
                        sentiment: {
                          label: "Sentimento",
                          color: "hsl(var(--primary))",
                        },
                        mentions: {
                          label: "Menções",
                          color: "hsl(var(--secondary))",
                        },
                      }}
                      className="h-[300px]"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={detailedData.temporalEvolution}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis yAxisId="left" />
                          <YAxis yAxisId="right" orientation="right" />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="sentiment"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="mentions"
                            stroke="hsl(var(--secondary))"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      Dados temporais não disponíveis para este estado
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Variação de Indecisos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {detailedData?.temporalEvolution && detailedData.temporalEvolution.length > 0 ? (
                    <ChartContainer
                      config={{
                        undecided: {
                          label: "% Indecisos",
                          color: "hsl(43, 96%, 56%)",
                        },
                      }}
                      className="h-[200px]"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={detailedData.temporalEvolution}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line
                            type="monotone"
                            dataKey="undecided"
                            stroke="hsl(43, 96%, 56%)"
                            strokeWidth={2}
                            dot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      Dados não disponíveis
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Top Keywords */}
            <TabsContent value="keywords" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Palavras-Chave Mais Mencionadas</CardTitle>
                </CardHeader>
                <CardContent>
                  {detailedData?.topKeywords && detailedData.topKeywords.length > 0 ? (
                    <div className="space-y-4">
                      <ChartContainer
                        config={{
                          count: {
                            label: "Menções",
                            color: "hsl(var(--primary))",
                          },
                        }}
                        className="h-[300px]"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={detailedData.topKeywords}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="keyword" />
                            <YAxis />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartContainer>

                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">Detalhamento por Sentimento:</h4>
                        <div className="flex flex-wrap gap-2">
                          {detailedData.topKeywords.slice(0, 10).map((kw) => (
                            <Badge
                              key={kw.keyword}
                              variant="outline"
                              className="flex items-center gap-2"
                              style={{
                                borderColor: kw.sentiment > 0 ? "hsl(142, 76%, 36%)" : kw.sentiment < 0 ? "hsl(0, 84%, 60%)" : "hsl(43, 96%, 56%)",
                              }}
                            >
                              {kw.keyword}
                              <span className="text-xs">
                                ({kw.count}) {kw.sentiment > 0 ? "📈" : kw.sentiment < 0 ? "📉" : "➡️"}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      Dados de keywords não disponíveis para este estado
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Social Networks */}
            <TabsContent value="networks" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Redes Sociais Mais Ativas</CardTitle>
                </CardHeader>
                <CardContent>
                  {detailedData?.socialNetworks && detailedData.socialNetworks.length > 0 ? (
                    <div className="space-y-4">
                      <ChartContainer
                        config={{
                          mentions: {
                            label: "Menções",
                            color: "hsl(var(--primary))",
                          },
                          engagement: {
                            label: "Engajamento",
                            color: "hsl(var(--secondary))",
                          },
                        }}
                        className="h-[300px]"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={detailedData.socialNetworks}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="network" />
                            <YAxis />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="mentions" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                            <Bar dataKey="engagement" fill="hsl(var(--secondary))" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartContainer>

                      <div className="grid grid-cols-2 gap-4">
                        {detailedData.socialNetworks.map((network) => (
                          <Card key={network.network}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">{network.network}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Menções:</span>
                                <span className="font-bold">{network.mentions.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Engajamento:</span>
                                <span className="font-bold">{network.engagement.toLocaleString()}</span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      Dados de redes sociais não disponíveis para este estado
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Recommended Actions */}
          {stateData.recommendedActions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Ações Recomendadas</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {stateData.recommendedActions.map((action, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-primary font-bold mt-0.5">•</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
