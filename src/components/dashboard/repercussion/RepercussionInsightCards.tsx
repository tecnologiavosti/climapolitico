import { Card, CardContent } from "@/components/ui/card";
import { Flame, AlertTriangle, Heart, TrendingUp } from "lucide-react";
import type { EventRepercussionData } from "@/hooks/useEventRepercussion";

export function RepercussionInsightCards({ data }: { data: EventRepercussionData }) {
  const { insights } = data;
  const cards = [
    {
      icon: TrendingUp,
      label: "Assunto que mais cresceu",
      value: insights.topGrowingTheme || "—",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      icon: Flame,
      label: "Região mais engajada",
      value: insights.mostEngaged?.region || "—",
      sub: insights.mostEngaged ? `${insights.mostEngaged.value.toLocaleString("pt-BR")} interações` : "",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    },
    {
      icon: AlertTriangle,
      label: "Região mais crítica",
      value: insights.mostCritical?.region || "—",
      sub: insights.mostCritical ? `${insights.mostCritical.acceptance}% aceitação` : "",
      color: "text-red-400",
      bg: "bg-red-500/10",
    },
    {
      icon: Heart,
      label: "Região mais favorável",
      value: insights.mostFavorable?.region || "—",
      sub: insights.mostFavorable ? `${insights.mostFavorable.acceptance}% aceitação` : "",
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="bg-card/40 border-border/40 backdrop-blur-sm">
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
