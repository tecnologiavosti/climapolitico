import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RealTimeMetrics } from "@/hooks/useRealTimeAnalytics";

interface RealTimeMentionsChartProps {
  metrics: RealTimeMetrics | null;
}

const networkColors: Record<string, string> = {
  'Instagram': '#E4405F',
  'Twitter': '#1DA1F2',
  'X': '#000000',
  'Facebook': '#1877F2',
  'TikTok': '#000000',
  'YouTube': '#FF0000',
  'LinkedIn': '#0A66C2',
  'Threads': '#000000',
};

export const RealTimeMentionsChart = ({ metrics }: RealTimeMentionsChartProps) => {
  if (!metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Menções por Rede Social</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 animate-pulse bg-muted/20 rounded" />
        </CardContent>
      </Card>
    );
  }

  const data = metrics.mentionsByNetwork.slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Menções por Rede Social</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 10, right: 30, left: 60, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 12 }} className="text-muted-foreground" />
              <YAxis 
                dataKey="network" 
                type="category" 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: number) => [value, 'Menções']}
              />
              <Bar 
                dataKey="count" 
                radius={[0, 4, 4, 0]}
                animationDuration={500}
                animationEasing="ease-in-out"
              >
                {data.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={networkColors[entry.network] || 'hsl(var(--primary))'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
