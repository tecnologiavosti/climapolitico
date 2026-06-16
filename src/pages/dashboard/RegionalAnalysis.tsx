import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  MapPinned,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Activity,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import BrazilStateMap from "@/components/dashboard/BrazilStateMap";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BR_MAP } from "@/data/brRegionsMap";
import { REGIONS, type RegionLabel } from "./regionalAnalysis.helpers";
import { UF_NAME, type UF } from "@/lib/brazilStatesInference";

const REGION_PATHS = BR_MAP.regions as Record<RegionLabel, string>;
const REGION_LABEL_POS = BR_MAP.labels as Record<RegionLabel, { x: number; y: number }>;
const MAP_VIEWBOX = BR_MAP.viewBox;

interface Candidate { id: string; full_name: string; }
interface CacheRow {
  scope: "region" | "state";
  region: string | null;
  state: string | null;
  mentions: number;
  positive: number;
  negative: number;
  neutral: number;
  avg_engagement: number;
  network_distribution: { label: string; count: number }[];
  last_refreshed_at: string;
}

type Selection =
  | { kind: "region"; key: RegionLabel }
  | { kind: "state"; key: UF };

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function acceptanceColor(acc: number, total: number) {
  if (total < 10) return "hsl(220, 13%, 80%)";
  if (acc > 65) return "hsl(142, 70%, 45%)";
  if (acc >= 35) return "hsl(45, 95%, 55%)";
  return "hsl(0, 75%, 55%)";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

export default function RegionalAnalysis() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [rows, setRows] = useState<CacheRow[]>([]);
  const [totalMentions, setTotalMentions] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selection, setSelection] = useState<Selection>({ kind: "region", key: "Sudeste" });

  // Candidates
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("candidates")
        .select("id, full_name")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("full_name");
      const list = data ?? [];
      setCandidates(list);
      if (list.length && !candidateId) setCandidateId(list[0].id);
    })();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCache = useCallback(async () => {
    if (!user || !candidateId) return;
    setLoading(true);
    try {
      const [{ data: cache }, { count }] = await Promise.all([
        supabase
          .from("regional_analytics_cache")
          .select("scope, region, state, mentions, positive, negative, neutral, avg_engagement, network_distribution, last_refreshed_at")
          .eq("user_id", user.id)
          .eq("candidate_id", candidateId),
        supabase
          .from("social_interactions")
          .select("id", { head: true, count: "exact" })
          .eq("user_id", user.id)
          .eq("candidate_id", candidateId),
      ]);
      setRows((cache as CacheRow[]) ?? []);
      setTotalMentions(count ?? 0);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar análise regional");
    } finally {
      setLoading(false);
    }
  }, [user, candidateId]);

  useEffect(() => { if (candidateId) loadCache(); }, [candidateId, loadCache]);

  const refresh = async () => {
    if (!candidateId) return;
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("refresh-regional-analytics", {
        body: { candidate_id: candidateId },
      });
      if (error) throw error;
      toast.success("Cache atualizado");
      await loadCache();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao atualizar o cache");
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Derivados ──────────────────────────────────────────────────────────
  const regionRows = useMemo(() => rows.filter(r => r.scope === "region"), [rows]);
  const stateRows = useMemo(() => rows.filter(r => r.scope === "state"), [rows]);

  const byRegion = useMemo(() => {
    const map = new Map<RegionLabel, CacheRow>();
    for (const r of regionRows) if (r.region && (REGIONS as string[]).includes(r.region)) {
      map.set(r.region as RegionLabel, r);
    }
    return map;
  }, [regionRows]);

  const byState = useMemo(() => {
    const map = new Map<UF, CacheRow>();
    for (const r of stateRows) if (r.state) map.set(r.state as UF, r);
    return map;
  }, [stateRows]);

  const classifiedTotal = useMemo(
    () => regionRows.reduce((s, r) => s + r.mentions, 0),
    [regionRows],
  );
  const withoutRegion = Math.max(0, totalMentions - classifiedTotal);
  const coverage = pct(classifiedTotal, totalMentions);
  const lastRefreshed = useMemo(() => {
    const ts = rows.map(r => r.last_refreshed_at).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : null;
  }, [rows]);

  const selectedRow: CacheRow | null = useMemo(() => {
    if (selection.kind === "region") return byRegion.get(selection.key) ?? null;
    return byState.get(selection.key) ?? null;
  }, [selection, byRegion, byState]);

  const selectedMetrics = useMemo(() => {
    if (!selectedRow) return null;
    const opin = selectedRow.positive + selectedRow.negative;
    return {
      total: selectedRow.mentions,
      acceptance: pct(selectedRow.positive, opin),
      rejection: pct(selectedRow.negative, opin),
      neutralShare: pct(selectedRow.neutral, selectedRow.mentions),
      engagement: selectedRow.avg_engagement,
      networks: selectedRow.network_distribution || [],
    };
  }, [selectedRow]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <MapPinned className="h-7 w-7 text-primary" />
            Análise Regional
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Distribuição agregada por região e por estado. 100% analítico, calculado a partir de cache pré-agregado para resposta instantânea.
          </p>
        </div>
        <div className="flex flex-row flex-wrap gap-2 items-end">
          <div className="min-w-[200px] flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Candidato</label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {candidates.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={refresh} disabled={refreshing || !candidateId} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar agora
          </Button>
        </div>
      </div>

      {!candidateId && !loading && (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          Adicione um candidato em "Candidatos" para começar.
        </CardContent></Card>
      )}

      {/* Resumo Regional */}
      {candidateId && (
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{totalMentions.toLocaleString("pt-BR")}</span>
                  <span className="text-sm text-muted-foreground">menções totais</span>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary">Com região: {classifiedTotal.toLocaleString("pt-BR")}</Badge>
                  <Badge variant="outline">Sem região: {withoutRegion.toLocaleString("pt-BR")}</Badge>
                  <Badge className="bg-primary/10 text-primary border-primary/30">
                    Cobertura: {coverage}%
                  </Badge>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Última atualização: {relativeTime(lastRefreshed)}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Mapa por Regiões + Ranking */}
      {candidateId && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Mapa por Regiões</CardTitle>
              <CardDescription>Clique em uma região para ver os detalhes ao lado.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-[380px] w-full" /> : (
                <TooltipProvider delayDuration={120}>
                  <div className="w-full flex justify-center">
                    <svg viewBox={MAP_VIEWBOX} className="w-full max-w-md h-auto" role="img" aria-label="Mapa do Brasil por região">
                      {REGIONS.map(r => {
                        const row = byRegion.get(r);
                        const total = row?.mentions ?? 0;
                        const opin = (row?.positive ?? 0) + (row?.negative ?? 0);
                        const acc = pct(row?.positive ?? 0, opin);
                        const fill = acceptanceColor(acc, total);
                        const selected = selection.kind === "region" && selection.key === r;
                        return (
                          <Tooltip key={r}>
                            <TooltipTrigger asChild>
                              <g onClick={() => setSelection({ kind: "region", key: r })} className="cursor-pointer">
                                <path d={REGION_PATHS[r]} fill={fill}
                                  stroke={selected ? "hsl(var(--primary))" : "hsl(var(--background))"}
                                  strokeWidth={selected ? 4 : 1.5}
                                  className="transition-all hover:opacity-80" />
                                <text x={REGION_LABEL_POS[r].x} y={REGION_LABEL_POS[r].y}
                                  textAnchor="middle" className="fill-white font-bold pointer-events-none"
                                  style={{ fontSize: 28, paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 4, strokeLinejoin: "round" }}>
                                  {r}
                                </text>
                              </g>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm space-y-0.5">
                                <div className="font-semibold">{r}</div>
                                <div>Menções: {total.toLocaleString("pt-BR")}</div>
                                <div>Aceitação: {acc}%</div>
                                <div>Rejeição: {pct(row?.negative ?? 0, opin)}%</div>
                                <div className="text-muted-foreground">Neutro: {pct(row?.neutral ?? 0, total)}%</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </svg>
                  </div>
                </TooltipProvider>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Ranking por região</CardTitle>
              <CardDescription>Menções, aceitação e rejeição</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
                : REGIONS.map(r => {
                    const row = byRegion.get(r);
                    const total = row?.mentions ?? 0;
                    const opin = (row?.positive ?? 0) + (row?.negative ?? 0);
                    const acc = pct(row?.positive ?? 0, opin);
                    const rej = pct(row?.negative ?? 0, opin);
                    const selected = selection.kind === "region" && selection.key === r;
                    return (
                      <button key={r}
                        onClick={() => setSelection({ kind: "region", key: r })}
                        className={`w-full text-left rounded-lg border p-3 transition-all hover:border-primary/60 ${selected ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-medium text-sm">{r}</span>
                          <span className="text-xs text-muted-foreground">{total.toLocaleString("pt-BR")}</span>
                        </div>
                        {opin >= 5 ? (
                          <>
                            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                              <div className="bg-green-500" style={{ width: `${acc}%` }} />
                              <div className="bg-red-500" style={{ width: `${rej}%` }} />
                            </div>
                            <div className="flex justify-between text-[11px] mt-1">
                              <span className="text-green-600">{acc}% aceitação</span>
                              <span className="text-red-600">{rej}% rejeição</span>
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] text-muted-foreground italic">Dados insuficientes</div>
                        )}
                      </button>
                    );
                  })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mapa por Estado */}
      {candidateId && (
        <BrazilStateMap
          loading={loading}
          byState={byState}
          selectedUF={selection.kind === "state" ? selection.key : null}
          onSelect={(uf) => setSelection({ kind: "state", key: uf })}
        />
      )}

      {/* Painel analítico — região OU estado */}
      {candidateId && (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle>
                  {selection.kind === "region"
                    ? `Região: ${selection.key}`
                    : `Estado: ${UF_NAME[selection.key]} (${selection.key})`}
                </CardTitle>
                <CardDescription>
                  {selectedMetrics
                    ? `${selectedMetrics.total.toLocaleString("pt-BR")} menções identificadas`
                    : "Sem dados nesta seleção"}
                </CardDescription>
              </div>
              {selectedMetrics && selectedMetrics.total > 0 && (
                selectedMetrics.acceptance > selectedMetrics.rejection ? (
                  <Badge className="bg-green-500/15 text-green-600 border-green-500/30">
                    <TrendingUp className="h-3 w-3 mr-1" />Saldo positivo
                  </Badge>
                ) : selectedMetrics.rejection > selectedMetrics.acceptance ? (
                  <Badge className="bg-red-500/15 text-red-600 border-red-500/30">
                    <TrendingDown className="h-3 w-3 mr-1" />Saldo negativo
                  </Badge>
                ) : <Badge variant="secondary">Equilibrado</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : !selectedMetrics || selectedMetrics.total === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sem dados nesta seleção. Atualize o cache ou selecione outra área no mapa.
              </p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Metric icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-500" />} label="Aceitação"
                    value={`${selectedMetrics.acceptance}%`} accent="text-green-600"
                    extra={<Progress value={selectedMetrics.acceptance} className="h-1.5" />} />
                  <Metric icon={<XCircle className="h-3.5 w-3.5 text-red-500" />} label="Rejeição"
                    value={`${selectedMetrics.rejection}%`} accent="text-red-600"
                    extra={<Progress value={selectedMetrics.rejection} className="h-1.5" />} />
                  <Metric icon={<MessageSquare className="h-3.5 w-3.5 text-blue-500" />} label="Menções"
                    value={selectedMetrics.total.toLocaleString("pt-BR")} accent="text-blue-600"
                    extra={<div className="text-xs text-muted-foreground">{selectedMetrics.neutralShare}% neutros</div>} />
                  <Metric icon={<Activity className="h-3.5 w-3.5 text-amber-500" />} label="Engajamento médio"
                    value={String(selectedMetrics.engagement)} accent="text-amber-600"
                    extra={<div className="text-xs text-muted-foreground">por menção</div>} />
                </div>

                {/* Distribuição por rede */}
                {selectedMetrics.networks.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Rede dominante</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {selectedMetrics.networks.slice(0, 8).map(n => {
                        const share = pct(n.count, selectedMetrics.total);
                        return (
                          <div key={n.label} className="rounded-md border bg-muted/30 p-2">
                            <div className="text-xs text-muted-foreground capitalize">{n.label}</div>
                            <div className="text-sm font-semibold">{n.count.toLocaleString("pt-BR")}</div>
                            <div className="text-[11px] text-muted-foreground">{share}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top 5 estados se selecionou região */}
                {selection.kind === "region" && (
                  <TopStatesInRegion region={selection.key} byState={byState} onPickState={(uf) => setSelection({ kind: "state", key: uf })} />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ icon, label, value, accent, extra }: {
  icon: React.ReactNode; label: string; value: string; accent: string; extra?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      {extra}
    </div>
  );
}

const UF_TO_REGION_MAP: Record<UF, RegionLabel> = {
  AC: "Norte", AM: "Norte", AP: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

function TopStatesInRegion({ region, byState, onPickState }: {
  region: RegionLabel;
  byState: Map<UF, CacheRow>;
  onPickState: (uf: UF) => void;
}) {
  const top = useMemo(() => {
    return Array.from(byState.entries())
      .filter(([uf]) => UF_TO_REGION_MAP[uf] === region)
      .map(([uf, row]) => ({ uf, row }))
      .sort((a, b) => b.row.mentions - a.row.mentions)
      .slice(0, 5);
  }, [region, byState]);

  if (top.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2">Top 5 estados em {region}</h4>
      <div className="space-y-1.5">
        {top.map(({ uf, row }) => {
          const opin = row.positive + row.negative;
          const acc = pct(row.positive, opin);
          return (
            <button key={uf} onClick={() => onPickState(uf)}
              className="w-full text-left flex items-center justify-between rounded-md border p-2 hover:border-primary/60 transition-all">
              <span className="text-sm font-medium">{uf} · {UF_NAME[uf]}</span>
              <span className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">{row.mentions.toLocaleString("pt-BR")}</span>
                <span className="text-green-600">{acc}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
