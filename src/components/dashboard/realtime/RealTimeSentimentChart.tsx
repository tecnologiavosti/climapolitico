import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RealTimeMetrics } from "@/hooks/useRealTimeAnalytics";

interface Props {
  metrics: RealTimeMetrics | null;
}

type Range = "24h" | "7d" | "30d";

const COLORS = {
  positive: "#22c55e",
  neutral: "#eab308",
  negative: "#ef4444",
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/80 bg-popover/95 backdrop-blur-md p-3 shadow-xl">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              <span className="capitalize">{p.name}</span>
            </div>
            <span className="font-semibold tabular-nums">{Number(p.value).toLocaleString("pt-BR")}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const RealTimeSentimentChart = ({ metrics }: Props) => {
  const [range, setRange] = useState<Range>("7d");

  const data = useMemo(() => {
    const h = metrics?.sentimentHistory ?? [];
    if (range === "24h") return h.slice(-12);
    if (range === "30d") return h;
    return h.slice(-7);
  }, [metrics, range]);

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-semibold">Sentimento ao longo do tempo</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Volume empilhado por classificação</p>
        </div>
        <div className="inline-flex rounded-md border border-border/70 bg-background/60 p-0.5">
          {(["24h", "7d", "30d"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded transition-all",
                range === r ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {!metrics ? (
          <div className="h-64 rounded-md bg-muted/30 animate-pulse" />
        ) : data.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
            Sem dados no período
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.positive} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={COLORS.positive} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gNeu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.neutral} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={COLORS.neutral} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gNeg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.negative} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={COLORS.negative} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
                <Area type="monotoneX" dataKey="positive" name="Positivo" stackId="1" stroke={COLORS.positive} strokeWidth={2} fill="url(#gPos)" animationDuration={600} />
                <Area type="monotoneX" dataKey="neutral" name="Neutro" stackId="1" stroke={COLORS.neutral} strokeWidth={2} fill="url(#gNeu)" animationDuration={600} />
                <Area type="monotoneX" dataKey="negative" name="Negativo" stackId="1" stroke={COLORS.negative} strokeWidth={2} fill="url(#gNeg)" animationDuration={600} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {/* Estatísticas adicionais */}
        {metrics && metrics.totalMentions > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 pt-4 border-t border-border/40">
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Taxa de polarização</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">{metrics.polarizationRate}%</span>
                <span className="text-[10px] text-muted-foreground">
                  {metrics.lowConfidenceMentions > 0 && `${metrics.lowConfidenceMentions} baixa conf.`}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500" style={{ width: `${metrics.polarizationRate}%` }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Engajamento por sentimento</p>
              <div className="space-y-0.5 text-xs">
                <div className="flex justify-between"><span className="text-emerald-500">❤️ Positivos</span><span className="font-semibold tabular-nums">{metrics.engagementBySentiment.positive.toLocaleString("pt-BR")}</span></div>
                <div className="flex justify-between"><span className="text-amber-500">💬 Neutros</span><span className="font-semibold tabular-nums">{metrics.engagementBySentiment.neutral.toLocaleString("pt-BR")}</span></div>
                <div className="flex justify-between"><span className="text-red-500">⚠️ Negativos</span><span className="font-semibold tabular-nums">{metrics.engagementBySentiment.negative.toLocaleString("pt-BR")}</span></div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
