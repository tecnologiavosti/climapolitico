import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BR_STATES_MAP } from "@/data/brStatesMap";
import { UF_NAME, type UF } from "@/lib/brazilStatesInference";
import type { EventRepercussionData, RegionalDistribution } from "@/hooks/useEventRepercussion";
import { Sparkles } from "lucide-react";

const UF_TO_REGION: Record<UF, keyof RegionalDistribution> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

const REGIONS: (keyof RegionalDistribution)[] = ["Sudeste", "Nordeste", "Sul", "Centro-Oeste", "Norte"];

function colorForPercent(p: number): string {
  if (p <= 0) return "hsl(220, 13%, 22%)";
  if (p < 5) return "hsl(220, 25%, 35%)";
  if (p < 12) return "hsl(210, 60%, 45%)";
  if (p < 20) return "hsl(200, 70%, 50%)";
  if (p < 30) return "hsl(190, 80%, 50%)";
  return "hsl(170, 85%, 45%)";
}

interface Props {
  data: EventRepercussionData;
  selected: string | null;
  onSelect: (r: string | null) => void;
}

export function RegionalSentimentMap({ data, selected, onSelect }: Props) {
  const dist = data.externalRepercussion.regionalDistribution;
  const ufList = Object.keys(BR_STATES_MAP.states) as UF[];

  return (
    <div className="space-y-4">
      <Card className="bg-card/40 border-border/40 backdrop-blur-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <CardTitle className="text-sm sm:text-base">Distribuição regional da cobertura externa</CardTitle>
            <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] flex-wrap">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForPercent(30) }} />Muito alta</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForPercent(15) }} />Alta</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForPercent(7) }} />Média</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForPercent(2) }} />Baixa</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorForPercent(0) }} />Sem dados</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
            <div className="relative bg-background/30 rounded-xl border border-border/40 p-2">
              <TooltipProvider delayDuration={80}>
                <svg viewBox={BR_STATES_MAP.viewBox} className="w-full h-auto" role="img" aria-label="Mapa do Brasil — repercussão externa">
                  {ufList.map((uf) => {
                    const geom = BR_STATES_MAP.states[uf];
                    const region = UF_TO_REGION[uf];
                    const pct = dist[region] || 0;
                    const fill = colorForPercent(pct);
                    const isSel = selected === region;
                    return (
                      <Tooltip key={uf}>
                        <TooltipTrigger asChild>
                          <g onClick={() => onSelect(isSel ? null : region)} className="cursor-pointer">
                            <path
                              d={geom.path}
                              fill={fill}
                              stroke={isSel ? "white" : "hsl(220 13% 12%)"}
                              strokeWidth={isSel ? 1.4 : 0.6}
                              className="transition-all duration-150 hover:brightness-125"
                            />
                            <text
                              x={geom.cx} y={geom.cy} textAnchor="middle" dominantBaseline="middle"
                              className="fill-white pointer-events-none font-bold"
                              style={{ fontSize: 11, paintOrder: "stroke", stroke: "rgba(0,0,0,0.65)", strokeWidth: 2.5, strokeLinejoin: "round" }}
                            >
                              {uf}
                            </text>
                          </g>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <div className="text-xs">
                            <div className="font-semibold">{UF_NAME[uf]} ({uf})</div>
                            <div className="text-muted-foreground">{region} • {pct}% da cobertura</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </svg>
              </TooltipProvider>
              <p className="text-[10px] text-muted-foreground text-center mt-1">Distribuição inferida a partir da origem dos veículos e menções regionais nas matérias.</p>
            </div>

            <div className="space-y-2">
              {REGIONS.map((r) => {
                const pct = dist[r] || 0;
                const isSel = selected === r;
                return (
                  <button
                    key={r}
                    onClick={() => onSelect(isSel ? null : r)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${isSel ? "border-primary bg-primary/10" : "border-border/40 bg-background/30 hover:border-primary/40"}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorForPercent(pct) }} />
                        <span className="font-medium text-sm">{r}</span>
                      </div>
                      <span className="text-sm font-bold tabular-nums">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-background/60 rounded-full overflow-hidden">
                      <div className="h-full transition-all" style={{ width: `${pct}%`, background: colorForPercent(pct) }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {data.externalRepercussion.aiAvailable && data.externalRepercussion.summary && (
        <Card className="bg-gradient-to-br from-primary/5 to-primary/0 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Resumo da repercussão nacional</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">{data.externalRepercussion.summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
