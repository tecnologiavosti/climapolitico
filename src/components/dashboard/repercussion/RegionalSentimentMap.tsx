import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventRepercussionData, RegionData } from "@/hooks/useEventRepercussion";
import { Badge } from "@/components/ui/badge";

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];

function colorFor(r: RegionData): string {
  switch (r.sentiment_class) {
    case "positive": return "hsl(142, 70%, 45%)";
    case "negative": return "hsl(0, 75%, 55%)";
    case "mixed": return "hsl(45, 95%, 55%)";
    default: return "hsl(220, 13%, 30%)";
  }
}

const REGION_POS: Record<string, { x: number; y: number }> = {
  Norte: { x: 35, y: 25 },
  Nordeste: { x: 70, y: 30 },
  "Centro-Oeste": { x: 45, y: 55 },
  Sudeste: { x: 60, y: 70 },
  Sul: { x: 50, y: 88 },
};

interface Props {
  data: EventRepercussionData;
  selected: string | null;
  onSelect: (r: string | null) => void;
}

export function RegionalSentimentMap({ data, selected, onSelect }: Props) {
  return (
    <Card className="bg-card/40 border-border/40 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">Mapa de Repercussão por Região</CardTitle>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(142,70%,45%)" }} /> Positiva</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(45,95%,55%)" }} /> Equilibrada</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(0,75%,55%)" }} /> Negativa</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(220,13%,30%)" }} /> Sem dados</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="relative aspect-square bg-background/40 rounded-lg border border-border/40 overflow-hidden">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              {REGIONS.map((r) => {
                const region = data.regions[r];
                const pos = REGION_POS[r];
                const isSel = selected === r;
                const radius = Math.max(6, Math.min(14, 5 + Math.log10(Math.max(1, region.mentions)) * 3));
                return (
                  <g key={r} onClick={() => onSelect(isSel ? null : r)} className="cursor-pointer">
                    <circle
                      cx={pos.x} cy={pos.y} r={radius}
                      fill={colorFor(region)}
                      stroke={isSel ? "white" : "rgba(255,255,255,0.3)"}
                      strokeWidth={isSel ? 1.2 : 0.4}
                      opacity={0.85}
                    />
                    <text x={pos.x} y={pos.y + radius + 4} textAnchor="middle" fontSize="3.5" fill="currentColor" className="font-medium">
                      {r}
                    </text>
                    <text x={pos.x} y={pos.y + 1.2} textAnchor="middle" fontSize="3" fill="white" className="font-bold">
                      {region.mentions.toLocaleString("pt-BR")}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="space-y-2">
            {REGIONS.map((r) => {
              const region = data.regions[r];
              const isSel = selected === r;
              return (
                <button
                  key={r}
                  onClick={() => onSelect(isSel ? null : r)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${isSel ? "border-primary bg-primary/10" : "border-border/40 bg-background/30 hover:border-primary/40"}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(region) }} />
                      <span className="font-medium text-sm">{r}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{region.mentions.toLocaleString("pt-BR")} menções</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground text-[10px]">Aceitação</p>
                      <p className="font-semibold">{region.sentiment_class === "insufficient" ? "—" : `${region.acceptance}%`}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-[10px]">Engajamento</p>
                      <p className="font-semibold">{region.engagement.toLocaleString("pt-BR")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-[10px]">Pos/Neg</p>
                      <p className="font-semibold text-[11px]">
                        <span className="text-green-400">{region.positive}</span> / <span className="text-red-400">{region.negative}</span>
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
