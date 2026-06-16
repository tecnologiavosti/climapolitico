import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MapPin } from "lucide-react";
import { BR_STATES_MAP } from "@/data/brStatesMap";
import { UFS, UF_NAME, type UF } from "@/lib/brazilStatesInference";

interface CacheRow {
  mentions: number;
  positive: number;
  negative: number;
  neutral: number;
  avg_engagement: number;
}

interface Props {
  loading?: boolean;
  byState: Map<UF, CacheRow>;
  selectedUF: UF | null;
  onSelect: (uf: UF) => void;
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function colorFor(row: CacheRow | undefined) {
  if (!row || row.mentions < 5) return "hsl(220, 13%, 88%)";
  const opin = row.positive + row.negative;
  if (opin === 0) return "hsl(220, 13%, 80%)";
  const acc = (row.positive / opin) * 100;
  if (acc > 65) return "hsl(142, 70%, 45%)";
  if (acc >= 35) return "hsl(45, 95%, 55%)";
  return "hsl(0, 75%, 55%)";
}

export default function BrazilStateMap({ loading, byState, selectedUF, onSelect }: Props) {
  const ranking = useMemo(
    () => (Array.from(byState.entries()) as [UF, CacheRow][])
      .filter(([, r]) => r.mentions > 0)
      .sort(([, a], [, b]) => b.mentions - a.mentions)
      .slice(0, 10),
    [byState],
  );

  const totalIdentified = useMemo(
    () => Array.from(byState.values()).reduce((s, r) => s + r.mentions, 0),
    [byState],
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Mapa por Estado
          </CardTitle>
          <CardDescription>
            Clique em uma UF para ver as métricas no painel abaixo. Mapa estático, sem coleta de comentários.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : totalIdentified === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma UF identificada ainda. Clique em "Atualizar agora" para rodar a inferência.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3">
              <TooltipProvider delayDuration={120}>
                <div className="w-full flex justify-center">
                  <svg viewBox={BR_STATES_MAP.viewBox} className="w-full max-w-lg h-auto"
                       role="img" aria-label="Mapa do Brasil por estado">
                    {(Object.entries(BR_STATES_MAP.states) as [UF, { path: string; cx: number; cy: number }][]).map(([code, geom]) => {
                      const row = byState.get(code);
                      const hasData = !!row && row.mentions > 0;
                      const fill = colorFor(row);
                      const selected = selectedUF === code;
                      return (
                        <Tooltip key={code}>
                          <TooltipTrigger asChild>
                            <g onClick={() => hasData && onSelect(code)}
                               className={hasData ? "cursor-pointer" : "cursor-not-allowed"}>
                              <path d={geom.path} fill={fill}
                                stroke={selected ? "hsl(var(--primary))" : "hsl(var(--background))"}
                                strokeWidth={selected ? 2 : 0.8}
                                className="transition-all hover:opacity-80" />
                              <text x={geom.cx} y={geom.cy} textAnchor="middle" dominantBaseline="middle"
                                className="fill-white font-bold pointer-events-none"
                                style={{ fontSize: 11, paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 2.5, strokeLinejoin: "round" }}>
                                {code}
                              </text>
                            </g>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-sm space-y-0.5">
                              <div className="font-semibold">{UF_NAME[code]} ({code})</div>
                              {hasData ? (
                                <>
                                  <div>Menções: {row!.mentions.toLocaleString("pt-BR")}</div>
                                  <div className="text-green-600">+ {row!.positive} positivos ({pct(row!.positive, row!.mentions)}%)</div>
                                  <div className="text-red-600">- {row!.negative} negativos ({pct(row!.negative, row!.mentions)}%)</div>
                                  <div className="text-muted-foreground">= {row!.neutral} neutros ({pct(row!.neutral, row!.mentions)}%)</div>
                                  <div className="text-xs text-muted-foreground">Eng. médio: {row!.avg_engagement}</div>
                                </>
                              ) : (
                                <div className="text-muted-foreground">Sem dados identificados</div>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </svg>
                </div>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Cores: verde &gt;65% aceitação, amarelo 35-65%, vermelho &lt;35%.
                </p>
              </TooltipProvider>
            </div>

            <div className="lg:col-span-2 space-y-2">
              <h4 className="text-sm font-semibold mb-2">Top estados por menções</h4>
              {ranking.map(([uf, r]) => {
                const opin = r.positive + r.negative;
                const posPct = pct(r.positive, opin);
                const selected = selectedUF === uf;
                return (
                  <button key={uf} onClick={() => onSelect(uf)}
                    className={`w-full text-left rounded-lg border p-3 transition-all hover:border-primary/60 ${selected ? "border-primary bg-primary/5" : ""}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{uf} · {UF_NAME[uf]}</span>
                      <span className="text-xs text-muted-foreground">{r.mentions.toLocaleString("pt-BR")}</span>
                    </div>
                    {opin >= 3 ? (
                      <>
                        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                          <div className="bg-green-500" style={{ width: `${posPct}%` }} />
                          <div className="bg-red-500" style={{ width: `${100 - posPct}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] mt-1">
                          <span className="text-green-600">{posPct}% aceitação</span>
                          <span className="text-red-600">{Math.round((100 - posPct) * 10) / 10}% rejeição</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-muted-foreground italic">Poucas opiniões</div>
                    )}
                  </button>
                );
              })}
              <p className="text-[11px] text-muted-foreground pt-1">
                Total de {UFS.length} UFs · {Array.from(byState.values()).filter(r => r.mentions > 0).length} com dados.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
