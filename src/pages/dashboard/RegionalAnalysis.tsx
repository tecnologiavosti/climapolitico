import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  MessageSquare,
  Activity,
  Instagram,
  Youtube,
  Facebook,
  Twitter,
  Music2,
  MapPinned,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Globe,
  Newspaper,
  TrendingUp,
  TrendingDown,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BR_MAP } from "@/data/brRegionsMap";
import {
  REGIONS,
  NETWORKS,
  ALL_NETWORKS_VALUE,
  EMPTY_METRICS,
  colorByAcceptance,
  computeMetrics,
  networkLabel,
  type RegionLabel,
  type Metrics,
} from "./regionalAnalysis.helpers";

const REGION_PATHS: Record<RegionLabel, string> = BR_MAP.regions as Record<RegionLabel, string>;
const REGION_LABEL_POS: Record<RegionLabel, { x: number; y: number }> = BR_MAP.labels as Record<
  RegionLabel,
  { x: number; y: number }
>;
const MAP_VIEWBOX = BR_MAP.viewBox;

interface Candidate {
  id: string;
  full_name: string;
}
interface Comment {
  id: string;
  comment_text: string;
  comment_author: string | null;
  sentiment_label: string | null;
  created_at: string;
  social_network: string;
}

const insightCache = new Map<string, { ts: number; data: { pontos_fortes: string[]; como_melhorar: string[] } }>();

function NetworkIcon({ n, className }: { n: string; className?: string }) {
  const Icon = NETWORKS.find((x) => x.label === n || x.values.includes(n))?.Icon ?? MessageSquare;
  return <Icon className={className} />;
}

const initials = (name: string | null) =>
  (name || "??")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

