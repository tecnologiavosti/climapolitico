import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BR_STATES_MAP } from "@/data/brStatesMap";
import { UF_NAME, type UF } from "@/lib/brazilStatesInference";
import type { EventRepercussionData, StateData, RegionData } from "@/hooks/useEventRepercussion";

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];

function colorForState(s?: StateData): string {
  if (!s || s.mentions === 0) return "hsl(220, 13%, 22%)"; // gray = no data
  switch (s.sentiment_class) {
    case "very_positive": return "hsl(142, 75%, 38%)";
    case "positive":      return "hsl(142, 65%, 52%)";
    case "mixed":         return "hsl(45, 95%, 55%)";
    case "negative":      return "hsl(20, 80%, 55%)";
    case "very_negative": return "hsl(0, 78%, 50%)";
    default:              return "hsl(220, 13%, 32%)";
  }
}

function colorForRegion(r?: RegionData): string {
  if (!r || r.mentions === 0) return "hsl(220, 13%, 22%)";
  switch (r.sentiment_class) {
    case "positive": return "hsl(142, 70%, 45%)";
    case "negative": return "hsl(0, 75%, 55%)";
    case "mixed":    return "hsl(45, 95%, 55%)";
    default:         return "hsl(220, 13%, 32%)";
  }
}

interface Props {
  data: EventRepercussionData;
  selected: string | null; // region name
  onSelect: (r: string | null) => void;
}

export function RegionalSentimentMap({ data, selected, onSelect }: Props) {
  const [hoverUF, setHoverUF] = useState<UF | null>(null);

  const ufList = useMemo(() => Object.keys(BR_STATES_MAP.states) as UF[], []);

  return (
    <div className="space-y-4">
      <Card className="bg-card/40 border-border/40 backdrop-blur-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Mapa de repercussão por estado</CardTitle>
            <div className="flex items-center gap-2 text-[11px] flex-wrap">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(142,75%,38%)" }} />Muito positivo</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(142,65%,52%)" }} />Positivo</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(45,95%,55%)" }} />Equilibrado</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(20,80%,55%)" }} />Negativo</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(0,78%,50%)" }} />Muito negativo</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(220,13%,22%)" }} />Sem dados</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
            {/* Real Brazil SVG */}
            <div className="relative bg-background/30 rounded-xl border border-border/40 p-2">
              <TooltipProvider delayDuration={80}>
                <svg
                  viewBox={BR_STATES_MAP.viewBox}
                  className="w-full h-auto"
                  role="img"
                  aria-label="Mapa do Brasil — repercussão do evento por estado"
                >
                  {ufList.map((uf) => {
                    const geom = BR_STATES_MAP.states[uf];
                    const st = data.states?.[uf];
                    const fill = colorForState(st);
                    const isHover = hoverUF === uf;
                    const isSel = selected && st && st.region === selected;
                    return (
                      <Tooltip key={uf}>
                        <TooltipTrigger asChild>
                          <g
                            onMouseEnter={() => setHoverUF(uf)}
                            onMouseLeave={() => setHoverUF(null)}
                            onClick={() => st && onSelect(st.region === selected ? null : st.region)}
                            className="cursor-pointer"
                          >
                            <path
                              d={geom.path}
                              fill={fill}
                              stroke={isHover || isSel ? "white" : "hsl(220 13% 12%)"}
                              strokeWidth={isHover || isSel ? 1.4 : 0.6}
                              className="transition-all duration-150"
                              style={{ filter: isHover ? "brightness(1.2)" : undefined }}
                            />
                            <text
                              x={geom.cx}
                              y={geom.cy}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              className="fill-white pointer-events-none font-bold"
                              style={{
                                fontSize: 11,
                                paintOrder: "stroke",
                                stroke: "rgba(0,0,0,0.65)",
                                strokeWidth: 2.5,
                                strokeLinejoin: "round",
                              }}
                            >
                              {uf}
                            </text>
                          </g>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <div className="space-y-1">
                            <div className="font-semibold text-sm">{UF_NAME[uf]} ({uf})</div>
                            {st && st.mentions > 0 ? (
                              <>
                                <div className="text-xs">{st.mentions.toLocaleString("pt-BR")} menções</div>
                                <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
                                  <span className="text-green-400">+{st.positive}</span>
                                  <span className="text-red-400">−{st.negative}</span>
                                  <span className="text-muted-foreground">={st.neutral}</span>
                                </div>
                                <div className="text-[11px]">
                                  Aceitação: <span className="font-semibold">{st.positive + st.negative >= 2 ? `${st.acceptance}%` : "—"}</span>
                                </div>
                                <div className="text-[11px]">Engajamento: {st.engagement.toLocaleString("pt-BR")}</div>
                                {st.topWords.length > 0 && (
                                  <div className="text-[11px] text-muted-foreground pt-1">
                                    Temas: {st.topWords.slice(0, 4).join(", ")}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-xs text-muted-foreground">Sem dados para este evento.</div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </svg>
              </TooltipProvider>
              <p className="text-[10px] text-muted-foreground text-center mt-1">
                Passe o mouse sobre um estado para ver detalhes. Clique para filtrar a região.
              </p>
            </div>

            {/* Region summary cards */}
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
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorForRegion(region) }} />
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

      {/* AI summary card under the map */}
      {data.insights.aiAvailable && data.insights.aiSummary && (
        <Card className="bg-gradient-to-br from-primary/5 to-primary/0 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Análise IA da repercussão
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
              {data.insights.aiSummary}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
