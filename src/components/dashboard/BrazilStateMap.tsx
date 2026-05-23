import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MapPin, MessageSquare, ThumbsUp, ThumbsDown, Minus, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brazilStates } from "@/lib/brazilMapSvg";
import { UFS, UF_NAME, inferLocation, type UF } from "@/lib/brazilStatesInference";
import { NETWORKS, ALL_NETWORKS_VALUE } from "@/pages/dashboard/regionalAnalysis.helpers";

interface Props {
  userId: string;
  candidateId: string;
  network: string; // ALL_NETWORKS_VALUE | label
}

interface Row {
  id: string;
  comment_text: string | null;
  comment_author: string | null;
  sentiment_label: string | null;
  social_network: string;
  created_at: string;
}

interface UFAgg {
  uf: UF;
  total: number;
  pos: number;
  neg: number;
  neu: number;
  cities: Map<string, { total: number; pos: number; neg: number; neu: number }>;
  samples: Row[]; // até 30 mais recentes
}

function colorFor(total: number, pos: number, neg: number): string {
  if (total < 3) return "hsl(var(--muted))";
  const opin = pos + neg;
  if (opin === 0) return "hsl(220, 13%, 80%)";
  const acc = (pos / opin) * 100;
  if (acc > 65) return "hsl(142, 70%, 45%)";
  if (acc >= 35) return "hsl(45, 95%, 55%)";
  return "hsl(0, 75%, 55%)";
}

function sentimentKey(s: string | null): "pos" | "neg" | "neu" {
  const k = (s || "").toLowerCase();
  if (k === "positive" || k === "positivo") return "pos";
  if (k === "negative" || k === "negativo") return "neg";
  return "neu";
}

