import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, XCircle, MessageSquare, Activity, Instagram, Youtube, Facebook, Twitter, Music2, MapPinned, Sparkles, ThumbsUp, ThumbsDown, Minus, Globe, Newspaper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BR_MAP } from "@/data/brRegionsMap";

type RegionLabel = "Norte" | "Nordeste" | "Centro-Oeste" | "Sudeste" | "Sul";
const REGIONS: RegionLabel[] = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];
const MAP_REGIONS: RegionLabel[] = REGIONS;

// values precisam casar com os valores REAIS na coluna social_network do banco
const NETWORKS = [
  { values: ["YouTube", "youtube"], label: "YouTube", Icon: Youtube },
  { values: ["Twitter/X", "twitter", "Twitter"], label: "Twitter/X", Icon: Twitter },
  { values: ["Instagram", "instagram"], label: "Instagram", Icon: Instagram },
  { values: ["TikTok", "tiktok"], label: "TikTok", Icon: Music2 },
  { values: ["Facebook", "facebook"], label: "Facebook", Icon: Facebook },
  { values: ["google_news", "Google News"], label: "Google News", Icon: Newspaper },
  { values: ["Reddit", "reddit"], label: "Reddit", Icon: Globe },
  { values: ["Telegram", "telegram"], label: "Telegram", Icon: MessageSquare },
];
type NetCfg = typeof NETWORKS[number];

// Geometria real das 5 regiões do Brasil (gerada de simplemaps.com — uso comercial livre).
const REGION_PATHS: Record<RegionLabel, string> = BR_MAP.regions as Record<RegionLabel, string>;
const REGION_LABEL_POS: Record<RegionLabel, { x: number; y: number }> = BR_MAP.labels as Record<RegionLabel, { x: number; y: number }>;
const MAP_VIEWBOX = BR_MAP.viewBox;

function colorByAcceptance(acc: number, total: number): string {
  if (total < 10) return "hsl(var(--muted))";
  if (acc > 65) return "hsl(142, 70%, 45%)";
  if (acc >= 35) return "hsl(45, 95%, 55%)";
  return "hsl(0, 75%, 55%)";
}

interface Candidate { id: string; full_name: string }
interface Metrics { total: number; pos: number; neg: number; neu: number; acceptance: number; rejection: number; engagement: number }
interface Comment { id: string; comment_text: string; comment_author: string | null; sentiment_label: string | null; created_at: string; social_network: string }

const insightCache = new Map<string, { ts: number; data: { pontos_fortes: string[]; como_melhorar: string[] } }>();

