import { TrendingUp, TrendingDown, Minus, MessageSquare, ThumbsUp, ThumbsDown, Heart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";
import type { RealTimeMetrics } from "@/hooks/useRealTimeAnalytics";

interface RealTimeKPIsProps {
  metrics: RealTimeMetrics | null;
}

interface KPICardProps {
  title: string;
  value: number;
  suffix?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'stable';
  color: 'primary' | 'green' | 'red' | 'yellow';
}

const KPICard = ({ title, value, suffix = '', icon, trend, color }: KPICardProps) => {
  const animatedValue = useCountUp(value, 1000);
  
  const colorClasses = {
    primary: 'from-primary/20 to-primary/5 border-primary/30',
    green: 'from-green-500/20 to-green-500/5 border-green-500/30',
    red: 'from-red-500/20 to-red-500/5 border-red-500/30',
    yellow: 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/30',
  };

  const iconColors = {
    primary: 'text-primary',
    green: 'text-green-500',
    red: 'text-red-500',
    yellow: 'text-yellow-500',
  };

  return (
    <Card className={cn(
      "bg-gradient-to-br border transition-all duration-500 hover:scale-[1.02]",
      colorClasses[color]
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums">
                {animatedValue.toLocaleString('pt-BR')}
              </span>
              {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className={cn("p-2 rounded-full bg-background/50", iconColors[color])}>
              {icon}
            </div>
            {trend && (
              <div className={cn(
                "flex items-center text-xs",
                trend === 'up' ? 'text-green-500' :
                trend === 'down' ? 'text-red-500' : 'text-muted-foreground'
              )}>
                {trend === 'up' ? <TrendingUp className="h-3 w-3" /> :
                 trend === 'down' ? <TrendingDown className="h-3 w-3" /> :
                 <Minus className="h-3 w-3" />}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export const RealTimeKPIs = ({ metrics }: RealTimeKPIsProps) => {
  if (!metrics) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4 h-24 bg-muted/20" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KPICard
        title="Total de Menções"
        value={metrics.totalMentions}
        icon={<MessageSquare className="h-5 w-5" />}
        trend={metrics.trend}
        color="primary"
      />
      <KPICard
        title="Menções Positivas"
        value={metrics.positiveMentions}
        icon={<ThumbsUp className="h-5 w-5" />}
        color="green"
      />
      <KPICard
        title="Menções Negativas"
        value={metrics.negativeMentions}
        icon={<ThumbsDown className="h-5 w-5" />}
        color="red"
      />
      <KPICard
        title="Engajamento Total"
        value={metrics.totalEngagement}
        icon={<Heart className="h-5 w-5" />}
        color="yellow"
      />
    </div>
  );
};
