import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BR_STATES_MAP } from "@/data/brStatesMap";
import { UFS, UF_NAME, type UF } from "@/lib/brazilStatesInference";
import { NETWORKS, ALL_NETWORKS_VALUE } from "@/pages/dashboard/regionalAnalysis.helpers";

interface Props {
  userId: string;
  candidateId: string;
  network: string;
}

interface UFAgg {
  uf: UF;
  mentions: number;
  positive_percentage: number;
  negative_percentage: number;
}

// ─── Cache simples em memória: regional:{candidateId}:{network} (TTL 5 min) ───
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ts: number; data: Record<UF, UFAgg> }>();

function colorFor(a: UFAgg | undefined): string {
  if (!a || a.mentions < 3) return "hsl(220, 13%, 88%)";
  const acc = a.positive_percentage ?? 0;
  if (acc + a.negative_percentage === 0) return "hsl(220, 13%, 80%)";
  if (acc > 65) return "hsl(142, 70%, 45%)";
  if (acc >= 35) return "hsl(45, 95%, 55%)";
  return "hsl(0, 75%, 55%)";
}

export default function BrazilStateMap({ userId, candidateId, network }: Props) {
  const [loading, setLoading] = useState(false);
  const [aggs, setAggs] = useState<Record<UF, UFAgg>>({} as Record<UF, UFAgg>);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !candidateId) return;

    const isAll = network === ALL_NETWORKS_VALUE;
    const netCfg = isAll ? null : NETWORKS.find((n) => n.label === network);
    const netValues = netCfg ? netCfg.values : null;
    const cacheKey = `regional:${candidateId}:${network}`;

    // Cache hit → render instantâneo (<50ms)
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      setAggs(cached.data);
      setLoading(false);
      return () => { cancelled = true; };
    }

    // Mostra último cache válido (mesmo expirado) enquanto recarrega
    if (cached) setAggs(cached.data);
    setLoading(!cached);

    (async () => {
      // Timeout defensivo
      const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error("timeout") }), 12_000),
      );

      try {
        const call = supabase.rpc("get_regional_state_aggregates", {
          p_user_id: userId,
          p_candidate_id: candidateId,
          p_networks: netValues,
        });

        const result = (await Promise.race([call, timeout])) as { data: any[] | null; error: any };
        if (cancelled) return;

        if (result.error || !result.data) {
          console.error("[BrazilStateMap]", result.error);
          // Em timeout/erro mantém o último cache válido se houver
          return;
        }

        const acc = {} as Record<UF, UFAgg>;
        for (const uf of UFS) {
          acc[uf] = { uf, mentions: 0, positive_percentage: 0, negative_percentage: 0 };
        }
        for (const row of result.data as Array<{
          state: string;
          mentions: number;
          positive_percentage: number | null;
          negative_percentage: number | null;
        }>) {
          const uf = (row.state || "").toUpperCase() as UF;
          if (!UFS.includes(uf)) continue;
          acc[uf] = {
            uf,
            mentions: Number(row.mentions ?? 0),
            positive_percentage: Number(row.positive_percentage ?? 0),
            negative_percentage: Number(row.negative_percentage ?? 0),
          };
        }
        cache.set(cacheKey, { ts: Date.now(), data: acc });
        if (!cancelled) setAggs(acc);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, candidateId, network]);

  const ranking = useMemo(() => {
    return (Object.values(aggs) as UFAgg[])
      .filter((a) => a.mentions > 0)
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 10);
  }, [aggs]);

  const totalIdentified = useMemo(
    () => (Object.values(aggs) as UFAgg[]).reduce((s, a) => s + a.mentions, 0),
    [aggs],
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Mapa por estado
          </CardTitle>
          <CardDescription>
            Distribuição agregada de menções por UF. Passe o mouse para ver os percentuais.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {loading && totalIdentified === 0 ? (
          <Skeleton className="h-[420px] w-full" />
        ) : totalIdentified === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma localização (UF) foi identificada para esta combinação.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3">
              <TooltipProvider delayDuration={120}>
                <div className="w-full flex justify-center">
                  <svg
                    viewBox={BR_STATES_MAP.viewBox}
                    className="w-full max-w-lg h-auto"
                    role="img"
                    aria-label="Mapa do Brasil por estado"
                  >
                    {(Object.entries(BR_STATES_MAP.states) as [UF, { path: string; cx: number; cy: number }][])
                      .map(([code, geom]) => {
                        const a = aggs[code];
                        const fill = colorFor(a);
                        return (
                          <Tooltip key={code}>
                            <TooltipTrigger asChild>
                              <g>
                                <path
                                  d={geom.path}
                                  fill={fill}
                                  stroke="hsl(var(--background))"
                                  strokeWidth={0.8}
                                  className="transition-all hover:opacity-80"
                                />
                                <text
                                  x={geom.cx}
                                  y={geom.cy}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  className="fill-white font-bold pointer-events-none"
                                  style={{
                                    fontSize: 11,
                                    paintOrder: "stroke",
                                    stroke: "rgba(0,0,0,0.6)",
                                    strokeWidth: 2.5,
                                    strokeLinejoin: "round",
                                  }}
                                >
                                  {code}
                                </text>
                              </g>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm space-y-0.5">
                                <div className="font-semibold">{UF_NAME[code]} ({code})</div>
                                {a && a.mentions > 0 ? (
                                  <>
                                    <div>Menções: {a.mentions.toLocaleString("pt-BR")}</div>
                                    <div className="text-green-600">{a.positive_percentage}% aceitação</div>
                                    <div className="text-red-600">{a.negative_percentage}% rejeição</div>
                                  </>
                                ) : (
                                  <div className="text-muted-foreground">Sem dados</div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                  </svg>
                </div>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Mapa esquemático. Cores indicam aceitação (verde &gt;65%, amarelo 35-65%, vermelho &lt;35%).
                </p>
              </TooltipProvider>
            </div>

            <div className="lg:col-span-2 space-y-2">
              <h4 className="text-sm font-semibold mb-2">Top estados por menções</h4>
              {ranking.map((a) => (
                <div
                  key={a.uf}
                  className="w-full text-left rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{a.uf} · {UF_NAME[a.uf]}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.mentions.toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {a.positive_percentage + a.negative_percentage > 0 ? (
                    <>
                      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                        <div className="bg-green-500" style={{ width: `${a.positive_percentage}%` }} />
                        <div className="bg-red-500" style={{ width: `${a.negative_percentage}%` }} />
                      </div>
                      <div className="flex justify-between text-[11px] mt-1">
                        <span className="text-green-600">{a.positive_percentage}% aceitação</span>
                        <span className="text-red-600">{a.negative_percentage}% rejeição</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px] text-muted-foreground italic">Sem opiniões classificadas</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
