import { Card, CardContent } from "@/components/ui/card";
import { Newspaper, Users, TrendingUp, Globe2 } from "lucide-react";
import type { EventRepercussionData } from "@/hooks/useEventRepercussion";

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function RepercussionInsightCards({ data }: { data: EventRepercussionData }) {
  const ext = data.externalRepercussion;
  const topRegion = Object.entries(ext.regionalDistribution).sort((a, b) => b[1] - a[1])[0];
  const dominantSignal =
    ext.positiveSignals >= ext.negativeSignals && ext.positiveSignals >= ext.neutralSignals ? { label: "Positiva", value: ext.positiveSignals, color: "text-green-400", bg: "bg-green-500/10" }
    : ext.negativeSignals >= ext.neutralSignals ? { label: "Negativa", value: ext.negativeSignals, color: "text-red-400", bg: "bg-red-500/10" }
    : { label: "Neutra", value: ext.neutralSignals, color: "text-amber-400", bg: "bg-amber-500/10" };

  const cards = [
    {
      icon: Newspaper,
      label: "Publicações externas",
      value: ext.totalPublications.toLocaleString("pt-BR"),
      sub: `${Object.keys(data.debug.sourcesByOutlet).length} veículos distintos`,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      icon: Users,
      label: "Alcance estimado",
      value: formatReach(ext.estimatedReach),
      sub: "pessoas potencialmente atingidas",
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      icon: TrendingUp,
      label: "Repercussão dominante",
      value: dominantSignal.label,
      sub: `${dominantSignal.value}% dos sinais`,
      color: dominantSignal.color,
      bg: dominantSignal.bg,
    },
    {
      icon: Globe2,
      label: "Região com mais cobertura",
      value: topRegion?.[0] || "—",
      sub: topRegion ? `${topRegion[1]}% das publicações` : "",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
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