export default function BrazilStateMap({ userId, candidateId, network }: Props) {
  const [loading, setLoading] = useState(false);
  const [aggs, setAggs] = useState<Record<UF, UFAgg>>({} as Record<UF, UFAgg>);
  const [totalScanned, setTotalScanned] = useState(0);
  const [identified, setIdentified] = useState(0);
  const [openUF, setOpenUF] = useState<UF | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !candidateId) return;
    (async () => {
      setLoading(true);
      try {
        const isAll = network === ALL_NETWORKS_VALUE;
        const netCfg = isAll ? null : NETWORKS.find((n) => n.label === network);
        const netValues = netCfg ? netCfg.values : null;

        const PAGE = 1000;
        const HARD_CAP = 10000;
        let from = 0;
        const rows: Row[] = [];
        while (rows.length < HARD_CAP) {
          let q = supabase
            .from("social_interactions")
            .select("id, comment_text, comment_author, sentiment_label, social_network, created_at")
            .eq("user_id", userId)
            .eq("candidate_id", candidateId)
            .not("comment_text", "is", null)
            .not("social_network", "in", "(mastodon,lemmy,pinterest)")
            .order("created_at", { ascending: false })
            .range(from, from + PAGE - 1);
          if (netValues) q = q.in("social_network", netValues);
          const { data, error } = await q;
          if (error) throw error;
          if (!data || data.length === 0) break;
          rows.push(...(data as Row[]));
          if (data.length < PAGE) break;
          from += PAGE;
        }

        if (cancelled) return;

        const acc = {} as Record<UF, UFAgg>;
        for (const uf of UFS) {
          acc[uf] = {
            uf,
            total: 0, pos: 0, neg: 0, neu: 0,
            cities: new Map(),
            samples: [],
          };
        }
        let id = 0;
        for (const r of rows) {
          const { uf, city } = inferLocation(r.comment_text, r.comment_author);
          if (!uf) continue;
          id++;
          const a = acc[uf];
          const k = sentimentKey(r.sentiment_label);
          a.total++;
          a[k]++;
          const cityKey = city || "Não identificada";
          const c = a.cities.get(cityKey) || { total: 0, pos: 0, neg: 0, neu: 0 };
          c.total++;
          c[k]++;
          a.cities.set(cityKey, c);
          if (a.samples.length < 30) a.samples.push(r);
        }

        if (!cancelled) {
          setAggs(acc);
          setTotalScanned(rows.length);
          setIdentified(id);
        }
      } catch (e) {
        console.error("[BrazilStateMap]", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, candidateId, network]);

  const ranking = useMemo(() => {
    return (Object.values(aggs) as UFAgg[])
      .filter((a) => a.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [aggs]);

  const current = openUF ? aggs[openUF] : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Mapa por estado (UF) e cidade
            </CardTitle>
            <CardDescription>
              Clique em uma UF para ver as cidades e comentários identificados naquele estado.
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary">
              <MessageSquare className="h-3 w-3 mr-1" />
              {totalScanned.toLocaleString("pt-BR")} comentários
            </Badge>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-help">
                    <Info className="h-3 w-3 mr-1" />
                    {identified.toLocaleString("pt-BR")} com localização identificada
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Identificamos a UF/cidade pelo conteúdo do comentário ou nome do autor
                  (capitais, grandes cidades, nomes de estado e siglas). Comentários sem
                  pistas geográficas explícitas não aparecem no mapa.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : identified === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma localização (UF/cidade) foi identificada nos comentários desta combinação.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Mapa SVG */}
            <div className="lg:col-span-3">
              <TooltipProvider delayDuration={120}>
                <div className="w-full flex justify-center">
                  <svg
                    viewBox="0 0 600 650"
                    className="w-full max-w-lg h-auto"
                    role="img"
                    aria-label="Mapa do Brasil por estado"
                  >
                    {brazilStates.map((s) => {
                      const a = aggs[s.code as UF];
                      const fill = a ? colorFor(a.total, a.pos, a.neg) : "hsl(var(--muted))";
                      const hasData = a && a.total > 0;
                      return (
                        <Tooltip key={s.code}>
                          <TooltipTrigger asChild>
                            <g
                              onClick={() => hasData && setOpenUF(s.code as UF)}
                              className={hasData ? "cursor-pointer" : "cursor-not-allowed opacity-60"}
                            >
                              <path
                                d={s.path}
                                fill={fill}
                                stroke="hsl(var(--background))"
                                strokeWidth={1.5}
                                className="transition-all hover:opacity-80"
                              />
                              <text
                                x={parsePathCenter(s.path).x}
                                y={parsePathCenter(s.path).y}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="fill-white font-bold pointer-events-none"
                                style={{
                                  fontSize: 11,
                                  paintOrder: "stroke",
                                  stroke: "rgba(0,0,0,0.55)",
                                  strokeWidth: 2.5,
                                  strokeLinejoin: "round",
                                }}
                              >
                                {s.code}
                              </text>
                            </g>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-sm space-y-0.5">
                              <div className="font-semibold">{s.name} ({s.code})</div>
                              {hasData ? (
                                <>
                                  <div>Menções: {a!.total.toLocaleString("pt-BR")}</div>
                                  <div className="text-green-600">+ {a!.pos} positivos</div>
                                  <div className="text-red-600">- {a!.neg} negativos</div>
                                  <div className="text-muted-foreground">= {a!.neu} neutros</div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    Clique para detalhes
                                  </div>
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
                  Mapa esquemático. As cores indicam aceitação (verde &gt;65%, amarelo 35-65%, vermelho &lt;35%).
                </p>
              </TooltipProvider>
            </div>

            {/* Ranking de UFs */}
            <div className="lg:col-span-2 space-y-2">
              <h4 className="text-sm font-semibold mb-2">Top estados por menções</h4>
              {ranking.map((a) => {
                const opin = a.pos + a.neg;
                const posPct = opin > 0 ? Math.round((a.pos / opin) * 100) : 0;
                return (
                  <button
                    key={a.uf}
                    onClick={() => setOpenUF(a.uf)}
                    className="w-full text-left rounded-lg border p-3 hover:border-primary/60 transition-all"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">
                        {a.uf} · {UF_NAME[a.uf]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {a.total.toLocaleString("pt-BR")}
                      </span>
                    </div>
                    {opin >= 3 ? (
                      <>
                        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                          <div className="bg-green-500" style={{ width: `${posPct}%` }} />
                          <div className="bg-red-500" style={{ width: `${100 - posPct}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] mt-1">
                          <span className="text-green-600">{posPct}% aceitação</span>
                          <span className="text-muted-foreground">{a.cities.size} cidades</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-muted-foreground italic">Poucas opiniões</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      {/* Modal de detalhes da UF */}
      <Dialog open={!!openUF} onOpenChange={(o) => !o && setOpenUF(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              {current ? `${UF_NAME[current.uf]} (${current.uf})` : ""}
            </DialogTitle>
            <DialogDescription>
              {current ? `${current.total} comentários identificados · ${current.cities.size} cidades` : ""}
            </DialogDescription>
          </DialogHeader>

          {current && (
            <div className="space-y-6">
              {/* Cidades */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Cidades com mais menções</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Array.from(current.cities.entries())
                    .sort((a, b) => b[1].total - a[1].total)
                    .slice(0, 12)
                    .map(([city, c]) => {
                      const opin = c.pos + c.neg;
                      const posPct = opin > 0 ? Math.round((c.pos / opin) * 100) : 0;
                      return (
                        <div key={city} className="rounded-md border bg-muted/30 px-3 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium truncate">{city}</span>
                            <span className="text-xs text-muted-foreground">{c.total}</span>
                          </div>
                          {opin >= 2 ? (
                            <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                              <div className="bg-green-500" style={{ width: `${posPct}%` }} />
                              <div className="bg-red-500" style={{ width: `${100 - posPct}%` }} />
                            </div>
                          ) : (
                            <div className="text-[11px] text-muted-foreground">Sem opinião suficiente</div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Comentários */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Comentários recentes</h4>
                <div className="space-y-2">
                  {current.samples.slice(0, 15).map((r) => {
                    const k = sentimentKey(r.sentiment_label);
                    const { city } = inferLocation(r.comment_text, r.comment_author);
                    return (
                      <div key={r.id} className="rounded-md border bg-card p-3 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {r.comment_author || "Anônimo"}
                          </span>
                          <span>·</span>
                          <span>{r.social_network}</span>
                          {city && (<><span>·</span><span>{city}</span></>)}
                          <span className="ml-auto">
                            {k === "pos" && <Badge className="bg-green-500/15 text-green-600 border-green-500/30"><ThumbsUp className="h-3 w-3 mr-1" />Positivo</Badge>}
                            {k === "neg" && <Badge className="bg-red-500/15 text-red-600 border-red-500/30"><ThumbsDown className="h-3 w-3 mr-1" />Negativo</Badge>}
                            {k === "neu" && <Badge variant="secondary"><Minus className="h-3 w-3 mr-1" />Neutro</Badge>}
                          </span>
                        </div>
                        <p className="text-sm leading-snug">
                          {(r.comment_text || "").slice(0, 280)}
                          {(r.comment_text || "").length > 280 ? "…" : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Calcula o centro aproximado do path "M x,y L ... Z" das caixas (formato usado
// em brazilMapSvg.ts). É um cálculo simples (média de todos os pares numéricos).
function parsePathCenter(d: string): { x: number; y: number } {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    xs.push(nums[i]); ys.push(nums[i + 1]);
  }
  if (!xs.length) return { x: 0, y: 0 };
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { x, y };
}
