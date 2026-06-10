import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Minus, MessageSquare, ThumbsUp, ThumbsDown, Heart, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";
import type { RealTimeMetrics } from "@/hooks/useRealTimeAnalytics";

interface RealTimeKPIsProps {
  metrics: RealTimeMetrics | null;
}

type Tone = "primary" | "green" | "red" | "yellow" | "violet";

const toneStyles: Record<Tone, { icon: string; bg: string; stroke: string; fill: string }> = {
  primary: { icon: "text-primary", bg: "bg-primary/10", stroke: "hsl(var(--primary))", fill: "hsl(var(--primary) / 0.15)" },
  green:   { icon: "text-emerald-500", bg: "bg-emerald-500/10", stroke: "#22c55e", fill: "rgba(34,197,94,0.18)" },
  red:     { icon: "text-red-500", bg: "bg-red-500/10", stroke: "#ef4444", fill: "rgba(239,68,68,0.18)" },
  yellow:  { icon: "text-amber-500", bg: "bg-amber-500/10", stroke: "#eab308", fill: "rgba(234,179,8,0.18)" },
  violet:  { icon: "text-violet-500", bg: "bg-violet-500/10", stroke: "#8b5cf6", fill: "rgba(139,92,246,0.18)" },
};

interface KPIProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone: Tone;
  sparkline: number[];
  change?: number;
  index: number;
}

const Sparkline = ({ data, stroke, fill }: { data: number[]; stroke: string; fill: string }) => {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${stroke}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.5} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.75} fill={`url(#spark-${stroke})`} isAnimationActive={true} animationDuration={700} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const KPICard = ({ title, value, icon, tone, sparkline, change, index }: KPIProps) => {
  const animated = useCountUp(value, 900);
  const s = toneStyles[tone];
  const trendUp = (change ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: "easeOut" }}
      whileHover={{ y: -2 }}
    >
      <Card className="group relative overflow-hidden border-border/60 bg-card/60 backdrop-blur-sm transition-colors hover:border-border">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("rounded-md p-1.5", s.bg, s.icon)}>{icon}</div>
              <span className="text-xs font-medium text-muted-foreground">{title}</span>
            </div>
            {change !== undefined && (
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
                trendUp ? "text-emerald-500" : "text-red-500"
              )}>
                {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {trendUp ? "+" : ""}{change.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="text-2xl font-bold tabular-nums tracking-tight">
            {Number(animated ?? 0).toLocaleString("pt-BR")}
          </div>
          <Sparkline data={sparkline.length ? sparkline : [0, 0, 0]} stroke={s.stroke} fill={s.fill} />
        </div>
      </Card>
    </motion.div>
  );
};

const KPISkeleton = () => (
  <Card className="border-border/60 bg-card/40">
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-md bg-muted animate-pulse" />
        <div className="h-3 w-20 rounded bg-muted animate-pulse" />
      </div>
      <div className="h-7 w-24 rounded bg-muted animate-pulse" />
      <div className="h-10 w-full rounded bg-muted/60 animate-pulse" />
    </div>
  </Card>
);

export const RealTimeKPIs = ({ metrics }: RealTimeKPIsProps) => {
  if (!metrics) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[...Array(6)].map((_, i) => <KPISkeleton key={i} />)}
      </div>
    );
  }

  const hist = metrics.sentimentHistory ?? [];
  const total = hist.map(h => h.positive + h.neutral + h.negative);
  const pos = hist.map(h => h.positive);
  const neu = hist.map(h => h.neutral);
  const neg = hist.map(h => h.negative);
  const eng = hist.map((_, i) => total[i] * (1 + (i % 3) * 0.2)); // proxy for engagement trend

  const pctChange = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const mid = Math.floor(arr.length / 2);
    const a = arr.slice(0, mid).reduce((x, y) => x + y, 0) || 0;
    const b = arr.slice(mid).reduce((x, y) => x + y, 0) || 0;
    if (a === 0) return b > 0 ? 100 : 0;
    return ((b - a) / a) * 100;
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <KPICard index={0} title="Menções" value={metrics.totalMentions} icon={<MessageSquare className="h-3.5 w-3.5" />} tone="primary" sparkline={total} change={pctChange(total)} />
      <KPICard index={1} title="Positivas" value={metrics.positiveMentions} icon={<ThumbsUp className="h-3.5 w-3.5" />} tone="green" sparkline={pos} change={pctChange(pos)} />
      <KPICard index={2} title="Neutras" value={metrics.neutralMentions} icon={<Minus className="h-3.5 w-3.5" />} tone="yellow" sparkline={neu} change={pctChange(neu)} />
      <KPICard index={3} title="Negativas" value={metrics.negativeMentions} icon={<ThumbsDown className="h-3.5 w-3.5" />} tone="red" sparkline={neg} change={pctChange(neg)} />
      <KPICard index={4} title="Engajamento" value={metrics.totalEngagement} icon={<Heart className="h-3.5 w-3.5" />} tone="violet" sparkline={eng} />
      <KPICard index={5} title="Sentimento" value={metrics.sentimentScore} icon={<Activity className="h-3.5 w-3.5" />} tone={metrics.sentimentScore >= 60 ? "green" : metrics.sentimentScore >= 40 ? "yellow" : "red"} sparkline={hist.map(h => {
        const t = h.positive + h.neutral + h.negative;
        return t > 0 ? Math.round(((h.positive - h.negative) / t + 1) * 50) : 50;
      })} />
    </div>
  );
};