export default function RegionalAnalysis() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState<string>("");
  const [network, setNetwork] = useState<string>("YouTube");
  const [region, setRegion] = useState<RegionLabel>("Sudeste");

  const [loading, setLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [mapData, setMapData] = useState<Record<RegionLabel, Metrics>>({} as Record<RegionLabel, Metrics>);
  const [insights, setInsights] = useState<{ pontos_fortes: string[]; como_melhorar: string[] } | null>(null);
  const [analyzedKey, setAnalyzedKey] = useState<string>("");

  // Load candidates
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
  }, [user]);

  const computeMetrics = (rows: { sentiment_label: string | null; likes_count: number | null; replies_count: number | null; shares_count: number | null }[]): Metrics => {
    const total = rows.length;
    let pos = 0, neg = 0, neu = 0, eng = 0;
    for (const r of rows) {
      const s = (r.sentiment_label || "").toLowerCase();
      if (s === "positive" || s === "positivo") pos++;
      else if (s === "negative" || s === "negativo") neg++;
      else neu++;
      eng += (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0);
    }
    const acceptance = total ? Math.round((pos / total) * 1000) / 10 : 0;
    const rejection = total ? Math.round((neg / total) * 1000) / 10 : 0;
    const engagement = total ? Math.round((eng / total) * 10) / 10 : 0;
    return { total, pos, neg, neu, acceptance, rejection, engagement };
  };

  const loadAll = useCallback(async () => {
    if (!user || !candidateId) return;
    setLoading(true);
    setInsights(null);
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const netCfg = NETWORKS.find((n) => n.label === network) ?? NETWORKS[0];
      const netValues = netCfg.values;

      // 1) Map data — all regions for selected network (NULL region tratado como "Indefinido")
      const { data: mapRows, error: mapErr } = await supabase
        .from("social_interactions")
        .select("region, sentiment_label, likes_count, replies_count, shares_count")
        .eq("user_id", user.id)
        .eq("candidate_id", candidateId)
        .in("social_network", netValues)
        .gte("created_at", since)
        .limit(50000);
      if (mapErr) throw mapErr;

      const grouped: Record<string, typeof mapRows> = {};
      for (const r of mapRows ?? []) {
        let reg = (r.region as string) || "Indefinido";
        if (!REGIONS.includes(reg as RegionLabel)) reg = "Indefinido";
        (grouped[reg] = grouped[reg] || []).push(r);
      }
      const md = {} as Record<RegionLabel, Metrics>;
      for (const r of REGIONS) md[r] = computeMetrics(grouped[r] ?? []);
      setMapData(md);
      setMetrics(md[region]);

      // 2) Sample comments for selected region (busca extra para deduplicar e ainda devolver 6)
      let cmtsQuery = supabase
        .from("social_interactions")
        .select("id, comment_text, comment_author, sentiment_label, created_at, social_network")
        .eq("user_id", user.id)
        .eq("candidate_id", candidateId)
        .in("social_network", netValues)
        .not("comment_text", "is", null);
      const { data: cmts } = await cmtsQuery
        .eq("region", region)
        .order("created_at", { ascending: false })
        .limit(40);

      // Dedup por texto normalizado (defesa extra contra duplicatas legadas)
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

      const key = `${candidateId}|${network}|${region}`;
      setAnalyzedKey(key);

      // 3) Insights from cache or via edge function
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
              social_network: netCfg.label,
              social_network_values: netValues,
              totals: { total: md[region].total, acceptance: md[region].acceptance, rejection: md[region].rejection },
            },
          });
          if (aiErr) throw aiErr;
          if (ai && ai.pontos_fortes) {
            insightCache.set(key, { ts: Date.now(), data: ai });
            setInsights(ai);
          }
        } catch (e) {
          console.error(e);
          toast.error("Não foi possível gerar insights da IA");
        } finally {
          setInsightsLoading(false);
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar dados regionais");
    } finally {
      setLoading(false);
    }
  }, [user, candidateId, network, region]);

  // Auto-load when candidate/network changes (region change re-runs too)
  useEffect(() => {
    if (candidateId) loadAll();
  }, [candidateId, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // When changing region without changing network, just update local view + maybe refetch insights
  useEffect(() => {
    if (!candidateId || Object.keys(mapData).length === 0) return;
    setMetrics(mapData[region] ?? null);
    // refetch comments + insights for region
    loadAll();
  }, [region]); // eslint-disable-line react-hooks/exhaustive-deps

  const sentimentBadge = (s: string | null) => {
    const k = (s || "").toLowerCase();
    if (k === "positive" || k === "positivo") return <Badge className="bg-green-500/15 text-green-600 border-green-500/30"><ThumbsUp className="h-3 w-3 mr-1" />Positivo</Badge>;
    if (k === "negative" || k === "negativo") return <Badge className="bg-red-500/15 text-red-600 border-red-500/30"><ThumbsDown className="h-3 w-3 mr-1" />Negativo</Badge>;
    return <Badge variant="secondary"><Minus className="h-3 w-3 mr-1" />Neutro</Badge>;
  };

  const networkLabel = (n: string) => NETWORKS.find((x) => x.label === n || x.values.includes(n))?.label ?? n;
  const NetworkIcon = ({ n, className }: { n: string; className?: string }) => {
    const Icon = NETWORKS.find((x) => x.label === n || x.values.includes(n))?.Icon ?? MessageSquare;
    return <Icon className={className} />;
  };

  const initials = (name: string | null) =>
    (name || "??").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const insufficient = (metrics?.total ?? 0) < 10;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <MapPinned className="h-7 w-7 text-primary" />
          Análise Regional
        </h1>
        <p className="text-muted-foreground mt-1">
          Performance do candidato por região do Brasil em cada rede social, com aceitação, rejeição,
          comentários reais e estratégias geradas por IA com base nos dados coletados.
        </p>
      </div>

      {/* Seletores */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="text-sm font-medium mb-2 block">Candidato</label>
              <Select value={candidateId} onValueChange={setCandidateId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Rede Social</label>
              <Select value={network} onValueChange={setNetwork}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NETWORKS.map((n) => (
                    <SelectItem key={n.label} value={n.label}>
                      <div className="flex items-center gap-2"><n.Icon className="h-4 w-4" />{n.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Região do Brasil</label>
              <Select value={region} onValueChange={(v) => setRegion(v as RegionLabel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={loadAll} disabled={loading || !candidateId} size="lg">
              {loading ? "Carregando..." : "Atualizar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </>
      )}

      {!loading && metrics && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="pt-6 flex items-center justify-between">
                <div><p className="text-sm text-muted-foreground">Taxa de Aceitação</p><p className="text-3xl font-bold text-green-600">{metrics.acceptance}%</p></div>
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="pt-6 flex items-center justify-between">
                <div><p className="text-sm text-muted-foreground">Taxa de Rejeição</p><p className="text-3xl font-bold text-red-600">{metrics.rejection}%</p></div>
                <XCircle className="h-8 w-8 text-red-500" />
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="pt-6 flex items-center justify-between">
                <div><p className="text-sm text-muted-foreground">Total de Menções</p><p className="text-3xl font-bold text-blue-600">{metrics.total.toLocaleString("pt-BR")}</p></div>
                <MessageSquare className="h-8 w-8 text-blue-500" />
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="pt-6 flex items-center justify-between">
                <div><p className="text-sm text-muted-foreground">Engajamento Médio</p><p className="text-3xl font-bold text-amber-600">{metrics.engagement}</p></div>
                <Activity className="h-8 w-8 text-amber-500" />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Mapa */}
            <Card>
              <CardHeader>
                <CardTitle>Mapa de Aceitação · {networkLabel(network)}</CardTitle>
                <CardDescription>Verde &gt; 65% · Amarelo 35–65% · Vermelho &lt; 35% · Cinza = poucos dados</CardDescription>
              </CardHeader>
              <CardContent>
                <TooltipProvider delayDuration={150}>
                  <div className="w-full flex justify-center">
                    <svg viewBox={MAP_VIEWBOX} className="w-full max-w-md h-auto" role="img" aria-label="Mapa do Brasil dividido em 5 regiões">
                      {MAP_REGIONS.map((r) => {
                        const m = mapData[r] ?? { acceptance: 0, total: 0 } as Metrics;
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
                                  style={{ fontSize: 28, paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 4, strokeLinejoin: "round" }}
                                >
                                  {r}
                                </text>
                              </g>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm">
                                <div className="font-semibold">{r}</div>
                                <div>Menções: {m.total.toLocaleString("pt-BR")}</div>
                                <div>Aceitação: {m.acceptance}%</div>
                                <div>Rejeição: {m.rejection}%</div>
                                {m.total < 10 && <div className="text-muted-foreground">Poucos dados</div>}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </svg>
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>

            {/* Insights */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-green-500" />Pontos Fortes — {region}</CardTitle>
                  <CardDescription>O que está funcionando para o candidato nesta região</CardDescription>
                </CardHeader>
                <CardContent>
                  {insufficient ? (
                    <p className="text-sm text-muted-foreground">Poucos dados para essa combinação ainda. Continue coletando para liberar insights.</p>
                  ) : insightsLoading ? (
                    <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
                  ) : insights?.pontos_fortes?.length ? (
                    <ul className="space-y-2 text-sm">{insights.pontos_fortes.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />{s}</li>)}</ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem insights gerados.</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-500" />Como Melhorar — {region}</CardTitle>
                  <CardDescription>Estratégias recomendadas pela IA com base nos comentários reais</CardDescription>
                </CardHeader>
                <CardContent>
                  {insufficient ? (
                    <p className="text-sm text-muted-foreground">Poucos dados para essa combinação ainda.</p>
                  ) : insightsLoading ? (
                    <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
                  ) : insights?.como_melhorar?.length ? (
                    <ul className="space-y-2 text-sm">{insights.como_melhorar.map((s, i) => <li key={i} className="flex gap-2"><Sparkles className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />{s}</li>)}</ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem recomendações.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Comentários reais */}
          <Card>
            <CardHeader>
              <CardTitle>Comentários reais · {region} · {networkLabel(network)}</CardTitle>
              <CardDescription>Últimos 6 comentários coletados nesta região</CardDescription>
            </CardHeader>
            <CardContent>
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Poucos dados para essa combinação ainda.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {comments.map((c) => (
                    <Card key={c.id} className="bg-muted/30">
                      <CardContent className="pt-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">{initials(c.comment_author)}</div>
                            <div>
                              <p className="text-sm font-medium leading-tight">{c.comment_author || "Anônimo"}</p>
                              <p className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</p>
                            </div>
                          </div>
                          <NetworkIcon n={c.social_network} className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm line-clamp-4">{c.comment_text}</p>
                        <div>{sentimentBadge(c.sentiment_label)}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!loading && !metrics && candidateId && (
        <Card><CardContent className="py-16 text-center text-muted-foreground">Sem dados regionais ainda. Aguarde a próxima coleta para classificação automática.</CardContent></Card>
      )}
    </div>
  );
}
