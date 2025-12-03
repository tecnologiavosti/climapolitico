import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCountUp } from "@/hooks/useCountUp";
import type { RealTimeMetrics } from "@/hooks/useRealTimeAnalytics";

interface RealTimeSentimentGaugeProps {
  metrics: RealTimeMetrics | null;
}

export const RealTimeSentimentGauge = ({ metrics }: RealTimeSentimentGaugeProps) => {
  const score = metrics?.sentimentScore ?? 50;
  const animatedScore = useCountUp(score, 1000);

  // Create gauge data
  const gaugeData = [
    { name: 'score', value: score },
    { name: 'remaining', value: 100 - score },
  ];

  // Determine color based on score
  const getColor = () => {
    if (score >= 70) return 'hsl(var(--chart-2))'; // Green
    if (score >= 40) return 'hsl(var(--chart-4))'; // Yellow
    return 'hsl(var(--chart-1))'; // Red
  };

  const getSentimentLabel = () => {
    if (score >= 70) return 'Positivo';
    if (score >= 40) return 'Neutro';
    return 'Negativo';
  };

  if (!metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sentimento Atual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 animate-pulse bg-muted/20 rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sentimento Atual</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={gaugeData}
                cx="50%"
                cy="70%"
                startAngle={180}
                endAngle={0}
                innerRadius="60%"
                outerRadius="80%"
                paddingAngle={0}
                dataKey="value"
                animationDuration={500}
                animationEasing="ease-in-out"
              >
                <Cell fill={getColor()} />
                <Cell fill="hsl(var(--muted))" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center mt-4">
            <span className="text-4xl font-bold tabular-nums">{animatedScore}</span>
            <span className="text-sm text-muted-foreground">{getSentimentLabel()}</span>
          </div>

          {/* Scale labels */}
          <div className="absolute bottom-2 left-0 right-0 flex justify-between px-8 text-xs text-muted-foreground">
            <span>Negativo</span>
            <span>Positivo</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
