import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from "recharts";
import { SocialMediaReportData } from "@/pages/dashboard/SocialMediaReport";

interface SocialMediaChartsProps {
  data: SocialMediaReportData[];
}

const SENTIMENT_COLORS = {
  Positivo: "hsl(142, 76%, 36%)",
  Neutro: "hsl(48, 96%, 53%)",
  Negativo: "hsl(0, 84%, 60%)"
};

export function SocialMediaCharts({ data }: SocialMediaChartsProps) {
  // Dados para gráfico de menções por rede
  const mentionsChartData = data
    .filter(item => item.network && item.totalMentions > 0)
    .map(item => ({
      name: item.network || 'Desconhecida',
      mentions: item.totalMentions,
      profiles: item.uniqueProfiles
    }));

  // Dados para gráfico de sentimento geral
  const totalPositive = data.reduce((sum, item) => sum + item.positiveCount, 0);
  const totalNeutral = data.reduce((sum, item) => sum + item.neutralCount, 0);
  const totalNegative = data.reduce((sum, item) => sum + item.negativeCount, 0);

  const sentimentPieData = [
    { name: 'Positivo', value: totalPositive, color: SENTIMENT_COLORS.Positivo },
    { name: 'Neutro', value: totalNeutral, color: SENTIMENT_COLORS.Neutro },
    { name: 'Negativo', value: totalNegative, color: SENTIMENT_COLORS.Negativo }
  ].filter(item => item.value > 0);

  // Dados para gráfico de sentimento por rede (stacked)
  const sentimentByNetworkData = data
    .filter(item => item.network && item.totalMentions > 0)
    .map(item => ({
      network: item.network || 'Desconhecida',
      Positivo: item.positivePercent,
      Neutro: item.neutralPercent,
      Negativo: item.negativePercent
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Gráfico de Menções por Rede */}
      <Card>
        <CardHeader>
          <CardTitle>Menções por Rede Social</CardTitle>
          <CardDescription>
            Total de posts e comentários em cada plataforma
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mentionsChartData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              Nenhum dado disponível para o período selecionado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mentionsChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="name" 
                  className="text-xs"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fill: 'hsl(var(--foreground))' }}
                />
                <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                  formatter={(value: number) => value.toLocaleString('pt-BR')}
                />
                <Bar 
                  dataKey="mentions" 
                  fill="hsl(var(--primary))" 
                  radius={[8, 8, 0, 0]}
                  name="Menções"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Gráfico de Sentimento Geral */}
      <Card>
        <CardHeader>
          <CardTitle>Distribuição de Sentimento Geral</CardTitle>
          <CardDescription>
            Proporção de sentimentos em todas as redes analisadas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={sentimentPieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {sentimentPieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Gráfico de Sentimento por Rede (Stacked) */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Sentimento por Rede Social</CardTitle>
          <CardDescription>
            Distribuição percentual de sentimentos em cada plataforma
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sentimentByNetworkData.length === 0 ? (
            <div className="flex items-center justify-center h-[350px] text-muted-foreground">
              Nenhum dado disponível para o período selecionado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart 
                data={sentimentByNetworkData}
                layout="vertical"
                margin={{ left: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  type="number" 
                  domain={[0, 100]} 
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--foreground))' }}
                />
                <YAxis 
                  type="category" 
                  dataKey="network" 
                  className="text-xs"
                  width={100}
                  tick={{ fill: 'hsl(var(--foreground))' }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                  formatter={(value: number) => `${value.toFixed(1)}%`}
                />
                <Legend />
                <Bar 
                  dataKey="Positivo" 
                  stackId="a" 
                  fill={SENTIMENT_COLORS.Positivo}
                  radius={[0, 0, 0, 0]}
                />
                <Bar 
                  dataKey="Neutro" 
                  stackId="a" 
                  fill={SENTIMENT_COLORS.Neutro}
                  radius={[0, 0, 0, 0]}
                />
                <Bar 
                  dataKey="Negativo" 
                  stackId="a" 
                  fill={SENTIMENT_COLORS.Negativo}
                  radius={[0, 8, 8, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
