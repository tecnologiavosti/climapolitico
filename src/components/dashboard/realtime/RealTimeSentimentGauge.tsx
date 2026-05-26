import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCountUp } from "@/hooks/useCountUp";
import type { RealTimeMetrics } from "@/hooks/useRealTimeAnalytics";

interface Props {
  metrics: RealTimeMetrics | null;
}

export const RealTimeSentimentGauge = ({ metrics }: Props) => {
  const score = metrics?.sentimentScore ?? 50;
  const animated = useCountUp(score, 900);

  const color = score >= 61 ? "#22c55e" : score >= 31 ? "#eab308" : "#ef4444";
  const label =
    score >= 75 ? "Alta aprovação" :
    score >= 61 ? "Tendência positiva" :
    score >= 41 ? "Predominância neutra" :
    score >= 25 ? "Tendência negativa" : "Alta rejeição";

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  if (!metrics) {
    return (
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base">Sentimento geral</CardTitle></CardHeader>
        <CardContent><div className="h-52 rounded-md bg-muted/30 animate-pulse" /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Sentimento geral</CardTitle>
        <p className="text-xs text-muted-foreground">Índice consolidado (0–100)</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-2">
          <div className="relative h-44 w-44">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 160 160">
              <circle cx="80" cy="80" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" opacity={0.4} />
              <motion.circle
                cx="80" cy="80" r={radius} fill="none"
                stroke={color} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 1.1, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-bold tabular-nums tracking-tight" style={{ color }}>{animated}</span>
              <span className="text-xs text-muted-foreground mt-1">de 100</span>
            </div>
          </div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            <span className="text-sm font-medium">{label}</span>
          </div>
          <div className="mt-3 flex w-full justify-between px-4 text-[10px] text-muted-foreground">
            <span>Negativo</span>
            <span>Neutro</span>
            <span>Positivo</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
