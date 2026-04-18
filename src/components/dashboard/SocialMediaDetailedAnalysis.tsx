import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Instagram, 
  Twitter, 
  Facebook, 
  Youtube, 
  Globe,
  MessageCircle,
  TrendingUp,
  Users,
  MessageSquare,
  Activity
} from "lucide-react";
import { SocialMediaReportData } from "@/pages/dashboard/SocialMediaReport";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface SocialMediaDetailedAnalysisProps {
  data: SocialMediaReportData[];
}

const NETWORK_ICONS: Record<string, any> = {
  'Instagram': Instagram,
  'Twitter/X': Twitter,
  'Facebook': Facebook,
  'TikTok': Globe,
  'YouTube': Youtube,
  'Threads': Globe,
  'LinkedIn': Globe,
  'Reddit': MessageCircle,
  'Outro': Globe,
};

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

const SENTIMENT_COLORS = {
  Positivo: 'hsl(142, 76%, 36%)',
  Neutro: 'hsl(48, 96%, 53%)',
  Negativo: 'hsl(0, 84%, 60%)',
};

export const SocialMediaDetailedAnalysis = ({ data }: SocialMediaDetailedAnalysisProps) => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Análise Detalhada por Rede Social</h2>
        <p className="text-muted-foreground">
          Visualização aprofundada de cada plataforma monitorada
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
        {data.map((network) => {
          const Icon = NETWORK_ICONS[network.network] || Globe;
          const networkColor = NETWORK_COLORS[network.network] || 'hsl(0, 0%, 42%)';
          
          const sentimentData = [
            { name: 'Positivo', value: network.positivePercent, count: network.positiveCount },
            { name: 'Neutro', value: network.neutralPercent, count: network.neutralCount },
            { name: 'Negativo', value: network.negativePercent, count: network.negativeCount },
          ].filter(item => item.value > 0);

          const engagementRate = network.uniqueProfiles > 0 
            ? ((network.totalInteractions / network.uniqueProfiles)).toFixed(1)
            : '0';

          return (
            <Card key={network.network} className="overflow-hidden hover:shadow-lg transition-shadow">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div 
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: networkColor, opacity: 0.9 }}
                    >
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{network.network}</CardTitle>
                      <CardDescription>
                        {network.uniqueProfiles.toLocaleString()} perfis únicos
                      </CardDescription>
                    </div>
                  </div>
                  <Badge 
                    variant={
                      network.dominantSentiment === "Positivo" 
                        ? "default" 
                        : network.dominantSentiment === "Negativo" 
                        ? "destructive" 
                        : "secondary"
                    }
                    className="text-sm font-semibold"
                  >
                    {network.dominantSentiment}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* Métricas Principais */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <MessageSquare className="h-3 w-3" />
                      <span>Menções</span>
                    </div>
                    <p className="text-2xl font-bold">{network.totalMentions.toLocaleString()}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <Users className="h-3 w-3" />
                      <span>Perfis</span>
                    </div>
                    <p className="text-2xl font-bold">{network.uniqueProfiles.toLocaleString()}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      <Activity className="h-3 w-3" />
                      <span>Interações</span>
                    </div>
                    <p className="text-2xl font-bold">{network.totalInteractions.toLocaleString()}</p>
                  </div>
                </div>

                {/* Taxa de Engajamento */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Taxa de Engajamento</span>
                    <span className="text-sm font-bold">{engagementRate} interações/perfil</span>
                  </div>
                  <Progress 
                    value={Math.min(parseFloat(engagementRate) * 10, 100)} 
                    className="h-2"
                  />
                </div>

                {/* Distribuição de Sentimento */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Distribuição de Sentimento</h4>
                  
                  <div className="space-y-2">
                    {/* Positivo */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Positivo</span>
                        <span className="font-semibold text-green-600">
                          {network.positivePercent}% ({network.positiveCount})
                        </span>
                      </div>
                      <Progress 
                        value={network.positivePercent} 
                        className="h-1.5 [&>div]:bg-green-600"
                      />
                    </div>

                    {/* Neutro */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Neutro</span>
                        <span className="font-semibold text-yellow-600">
                          {network.neutralPercent}% ({network.neutralCount})
                        </span>
                      </div>
                      <Progress 
                        value={network.neutralPercent} 
                        className="h-1.5 [&>div]:bg-yellow-600"
                      />
                    </div>

                    {/* Negativo */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Negativo</span>
                        <span className="font-semibold text-red-600">
                          {network.negativePercent}% ({network.negativeCount})
                        </span>
                      </div>
                      <Progress 
                        value={network.negativePercent} 
                        className="h-1.5 [&>div]:bg-red-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Gráfico de Pizza de Sentimento */}
                {sentimentData.length > 0 && (
                  <div className="pt-4">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={sentimentData}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, value }) => `${value.toFixed(0)}%`}
                          labelLine={false}
                        >
                          {sentimentData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={SENTIMENT_COLORS[entry.name as keyof typeof SENTIMENT_COLORS]} 
                            />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: any, name: any, props: any) => [
                            `${value.toFixed(1)}% (${props.payload.count} menções)`,
                            name
                          ]}
                        />
                        <Legend 
                          verticalAlign="bottom" 
                          height={36}
                          iconType="circle"
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Indicador de Performance */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <TrendingUp className={`h-4 w-4 ${
                    network.dominantSentiment === "Positivo" 
                      ? "text-green-600" 
                      : network.dominantSentiment === "Negativo"
                      ? "text-red-600"
                      : "text-yellow-600"
                  }`} />
                  <span className="text-xs text-muted-foreground">
                    {network.dominantSentiment === "Positivo" 
                      ? "Desempenho positivo nesta rede" 
                      : network.dominantSentiment === "Negativo"
                      ? "Atenção necessária nesta rede"
                      : "Desempenho neutro nesta rede"}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nenhuma rede social foi analisada no período selecionado
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
