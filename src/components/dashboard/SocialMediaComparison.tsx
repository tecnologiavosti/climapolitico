import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  TrendingDown,
  Minus,
  Users,
  MessageSquare,
  Activity,
  ArrowRight
} from "lucide-react";
import { SocialMediaReportData } from "@/pages/dashboard/SocialMediaReport";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend, Tooltip, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface SocialMediaComparisonProps {
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

export const SocialMediaComparison = ({ data }: SocialMediaComparisonProps) => {
  const [network1, setNetwork1] = useState<string>(data[0]?.network || "");
  const [network2, setNetwork2] = useState<string>(data[1]?.network || "");

  const data1 = data.find(n => n.network === network1);
  const data2 = data.find(n => n.network === network2);

  if (data.length < 2) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            São necessárias pelo menos 2 redes sociais para comparação
          </p>
        </CardContent>
      </Card>
    );
  }

  const calculateDifference = (value1: number, value2: number) => {
    if (value2 === 0) return value1 > 0 ? 100 : 0;
    return ((value1 - value2) / value2) * 100;
  };

  const renderDifferenceIndicator = (diff: number) => {
    if (Math.abs(diff) < 1) {
      return (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Minus className="h-4 w-4" />
          <span className="text-sm">Igual</span>
        </div>
      );
    }
    return diff > 0 ? (
      <div className="flex items-center gap-1 text-green-600">
        <TrendingUp className="h-4 w-4" />
        <span className="text-sm font-semibold">+{diff.toFixed(1)}%</span>
      </div>
    ) : (
      <div className="flex items-center gap-1 text-red-600">
        <TrendingDown className="h-4 w-4" />
        <span className="text-sm font-semibold">{diff.toFixed(1)}%</span>
      </div>
    );
  };

  // Dados para gráfico de barras comparativo
  const comparisonChartData = [
    {
      metric: 'Menções',
      [network1]: data1?.totalMentions || 0,
      [network2]: data2?.totalMentions || 0,
    },
    {
      metric: 'Perfis Únicos',
      [network1]: data1?.uniqueProfiles || 0,
      [network2]: data2?.uniqueProfiles || 0,
    },
    {
      metric: 'Interações',
      [network1]: data1?.totalInteractions || 0,
      [network2]: data2?.totalInteractions || 0,
    },
  ];

  // Dados para gráfico radar de sentimentos
  const sentimentRadarData = [
    {
      sentiment: 'Positivo',
      [network1]: data1?.positivePercent || 0,
      [network2]: data2?.positivePercent || 0,
    },
    {
      sentiment: 'Neutro',
      [network1]: data1?.neutralPercent || 0,
      [network2]: data2?.neutralPercent || 0,
    },
    {
      sentiment: 'Negativo',
      [network1]: data1?.negativePercent || 0,
      [network2]: data2?.negativePercent || 0,
    },
  ];

  const Icon1 = NETWORK_ICONS[network1] || Globe;
  const Icon2 = NETWORK_ICONS[network2] || Globe;
  const color1 = NETWORK_COLORS[network1] || 'hsl(var(--primary))';
  const color2 = NETWORK_COLORS[network2] || 'hsl(var(--chart-2))';

  const engagementRate1 = data1 && data1.uniqueProfiles > 0 
    ? (data1.totalInteractions / data1.uniqueProfiles).toFixed(1)
    : '0';
  const engagementRate2 = data2 && data2.uniqueProfiles > 0 
    ? (data2.totalInteractions / data2.uniqueProfiles).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Comparação Entre Redes Sociais</h2>
        <p className="text-muted-foreground">
          Análise comparativa lado a lado de duas plataformas
        </p>
      </div>

      {/* Seletores */}
      <Card>
        <CardHeader>
          <CardTitle>Selecione as Redes para Comparar</CardTitle>
          <CardDescription>Escolha duas redes sociais para análise comparativa</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select value={network1} onValueChange={setNetwork1}>
              <SelectTrigger>
                <SelectValue placeholder="Primeira rede" />
              </SelectTrigger>
              <SelectContent>
                {data.map(network => (
                  <SelectItem key={network.network} value={network.network}>
                    {network.network}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={network2} onValueChange={setNetwork2}>
              <SelectTrigger>
                <SelectValue placeholder="Segunda rede" />
              </SelectTrigger>
              <SelectContent>
                {data.map(network => (
                  <SelectItem key={network.network} value={network.network}>
                    {network.network}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {data1 && data2 && (
        <>
          {/* Cards de Comparação Lado a Lado */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rede 1 */}
            <Card className="border-2" style={{ borderColor: color1 }}>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div 
                    className="p-3 rounded-lg"
                    style={{ backgroundColor: color1 }}
                  >
                    <Icon1 className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">{network1}</CardTitle>
                    <CardDescription>{Number(data1.uniqueProfiles ?? 0).toLocaleString()} perfis</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Menções</span>
                    <span className="text-xl font-bold">{Number(data1.totalMentions ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Interações</span>
                    <span className="text-xl font-bold">{Number(data1.totalInteractions ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Engajamento</span>
                    <span className="text-xl font-bold">{engagementRate1}/perfil</span>
                  </div>
                </div>

                <div className="pt-4 border-t space-y-2">
                  <p className="text-sm font-semibold">Sentimento Dominante</p>
                  <Badge 
                    variant={
                      data1.dominantSentiment === "Positivo" ? "default" :
                      data1.dominantSentiment === "Negativo" ? "destructive" : "secondary"
                    }
                    className="text-base"
                  >
                    {data1.dominantSentiment}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Positivo</span>
                    <span className="font-semibold text-green-600">{data1.positivePercent}%</span>
                  </div>
                  <Progress value={data1.positivePercent} className="h-2 [&>div]:bg-green-600" />
                  
                  <div className="flex justify-between text-xs">
                    <span>Neutro</span>
                    <span className="font-semibold text-yellow-600">{data1.neutralPercent}%</span>
                  </div>
                  <Progress value={data1.neutralPercent} className="h-2 [&>div]:bg-yellow-600" />
                  
                  <div className="flex justify-between text-xs">
                    <span>Negativo</span>
                    <span className="font-semibold text-red-600">{data1.negativePercent}%</span>
                  </div>
                  <Progress value={data1.negativePercent} className="h-2 [&>div]:bg-red-600" />
                </div>
              </CardContent>
            </Card>

            {/* Rede 2 */}
            <Card className="border-2" style={{ borderColor: color2 }}>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div 
                    className="p-3 rounded-lg"
                    style={{ backgroundColor: color2 }}
                  >
                    <Icon2 className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">{network2}</CardTitle>
                    <CardDescription>{Number(data2.uniqueProfiles ?? 0).toLocaleString()} perfis</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Menções</span>
                    <span className="text-xl font-bold">{Number(data2.totalMentions ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Interações</span>
                    <span className="text-xl font-bold">{Number(data2.totalInteractions ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Engajamento</span>
                    <span className="text-xl font-bold">{engagementRate2}/perfil</span>
                  </div>
                </div>

                <div className="pt-4 border-t space-y-2">
                  <p className="text-sm font-semibold">Sentimento Dominante</p>
                  <Badge 
                    variant={
                      data2.dominantSentiment === "Positivo" ? "default" :
                      data2.dominantSentiment === "Negativo" ? "destructive" : "secondary"
                    }
                    className="text-base"
                  >
                    {data2.dominantSentiment}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Positivo</span>
                    <span className="font-semibold text-green-600">{data2.positivePercent}%</span>
                  </div>
                  <Progress value={data2.positivePercent} className="h-2 [&>div]:bg-green-600" />
                  
                  <div className="flex justify-between text-xs">
                    <span>Neutro</span>
                    <span className="font-semibold text-yellow-600">{data2.neutralPercent}%</span>
                  </div>
                  <Progress value={data2.neutralPercent} className="h-2 [&>div]:bg-yellow-600" />
                  
                  <div className="flex justify-between text-xs">
                    <span>Negativo</span>
                    <span className="font-semibold text-red-600">{data2.negativePercent}%</span>
                  </div>
                  <Progress value={data2.negativePercent} className="h-2 [&>div]:bg-red-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Análise de Diferenças */}
          <Card>
            <CardHeader>
              <CardTitle>Análise de Diferenças</CardTitle>
              <CardDescription>
                Comparação percentual entre {network1} e {network2}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MessageSquare className="h-4 w-4" />
                    <span>Menções</span>
                  </div>
                  {renderDifferenceIndicator(
                    calculateDifference(data1.totalMentions, data2.totalMentions)
                  )}
                </div>

                <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>Perfis</span>
                  </div>
                  {renderDifferenceIndicator(
                    calculateDifference(data1.uniqueProfiles, data2.uniqueProfiles)
                  )}
                </div>

                <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Activity className="h-4 w-4" />
                    <span>Interações</span>
                  </div>
                  {renderDifferenceIndicator(
                    calculateDifference(data1.totalInteractions, data2.totalInteractions)
                  )}
                </div>

                <div className="space-y-2 p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TrendingUp className="h-4 w-4" />
                    <span>Engajamento</span>
                  </div>
                  {renderDifferenceIndicator(
                    calculateDifference(parseFloat(engagementRate1), parseFloat(engagementRate2))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gráficos Comparativos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Gráfico de Barras - Métricas Gerais */}
            <Card>
              <CardHeader>
                <CardTitle>Comparação de Métricas</CardTitle>
                <CardDescription>Menções, perfis e interações</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    [network1]: {
                      label: network1,
                      color: color1,
                    },
                    [network2]: {
                      label: network2,
                      color: color2,
                    },
                  }}
                  className="h-[300px]"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="metric" />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey={network1} fill={color1} />
                      <Bar dataKey={network2} fill={color2} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Gráfico Radar - Sentimentos */}
            <Card>
              <CardHeader>
                <CardTitle>Comparação de Sentimentos</CardTitle>
                <CardDescription>Distribuição percentual de sentimentos</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={sentimentRadarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="sentiment" />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} />
                    <Radar
                      name={network1}
                      dataKey={network1}
                      stroke={color1}
                      fill={color1}
                      fillOpacity={0.5}
                    />
                    <Radar
                      name={network2}
                      dataKey={network2}
                      stroke={color2}
                      fill={color2}
                      fillOpacity={0.5}
                    />
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Conclusões e Insights */}
          <Card>
            <CardHeader>
              <CardTitle>Insights da Comparação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <ArrowRight className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Alcance</p>
                  <p className="text-sm text-muted-foreground">
                    {data1.totalMentions > data2.totalMentions ? network1 : network2} tem maior alcance com{" "}
                    {Math.abs(data1.totalMentions - data2.totalMentions).toLocaleString()} menções a mais
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <ArrowRight className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Engajamento</p>
                  <p className="text-sm text-muted-foreground">
                    {parseFloat(engagementRate1) > parseFloat(engagementRate2) ? network1 : network2} apresenta melhor taxa de engajamento por perfil
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <ArrowRight className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Sentimento</p>
                  <p className="text-sm text-muted-foreground">
                    {data1.positivePercent > data2.positivePercent ? network1 : network2} possui maior percentual de sentimento positivo 
                    ({Math.max(data1.positivePercent, data2.positivePercent).toFixed(1)}%)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};