function SentimentBadge({ s }: { s: string | null }) {
  const k = (s || "").toLowerCase();
  if (k === "positive" || k === "positivo")
    return (
      <Badge className="bg-green-500/15 text-green-600 border-green-500/30 hover:bg-green-500/20">
        <ThumbsUp className="h-3 w-3 mr-1" />
        Positivo
      </Badge>
    );
  if (k === "negative" || k === "negativo")
    return (
      <Badge className="bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/20">
        <ThumbsDown className="h-3 w-3 mr-1" />
        Negativo
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <Minus className="h-3 w-3 mr-1" />
      Neutro
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────────────
export default function RegionalAnalysis() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState<string>("");
  const [network, setNetwork] = useState<string>(ALL_NETWORKS_VALUE);
  const [region, setRegion] = useState<RegionLabel>("Sudeste");

  const [mapLoading, setMapLoading] = useState(false);
  const [regionLoading, setRegionLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [mapData, setMapData] = useState<Record<RegionLabel, Metrics>>({} as Record<RegionLabel, Metrics>);
  const [unclassifiedTotal, setUnclassifiedTotal] = useState(0);
  const [networkBreakdown, setNetworkBreakdown] = useState<{ label: string; total: number }[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [insights, setInsights] = useState<{ pontos_fortes: string[]; como_melhorar: string[] } | null>(null);

  const requestSeqRef = useRef(0);

  // ─── Carrega lista de candidatos ──────────────────────────────────────────
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

  // ─── Carrega o mapa (todas as regiões + breakdown por rede) ───────────────
  // Roda apenas quando muda candidato OU rede (não quando muda região).
  const loadMap = useCallback(async () => {
    if (!user || !candidateId) return;
    const seq = ++requestSeqRef.current;
    setMapLoading(true);
    try {
      const isAllNetworks = network === ALL_NETWORKS_VALUE;
      const netCfg = isAllNetworks ? null : NETWORKS.find((n) => n.label === network);
      const netValues = netCfg ? netCfg.values : null;

      // Paginação manual para superar o limite de 1000 do PostgREST
      const PAGE = 1000;
      const HARD_CAP = 50000;
      let from = 0;
      const rows: {
        region: string | null;
        social_network: string;
        sentiment_label: string | null;
        likes_count: number | null;
        replies_count: number | null;
        shares_count: number | null;
      }[] = [];
      while (rows.length < HARD_CAP) {
        let q = supabase
          .from("social_interactions")
          .select("region, social_network, sentiment_label, likes_count, replies_count, shares_count")
          .eq("user_id", user.id)
          .eq("candidate_id", candidateId)
          .not("social_network", "in", "(mastodon,lemmy,pinterest)")
          .range(from, from + PAGE - 1);
        if (netValues) q = q.in("social_network", netValues);
        const { data: page, error } = await q;
        if (error) throw error;
        if (!page || page.length === 0) break;
        rows.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }

      if (seq !== requestSeqRef.current) return; // descartar resposta obsoleta

      // Agrupar por região
      const grouped: Record<string, typeof rows> = {};
      const undefinedRows: typeof rows = [];
      for (const r of rows) {
        const reg = (r.region as string) || "";
        if (REGIONS.includes(reg as RegionLabel)) {
          (grouped[reg] = grouped[reg] || []).push(r);
        } else {
          undefinedRows.push(r);
        }
      }
      const md = {} as Record<RegionLabel, Metrics>;
      for (const r of REGIONS) md[r] = computeMetrics(grouped[r] ?? []);
      setMapData(md);
      setUnclassifiedTotal(undefinedRows.length);

      // Breakdown por rede (apenas quando "todas as redes")
      if (isAllNetworks) {
        const byNet = new Map<string, number>();
        for (const r of rows) {
          const lbl = networkLabel(r.social_network);
          byNet.set(lbl, (byNet.get(lbl) ?? 0) + 1);
        }
        const sorted = Array.from(byNet.entries())
          .map(([label, total]) => ({ label, total }))
          .sort((a, b) => b.total - a.total);
        setNetworkBreakdown(sorted);
      } else {
        setNetworkBreakdown([]);
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar dados regionais");
    } finally {
      if (seq === requestSeqRef.current) setMapLoading(false);
    }
  }, [user, candidateId, network]);

  // ─── Carrega detalhes da região (comentários + insights de IA) ────────────
  const loadRegionDetails = useCallback(
    async (md: Record<RegionLabel, Metrics>) => {
      if (!user || !candidateId) return;
      setRegionLoading(true);
      setInsights(null);
      try {
        const isAllNetworks = network === ALL_NETWORKS_VALUE;
        const netCfg = isAllNetworks ? null : NETWORKS.find((n) => n.label === network);
        const netValues = netCfg ? netCfg.values : null;

        // Comentários
        let cmtsQuery = supabase
          .from("social_interactions")
          .select("id, comment_text, comment_author, sentiment_label, created_at, social_network")
          .eq("user_id", user.id)
          .eq("candidate_id", candidateId)
          .eq("region", region)
          .not("social_network", "in", "(mastodon,lemmy,pinterest)")
          .not("comment_text", "is", null);
        if (netValues) cmtsQuery = cmtsQuery.in("social_network", netValues);
        const { data: cmts } = await cmtsQuery
          .order("created_at", { ascending: false })
          .limit(40);

        const seenTexts = new Set<string>();
        const uniqueComments: Comment[] = [];
        for (const c of (cmts ?? []) as Comment[]) {
          const key = (c.comment_text || "").trim().toLowerCase();
          if (!key || seenTexts.has(key)) continue;
          seenTexts.add(key);
          uniqueComments.push(c);
          if (uniqueComments.length >= 6) break;
        }
        setComments(uniqueComments);

        // Insights via IA (se há volume mínimo)
        const key = `${candidateId}|${network}|${region}`;
        const cached = insightCache.get(key);
        const fresh = cached && Date.now() - cached.ts < 60 * 60 * 1000;
        if (fresh) {
          setInsights(cached!.data);
        } else if ((md[region]?.total ?? 0) >= 10) {
          setInsightsLoading(true);
          try {
            const { data: ai, error: aiErr } = await supabase.functions.invoke("regional-insights", {
              body: {
                candidate_id: candidateId,
                region,
                social_network: netCfg ? netCfg.label : "Todas as redes",
                social_network_values: netValues,
                totals: {
                  total: md[region].total,
                  acceptance: md[region].acceptance,
                  rejection: md[region].rejection,
                },
              },
            });
            if (aiErr) throw aiErr;
            if (ai && Array.isArray(ai.pontos_fortes)) {
              insightCache.set(key, { ts: Date.now(), data: ai });
              setInsights(ai);
            }
          } catch (e) {
            console.error(e); // silencioso (créditos esgotados etc.)
          } finally {
            setInsightsLoading(false);
          }
        }
      } finally {
        setRegionLoading(false);
      }
    },
    [user, candidateId, network, region]
  );

  // ─── Orquestração: carregar mapa quando muda candidato/rede ───────────────
  useEffect(() => {
    if (candidateId) loadMap();
  }, [candidateId, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Orquestração: detalhes da região quando mapa pronto ou região muda ──
  useEffect(() => {
    if (!candidateId || mapLoading || Object.keys(mapData).length === 0) return;
    loadRegionDetails(mapData);
  }, [region, mapData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  // Derivações
  // ─────────────────────────────────────────────────────────────────────────
  const currentMetrics = mapData[region] ?? EMPTY_METRICS;
  const classifiedTotal = REGIONS.reduce((s, r) => s + (mapData[r]?.total ?? 0), 0);
  const grandTotal = classifiedTotal + unclassifiedTotal;
  const insufficient = currentMetrics.total < 10;
  const isAllNetworks = network === ALL_NETWORKS_VALUE;
  const networkLabelText = isAllNetworks ? "todas as redes" : networkLabel(network);

  const ranking = useMemo(
    () =>
      REGIONS.map((r) => ({ region: r, ...(mapData[r] ?? EMPTY_METRICS) })).sort(
        (a, b) => b.total - a.total
      ),
    [mapData]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {/* ─── Cabeçalho com seletores ─── */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <MapPinned className="h-7 w-7 text-primary" />
            Análise Regional
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Como o seu candidato é percebido em cada região do Brasil. Selecione a rede e clique numa
            região do mapa para ver detalhes, comentários reais e recomendações de IA.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Candidato</label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Rede social</label>
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_NETWORKS_VALUE}>
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Todas as redes
                  </div>
                </SelectItem>
                {NETWORKS.map((n) => (
                  <SelectItem key={n.label} value={n.label}>
                    <div className="flex items-center gap-2">
                      <n.Icon className="h-4 w-4" />
                      {n.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ─── Estado vazio: nenhum candidato ─── */}
      {!candidateId && !mapLoading && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Adicione um candidato em "Candidatos" para começar a analisar regiões.
          </CardContent>
        </Card>
      )}

      {/* ─── Resumo total (transparência sobre os números) ─── */}
      {candidateId && (
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{grandTotal.toLocaleString("pt-BR")}</span>
                <span className="text-sm text-muted-foreground">
                  menções totais em {networkLabelText}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  Com região: {classifiedTotal.toLocaleString("pt-BR")}
                </Badge>
                {unclassifiedTotal > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="border-amber-500/50 text-amber-700 dark:text-amber-400 cursor-help"
                        >
                          <Info className="h-3 w-3 mr-1" />
                          Sem região: {unclassifiedTotal.toLocaleString("pt-BR")}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Estas menções não têm dados públicos suficientes para identificar a região do
                        autor. Elas contam no total da Visão Geral, mas não aparecem no mapa.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Mapa + Ranking ─── */}
      {candidateId && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Mapa */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>Mapa de aceitação · {networkLabelText}</CardTitle>
                  <CardDescription>Clique em uma região para ver os detalhes</CardDescription>
                </div>
                <div className="flex gap-1.5 text-xs flex-shrink-0">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: "hsl(142, 70%, 45%)" }} />
                    &gt;65%
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: "hsl(45, 95%, 55%)" }} />
                    35-65%
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm" style={{ background: "hsl(0, 75%, 55%)" }} />
                    &lt;35%
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {mapLoading ? (
                <Skeleton className="h-[400px] w-full" />
              ) : (
                <TooltipProvider delayDuration={150}>
                  <div className="w-full flex justify-center">
                    <svg
                      viewBox={MAP_VIEWBOX}
                      className="w-full max-w-md h-auto"
                      role="img"
                      aria-label="Mapa do Brasil dividido em 5 regiões"
                    >
                      {REGIONS.map((r) => {
                        const m = mapData[r] ?? EMPTY_METRICS;
                        const fill = colorByAcceptance(m.acceptance, m.total);
                        const selected = r === region;
                        return (
                          <Tooltip key={r}>
                            <TooltipTrigger asChild>
                              <g onClick={() => setRegion(r)} className="cursor-pointer">
                                <path
                                  d={REGION_PATHS[r]}
                                  fill={fill}
                                  stroke={selected ? "hsl(var(--primary))" : "hsl(var(--background))"}
                                  strokeWidth={selected ? 4 : 1.5}
                                  className="transition-all hover:opacity-80"
                                />
                                <text
                                  x={REGION_LABEL_POS[r].x}
                                  y={REGION_LABEL_POS[r].y}
                                  textAnchor="middle"
                                  className="fill-white font-bold pointer-events-none"
                                  style={{
                                    fontSize: 28,
                                    paintOrder: "stroke",
                                    stroke: "rgba(0,0,0,0.55)",
                                    strokeWidth: 4,
                                    strokeLinejoin: "round",
                                  }}
                                >
                                  {r}
                                </text>
                              </g>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm space-y-0.5">
                                <div className="font-semibold">{r}</div>
                                <div>Menções: {m.total.toLocaleString("pt-BR")}</div>
                                <div>Aceitação: {m.acceptance}%</div>
                                <div>Rejeição: {m.rejection}%</div>
                                {m.total < 10 && (
                                  <div className="text-muted-foreground text-xs">Poucos dados</div>
                                )}
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

          {/* Ranking de regiões */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Ranking por região</CardTitle>
              <CardDescription>Menções, aceitação e rejeição</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {mapLoading
                ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
                : ranking.map((r) => {
                    const selected = r.region === region;
                    return (
                      <button
                        key={r.region}
                        onClick={() => setRegion(r.region)}
                        className={`w-full text-left rounded-lg border p-3 transition-all hover:border-primary/60 ${
                          selected ? "border-primary bg-primary/5" : "border-border bg-card"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-medium text-sm">{r.region}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.total.toLocaleString("pt-BR")} menções
                          </span>
                        </div>
                        {r.total >= 10 ? (
                          <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                            <div
                              className="bg-green-500"
                              style={{ width: `${r.acceptance}%` }}
                              title={`Aceitação ${r.acceptance}%`}
                            />
                            <div
                              className="bg-muted-foreground/30"
                              style={{ width: `${100 - r.acceptance - r.rejection}%` }}
                            />
                            <div
                              className="bg-red-500"
                              style={{ width: `${r.rejection}%` }}
                              title={`Rejeição ${r.rejection}%`}
                            />
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground italic">Dados insuficientes</div>
                        )}
                        {r.total >= 10 && (
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-green-600">{r.acceptance}%</span>
                            <span className="text-red-600">{r.rejection}%</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Detalhe da região selecionada ─── */}
      {candidateId && !mapLoading && (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPinned className="h-5 w-5 text-primary" />
                  {region}
                </CardTitle>
                <CardDescription>
                  {networkLabelText} · {currentMetrics.total.toLocaleString("pt-BR")} menções analisadas
                </CardDescription>
              </div>
              {currentMetrics.total > 0 && (
                <div className="flex items-center gap-2">
                  {currentMetrics.acceptance > currentMetrics.rejection ? (
                    <Badge className="bg-green-500/15 text-green-600 border-green-500/30">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      Saldo positivo
                    </Badge>
                  ) : currentMetrics.rejection > currentMetrics.acceptance ? (
                    <Badge className="bg-red-500/15 text-red-600 border-red-500/30">
                      <TrendingDown className="h-3 w-3 mr-1" />
                      Saldo negativo
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Equilibrado</Badge>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {currentMetrics.total === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                Sem menções coletadas para esta combinação ainda.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    Aceitação
                  </div>
                  <div className="text-2xl font-bold text-green-600">{currentMetrics.acceptance}%</div>
                  <Progress value={currentMetrics.acceptance} className="h-1.5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    Rejeição
                  </div>
                  <div className="text-2xl font-bold text-red-600">{currentMetrics.rejection}%</div>
                  <Progress value={currentMetrics.rejection} className="h-1.5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                    Menções
                  </div>
                  <div className="text-2xl font-bold text-blue-600">
                    {currentMetrics.total.toLocaleString("pt-BR")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {currentMetrics.pos} pos · {currentMetrics.neg} neg · {currentMetrics.neu} neu
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Activity className="h-3.5 w-3.5 text-amber-500" />
                    Engajamento médio
                  </div>
                  <div className="text-2xl font-bold text-amber-600">{currentMetrics.engagement}</div>
                  <div className="text-xs text-muted-foreground">por menção</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Breakdown por rede (só quando "todas as redes") ─── */}
      {candidateId && isAllNetworks && !mapLoading && networkBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição por rede social</CardTitle>
            <CardDescription>
              Onde estão as menções deste candidato (todas as regiões)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {networkBreakdown.slice(0, 12).map((n) => (
                <div
                  key={n.label}
                  className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"
                >
                  <NetworkIcon n={n.label} className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground truncate">{n.label}</div>
                    <div className="text-sm font-semibold">{n.total.toLocaleString("pt-BR")}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Insights de IA ─── */}
      {candidateId && !mapLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-green-500" />
                Pontos fortes em {region}
              </CardTitle>
              <CardDescription>O que está funcionando para o candidato nesta região</CardDescription>
            </CardHeader>
            <CardContent>
              {insufficient ? (
                <p className="text-sm text-muted-foreground">
                  Poucos dados para esta combinação. Continue coletando para liberar insights da IA.
                </p>
              ) : insightsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              ) : insights?.pontos_fortes?.length ? (
                <ul className="space-y-2 text-sm">
                  {insights.pontos_fortes.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Insights de IA temporariamente indisponíveis. Tente novamente em alguns instantes.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                Como melhorar em {region}
              </CardTitle>
              <CardDescription>
                Estratégias recomendadas pela IA com base nos comentários reais
              </CardDescription>
            </CardHeader>
            <CardContent>
              {insufficient ? (
                <p className="text-sm text-muted-foreground">Poucos dados para esta combinação ainda.</p>
              ) : insightsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              ) : insights?.como_melhorar?.length ? (
                <ul className="space-y-2 text-sm">
                  {insights.como_melhorar.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <Sparkles className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Recomendações temporariamente indisponíveis.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Comentários reais ─── */}
      {candidateId && !mapLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Comentários reais · {region}</CardTitle>
            <CardDescription>
              Últimos comentários coletados nesta região ({networkLabelText})
            </CardDescription>
          </CardHeader>
          <CardContent>
            {regionLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Sem comentários para esta combinação ainda.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg border bg-muted/30 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                          {initials(c.comment_author)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight truncate">
                            {c.comment_author || "Anônimo"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(c.created_at).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                      </div>
                      <NetworkIcon n={c.social_network} className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                    <p className="text-sm line-clamp-4">{c.comment_text}</p>
                    <div>
                      <SentimentBadge s={c.sentiment_label} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
