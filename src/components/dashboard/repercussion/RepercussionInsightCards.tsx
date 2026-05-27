import { Card, CardContent } from "@/components/ui/card";
import { Flame, AlertTriangle, Heart, TrendingUp } from "lucide-react";
import type { EventRepercussionData } from "@/hooks/useEventRepercussion";

export function RepercussionInsightCards({ data }: { data: EventRepercussionData }) {
  const { insights, thresholds } = data;
  const insufficient = thresholds && !thresholds.canShowRegionInsights;
  const placeholder = insufficient ? "Dados insuficientes" : "—";

  const cards = [
    {
      icon: TrendingUp,
      label: "Assunto que mais cresceu",
      value: insufficient ? placeholder : (insights.topGrowingTheme || "—"),
      sub: insufficient ? `< ${thresholds!.strong} menções` : "",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      muted: insufficient,
    },
    {
      icon: Flame,
      label: "Região mais engajada",
      value: insufficient ? placeholder : (insights.mostEngaged?.region || "—"),
      sub: insufficient ? "" : (insights.mostEngaged ? `${insights.mostEngaged.value.toLocaleString("pt-BR")} interações` : ""),
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      muted: insufficient,
    },
    {
      icon: AlertTriangle,
      label: "Região mais crítica",
      value: insufficient ? placeholder : (insights.mostCritical?.region || "—"),
      sub: insufficient ? "" : (insights.mostCritical ? `${insights.mostCritical.acceptance}% aceitação` : ""),
      color: "text-red-400",
      bg: "bg-red-500/10",
      muted: insufficient,
    },
    {
      icon: Heart,
      label: "Região mais favorável",
      value: insufficient ? placeholder : (insights.mostFavorable?.region || "—"),
      sub: insufficient ? "" : (insights.mostFavorable ? `${insights.mostFavorable.acceptance}% aceitação` : ""),
      color: "text-green-400",
      bg: "bg-green-500/10",
      muted: insufficient,
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className={`bg-card/40 border-border/40 backdrop-blur-sm ${c.muted ? "opacity-60" : ""}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-md ${c.bg}`}>
                <c.icon className={`h-3.5 w-3.5 ${c.color}`} />
              </div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{c.label}</p>
            </div>
            <p className="text-lg font-bold leading-tight truncate">{c.value}</p>
            {c.sub && <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
