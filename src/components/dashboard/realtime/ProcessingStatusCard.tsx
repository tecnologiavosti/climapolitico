import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Cpu, AlertCircle, Copy, ShieldAlert } from "lucide-react";
import type { RealTimeMetrics } from "@/hooks/useRealTimeAnalytics";
import { cn } from "@/lib/utils";

interface Props {
  metrics: RealTimeMetrics | null;
}

const networkIcons: Record<string, string> = {
  Instagram: "📸", Twitter: "𝕏", "Twitter/X": "𝕏", X: "𝕏",
  Facebook: "📘", TikTok: "🎵", YouTube: "▶️", LinkedIn: "💼",
  Threads: "🧵", Reddit: "👽", Bluesky: "🦋", Telegram: "✈️", "Google News": "📰",
};

const Stat = ({ label, value, tone = "default", icon }: { label: string; value: string | number; tone?: "default" | "amber" | "red" | "muted"; icon?: React.ReactNode }) => (
  <div className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
      {icon}
      {label}
    </div>
    <div className={cn(
      "text-lg font-bold tabular-nums mt-0.5",
      tone === "amber" && "text-amber-500",
      tone === "red" && "text-red-500",
      tone === "muted" && "text-muted-foreground"
    )}>
      {typeof value === "number" ? Number(value ?? 0).toLocaleString("pt-BR") : value}
    </div>
  </div>
);

export const ProcessingStatusCard = ({ metrics }: Props) => {
  if (!metrics) {
    return (
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="py-8">
          <div className="h-24 rounded-md bg-muted/30 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const rate = metrics.processingRate;
  const rateColor =
    rate >= 90 ? "text-emerald-500" :
    rate >= 70 ? "text-amber-500" :
    "text-red-500";

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            Status do processamento
          </CardTitle>
          <span className={cn("text-sm font-bold tabular-nums", rateColor)}>{rate.toFixed(1)}%</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Processamento IA — consistência entre coletado, analisado e exibido
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="font-semibold text-foreground">{Number(metrics.processedMentions ?? 0).toLocaleString("pt-BR")}</span>
              {" / "}
              <span>{Number(metrics.totalCollected ?? 0).toLocaleString("pt-BR")}</span>
              {" analisados"}
            </span>
            <span>
              {metrics.pendingMentions > 0 && (
                <span className="text-amber-500">{Number(metrics.pendingMentions ?? 0).toLocaleString("pt-BR")} pendentes</span>
              )}
            </span>
          </div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            <Progress value={rate} className="h-2" />
          </motion.div>
        </div>

        {/* Metric grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="Coletados" value={metrics.totalCollected} />
          <Stat label="Processados" value={metrics.processedMentions} />
          <Stat label="Pendentes" value={metrics.pendingMentions} tone="amber" icon={<AlertCircle className="h-3 w-3" />} />
          <Stat label="Baixa confiança" value={metrics.lowConfidenceMentions} tone="muted" icon={<ShieldAlert className="h-3 w-3" />} />
          <Stat label="Duplicados" value={metrics.duplicateMentions} tone="muted" icon={<Copy className="h-3 w-3" />} />
        </div>

        {/* Source breakdown */}
        {metrics.sourceBreakdown.length > 0 && (
          <div className="pt-3 border-t border-border/40 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Por fonte (analisados / coletados)
              </p>
              <p className="text-[10px] text-muted-foreground">
                Identifica fontes sub-processadas
              </p>
            </div>
            <div className="space-y-1.5">
              {metrics.sourceBreakdown.map((s) => {
                const pct = s.collected > 0 ? (s.processed / s.collected) * 100 : 0;
                const color = pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
                return (
                  <div key={s.network} className="flex items-center gap-3 text-xs">
                    <div className="w-28 shrink-0 flex items-center gap-1.5 text-muted-foreground">
                      <span className="text-sm">{networkIcons[s.network] ?? "•"}</span>
                      <span className="truncate">{s.network}</span>
                    </div>
                    <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className={cn("h-full", color)}
                      />
                    </div>
                    <div className="w-32 shrink-0 text-right tabular-nums">
                      <span className="font-semibold text-foreground">{Number(s.processed ?? 0).toLocaleString("pt-BR")}</span>
                      <span className="text-muted-foreground"> / {Number(s.collected ?? 0).toLocaleString("pt-BR")}</span>
                      {s.pending > 0 && (
                        <span className="ml-1.5 text-[10px] text-amber-500">+{s.pending}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/70 italic">
          Comentários pendentes ou não classificados não entram nos gráficos de sentimento, polarização ou no índice geral.
        </p>
      </CardContent>
    </Card>
  );
};
