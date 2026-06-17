import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { MessageSquare, Activity, Gauge, Crown, Radar as RadarIcon, Sparkles, RefreshCw } from "lucide-react";
import { format } from "date-fns";

// ------------------------------------------------------------
// Visão por Rede Social — pipeline histórico externo + IA.
// Independente do Radar Político e do banco interno.
// Toda a análise vem de supabase.functions.invoke('network-listening').
// ------------------------------------------------------------

type DataSourceType = "direct" | "proxy" | "unavailable";
interface Distribution { network: string; pct: number; mentions?: number; data_source_type?: DataSourceType; direct_hits?: number; external_hits?: number }
interface TimelinePoint { date: string; total: number; positivo: number; negativo: number }
interface SentByNetwork { network: string; pos: number; neg: number; neu: number }
interface Topic { label: string; mentions: number; pos?: number; neg?: number; neu?: number }
interface Term { term: string; kind: "pessoa" | "partido" | "instituicao" | "hashtag" | "slogan" | "regiao"; count: number }
interface ListeningReport {
  total_mentions: number | null;
  total_interactions: number | null;
  sentiment: { pos: number; neg: number; neu: number };
  net_sentiment: number;
  net_label?: string;
  dominant_network: string | null;
  distribution: Distribution[];
  timeline: TimelinePoint[];
  sentiment_by_network: SentByNetwork[];
  topics: Topic[];
  terms: Term[];
  confidence: "high" | "medium" | "low";
  render_state?: "FULL_DATA" | "PARTIAL_DATA" | "NO_DATA";
  qualitative_only?: boolean;
  reasoning?: string;
  evidence_count?: number;
  source_count?: number;
  pipeline_used?: string;
  fallback_used?: boolean;
  backfill_used?: boolean;
  backfill_hits?: number;
  bucket?: string;
  cached?: boolean;
  fallback?: boolean;
}

interface JobResponse {
  status: "processing" | "queued" | "running" | "completed" | "failed";
  job_id?: string;
  progress?: number;
  stage?: string;
  result?: ListeningReport;
  cached?: boolean;
  error?: string;
}

const NETWORK_LABEL: Record<string, string> = {
  youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", telegram: "Telegram",
  twitter: "X / Twitter", x: "X / Twitter", news: "Notícias", linkedin: "LinkedIn",
  reddit: "Reddit", instagram: "Instagram", bluesky: "Bluesky",
};

const NETWORKS_FILTER = [
  { value: "all", label: "Todas as redes" },
  { value: "news", label: "Notícias" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "X / Twitter" },
  { value: "telegram", label: "Telegram" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "reddit", label: "Reddit" },
];

const PERIODS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
  { value: 365, label: "1 ano" },
  { value: 1460, label: "4 anos" },
  { value: 2920, label: "8 anos" },
];
const PERIOD_LABEL: Record<number, string> = Object.fromEntries(PERIODS.map((p) => [p.value, p.label]));

const COLORS = {
  positive: "hsl(var(--success))",
  negative: "hsl(var(--destructive))",
  neutral: "hsl(var(--muted-foreground))",
  primary: "hsl(var(--primary))",
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString("pt-BR");
const compact = (n: number) =>
  Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n ?? 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const parseDateBoundary = (value: string, boundary: "start" | "end") =>
  new Date(`${value}T${boundary === "end" ? "23:59:59.999" : "00:00:00"}`);
const formatDisplayDate = (value: string) => format(parseDateBoundary(value, "start"), "dd/MM/yyyy");
const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

function netLabelFor(score: number): { label: string; tone: string } {
  if (score >= 30) return { label: "Muito favorável", tone: "text-success" };
  if (score >= 10) return { label: "Favorável", tone: "text-success" };
  if (score <= -30) return { label: "Muito desfavorável", tone: "text-destructive" };
  if (score <= -10) return { label: "Desfavorável", tone: "text-destructive" };
  return { label: "Neutro", tone: "text-muted-foreground" };
}

const TERM_KIND_COLOR: Record<Term["kind"], string> = {
  hashtag: "text-primary",
  pessoa: "text-foreground",
  partido: "text-warning",
  instituicao: "text-foreground",
  slogan: "text-accent",
  regiao: "text-muted-foreground",
};

export default function NetworkView() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [network, setNetwork] = useState("all");
  const [candidateId, setCandidateId] = useState<string>("all");
  const [days, setDays] = useState(365);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("365");
  const [customRange, setCustomRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [customPanelOpen, setCustomPanelOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [reprocessNonce, setReprocessNonce] = useState(0);

  const effectiveRange = useMemo(() => {
    if (customRange) {
      return {
        start: parseDateBoundary(customRange.startDate, "start"),
        end: parseDateBoundary(customRange.endDate, "end"),
        key: `${customRange.startDate}_${customRange.endDate}`,
      };
    }
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    return { start, end, key: `last_${days}` };
  }, [customRange, days]);

  const activePeriodLabel = customRange
    ? `Período: ${formatDisplayDate(customRange.startDate)} até ${formatDisplayDate(customRange.endDate)}`
    : `Período: Últimos ${PERIOD_LABEL[days] ?? days + " dias"}`;

  const { data: candidates } = useQuery({
    queryKey: ["nv-candidates", user?.id, isAdmin],
    queryFn: async () => {
      let q = supabase.from("candidates").select("id, full_name, party, region").eq("status", "active");
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      const { data, error } = await q.order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const candidate = useMemo(
    () => candidates?.find((c: any) => c.id === candidateId),
    [candidates, candidateId],
  );

  const start_date = toIsoDate(effectiveRange.start);
  const end_date = toIsoDate(effectiveRange.end);
  const filterKey = `${candidateId}|${start_date}|${end_date}|${network}`;
  const requestKey = `${filterKey}|${reprocessNonce}`;

  useEffect(() => {
    setActiveJobId(null);
  }, [requestKey]);

  useEffect(() => {
    setReprocessNonce(0);
  }, [filterKey]);

  const report = useQuery<JobResponse>({
    queryKey: ["nv-listening-job", candidateId, start_date, end_date, network, reprocessNonce, activeJobId],
    enabled: !!user && candidateId !== "all" && !!candidate?.full_name,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data as JobResponse | undefined;
      return state?.status === "processing" || state?.status === "queued" || state?.status === "running" ? 1200 : false;
    },
    queryFn: async () => {
      if (activeJobId) {
        const { data, error } = await supabase.functions.invoke("network-listening", {
          body: { action: "status", job_id: activeJobId },
        });
        if (error) throw error;
        return data as JobResponse;
      }

      const { data, error } = await supabase.functions.invoke("network-listening", {
        body: {
          action: "create",
          candidate_id: candidateId,
          candidate_name: (candidate as any).full_name,
          party: (candidate as any).party ?? null,
          office: null,
          state: (candidate as any).region ?? null,
          start_date,
          end_date,
          network,
          force_refresh: reprocessNonce > 0,
        },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.error) {
        const map: Record<string, string> = {
          RATE_LIMITED: "Muitas requisições agora. Aguarde alguns instantes e tente novamente.",
          NO_CREDITS: "Créditos de IA esgotados. Adicione créditos no workspace para continuar.",
          SERVICE_UNAVAILABLE: "Serviço de análise temporariamente indisponível. Tente novamente.",
        };
        throw new Error(map[d.error] ?? d.message ?? d.error);
      }
      if (d?.job_id) setActiveJobId(d.job_id);
      return data as JobResponse;
    },
  });

  const job = report.data;
  const data = job?.result;
  const isProcessing = job?.status === "processing" || job?.status === "queued" || job?.status === "running";
  const jobFailed = job?.status === "failed";
  const loading = report.isFetching || isProcessing;
  const needsCandidate = candidateId === "all";
  const evidenceCount = data?.evidence_count ?? 0;
  const renderState = data?.render_state ?? (data ? (evidenceCount === 0 ? "NO_DATA" : data.confidence === "low" || data.qualitative_only ? "PARTIAL_DATA" : "FULL_DATA") : undefined);

  // Derivações de exibição
  const netSentiment = data?.net_sentiment ?? 0;
  const { label: netLabel, tone: netTone } = netLabelFor(netSentiment);
  const dominant = data?.dominant_network;
  const distribution = useMemo(
    () => (data?.distribution ?? []).slice().sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)),
    [data?.distribution],
  );
  const socialViewDebug = data ? {
    evidence_count: evidenceCount,
    source_count: data.source_count ?? 0,
    pipeline_used: data.pipeline_used ?? "external_evidence_only",
    fallback_used: false,
    backfill_used: data.backfill_used === true,
    backfill_hits: data.backfill_hits ?? 0,
    confidence: data.confidence ?? "low",
  } : null;

  const applyCustomRange = () => {
    if (!startDate || !endDate) { setCustomError("Selecione ambas as datas"); return; }
    const s = parseDateBoundary(startDate, "start");
    const e = parseDateBoundary(endDate, "end");
    if (e < s) { setCustomError("Data final não pode ser menor que a inicial"); return; }
    setSelectedPeriod("custom");
    setCustomRange({ startDate, endDate });
    setCustomError(null);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Visão por Rede Social</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Social listening histórico — coleta externa (Google News, X, YouTube, Reddit, Telegram, blogs) + análise por IA. Independente do Radar Político.
          </p>
          <p className="text-xs text-muted-foreground mt-2 font-medium">{activePeriodLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Selecione um candidato</SelectItem>
              {candidates?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={network} onValueChange={setNetwork}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>{NETWORKS_FILTER.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex flex-wrap gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                type="button"
                variant={selectedPeriod === String(p.value) ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setSelectedPeriod(String(p.value));
                  setDays(p.value);
                  setCustomRange(null);
                  setCustomPanelOpen(false);
                  setCustomError(null);
                }}
              >
                {p.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={selectedPeriod === "custom" || customPanelOpen ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setCustomPanelOpen(true);
                setStartDate(customRange?.startDate ?? startDate);
                setEndDate(customRange?.endDate ?? endDate);
                setCustomError(null);
              }}
            >
              Personalizado
            </Button>
          </div>
        </div>
      </div>

      {customPanelOpen && (
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">De:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Até:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <Button onClick={applyCustomRange}>Aplicar período</Button>
          </div>
          {customError && <div className="text-xs text-destructive mt-3">{customError}</div>}
        </Card>
      )}

      {needsCandidate && (
        <Card className="p-8 text-center">
          <RadarIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">Selecione um candidato</h3>
          <p className="text-sm text-muted-foreground">
            Escolha um candidato para rodar a análise histórica de social listening.
          </p>
        </Card>
      )}

      {!needsCandidate && report.isError && (
        <Card className="p-4 text-sm text-destructive flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span>Falha ao gerar análise: {(report.error as Error)?.message ?? "erro desconhecido"}</span>
          <Button size="sm" variant="outline" onClick={() => { setActiveJobId(null); setReprocessNonce((n) => n + 1); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Reprocessar análise
          </Button>
        </Card>
      )}

      {!needsCandidate && isProcessing && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{job?.stage ?? "Processando análise..."}</span>
            <span className="text-muted-foreground tabular-nums">{Math.round(job?.progress ?? 0)}%</span>
          </div>
          <Progress value={job?.progress ?? 0} className="h-2" />
        </Card>
      )}

      {!needsCandidate && jobFailed && !data && (
        <Card className="p-4 text-sm border-destructive/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="text-muted-foreground">A análise falhou e nenhum fallback artificial foi aplicado: {job?.error ?? "erro desconhecido"}</span>
          <Button size="sm" variant="outline" onClick={() => { setActiveJobId(null); setReprocessNonce((n) => n + 1); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Reprocessar análise
          </Button>
        </Card>
      )}

      {!needsCandidate && (
        <>
          {/* Banner qualitativo quando confiança baixa */}
          {data && renderState === "PARTIAL_DATA" && (
            <Card className="p-4 border-warning/40 bg-warning/5 text-sm">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold mb-1">Dados insuficientes para análise quantitativa precisa</div>
                  <div className="text-muted-foreground">
                    Números, gráficos, assuntos e termos foram ocultados para não mostrar valores artificiais.
                    {` (${evidenceCount} evidências coletadas)`}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {data && renderState === "NO_DATA" && !loading && (
            <Card className="p-8 text-center border-warning/40">
              <RadarIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="text-lg font-semibold mb-1">Não foi possível coletar evidências suficientes para este período.</h3>
              <p className="text-sm text-muted-foreground">Nenhum número, gráfico, assunto ou termo foi exibido porque a coleta retornou 0 evidências.</p>
            </Card>
          )}

          {data && renderState === "PARTIAL_DATA" && !loading && (
            <Card className="p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Resumo qualitativo</h2>
                  <p className="text-sm text-muted-foreground">Poucas evidências reais foram encontradas; a análise permanece sem números estimados.</p>
                </div>
                <div className="text-sm font-semibold text-warning">Confiança {(data.confidence ?? "low").toUpperCase()}</div>
              </div>
              {data.reasoning && <p className="text-sm text-muted-foreground leading-relaxed">{data.reasoning}</p>}
            </Card>
          )}

          {(loading || !data || renderState === "FULL_DATA") && (<>

          {/* RESUMO EXECUTIVO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <BigKpi icon={<MessageSquare className="h-5 w-5" />} label="Total de menções" value={loading || !data ? null : data.total_mentions == null ? "—" : compact(data.total_mentions)} />
            <BigKpi icon={<Activity className="h-5 w-5" />} label="Total de interações" value={loading || !data ? null : data.total_interactions == null ? "—" : compact(data.total_interactions)} sub={loading || !data || data.total_interactions == null ? "" : "curtidas + shares + replies derivados das evidências"} />
            <BigKpi
              icon={<Gauge className="h-5 w-5" />}
              label="Sentimento líquido"
              value={loading || !data ? null : data.qualitative_only ? "—" : `${netSentiment > 0 ? "+" : ""}${netSentiment}`}
              sub={loading || !data || data.qualitative_only ? "" : (data.net_label ?? netLabel)}
              valueClassName={netTone}
            />
            <BigKpi
              icon={<Crown className="h-5 w-5" />}
              label="Confiança"
              value={loading || !data ? null : (data.confidence ?? "low").toUpperCase()}
              sub={loading || !data ? "" : dominant && !data.qualitative_only ? `Rede dominante: ${NETWORK_LABEL[dominant.toLowerCase()] ?? dominant}` : ""}
              valueClassName={data?.confidence === "high" ? "text-success" : data?.confidence === "medium" ? "text-warning" : "text-muted-foreground"}
            />
          </div>

          {/* DISTRIBUIÇÃO POR REDE — sempre visível, com badge data_source_type */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Distribuição por rede</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Peso calculado a partir das evidências reais coletadas (direct + proxy). Redes sem coleta direta exibem o tipo de fonte usada.
            </p>
            {loading || !data ? <Skeleton className="h-64 w-full" /> : distribution.length === 0 ? <Empty /> : (
              <div className="space-y-3">
                {distribution.map((n) => {
                  const badge: Record<DataSourceType, { label: string; cls: string }> = {
                    direct:      { label: "Direct",      cls: "bg-success/15 text-success border-success/30" },
                    proxy:       { label: "Proxy",       cls: "bg-warning/15 text-warning border-warning/30" },
                    unavailable: { label: "Sem dados",   cls: "bg-muted text-muted-foreground border-border" },
                  };
                  const rawDst = String(n.data_source_type ?? "unavailable") as DataSourceType;
                  const dst = rawDst in badge ? rawDst : "unavailable";
                  const hideNumbers = data.qualitative_only || dst === "unavailable";
                  return (
                    <div key={n.network} className="grid grid-cols-12 items-center gap-3">
                      <div className="col-span-4 md:col-span-3 flex items-center gap-2 text-sm font-medium">
                        <span>{NETWORK_LABEL[n.network.toLowerCase()] ?? n.network}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge[dst].cls}`}>{badge[dst].label}</span>
                      </div>
                      <div className="col-span-5 md:col-span-6">
                        <div className="h-3 rounded-full bg-muted overflow-hidden">
                          {!hideNumbers && <div className="h-full bg-gradient-to-r from-primary to-primary/60" style={{ width: `${Math.min(100, n.pct)}%` }} />}
                        </div>
                      </div>
                      <div className="col-span-3 md:col-span-3 flex items-center justify-end gap-3 text-xs tabular-nums">
                        {!hideNumbers && n.direct_hits != null && (
                          <span className="text-muted-foreground hidden md:inline">{n.direct_hits} direct · {n.external_hits ?? 0} proxy</span>
                        )}
                        <span className="w-12 text-right text-foreground font-medium">
                          {hideNumbers ? "—" : `${n.pct}%`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {!data?.qualitative_only && (<>
          {/* EVOLUÇÃO TEMPORAL */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Evolução temporal</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Volume por bucket dinâmico {data?.bucket ? `(${data.bucket})` : ""} com sobreposição de sentimento.
            </p>
            {loading || !data ? <Skeleton className="h-72 w-full" /> : (data.timeline ?? []).length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={data.timeline} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="total" name="Volume" stroke={COLORS.primary} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="positivo" name="Positivo" stroke={COLORS.positive} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="negativo" name="Negativo" stroke={COLORS.negative} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* SENTIMENTO POR REDE */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Sentimento por rede</h2>
            <p className="text-sm text-muted-foreground mb-6">Somente redes com evidência mínima; caso contrário, os percentuais ficam ocultos.</p>
            {loading || !data ? <Skeleton className="h-56 w-full" /> : (data.sentiment_by_network ?? []).length === 0 ? <Empty /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4">Rede</th>
                      <th className="py-2 pr-4">Distribuição</th>
                      <th className="py-2 pr-4 text-right w-20">+ %</th>
                      <th className="py-2 pr-4 text-right w-20">− %</th>
                      <th className="py-2 text-right w-20">~ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sentiment_by_network.map((n) => {
                      const lab = n.pos + n.neg + n.neu;
                      const p = pct(n.pos, lab), ng = pct(n.neg, lab), nu = pct(n.neu, lab);
                      return (
                        <tr key={n.network} className="border-b border-border/40 last:border-0">
                          <td className="py-3 pr-4 font-medium">{NETWORK_LABEL[n.network.toLowerCase()] ?? n.network}</td>
                          <td className="py-3 pr-4">
                            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted min-w-[140px]">
                              <div style={{ width: `${p}%`, backgroundColor: COLORS.positive }} />
                              <div style={{ width: `${ng}%`, backgroundColor: COLORS.negative }} />
                              <div style={{ width: `${nu}%`, backgroundColor: COLORS.neutral }} />
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums text-success">{p}%</td>
                          <td className="py-3 pr-4 text-right tabular-nums text-destructive">{ng}%</td>
                          <td className="py-3 text-right tabular-nums text-muted-foreground">{nu}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          </>
          )}

          {/* ASSUNTOS DOMINANTES */}
          {(loading || !data || (data.topics ?? []).length >= 3) && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Assuntos dominantes</h2>
            <p className="text-sm text-muted-foreground mb-6">Temas específicos extraídos por agrupamento das evidências coletadas.</p>
            {loading || !data ? <Skeleton className="h-56 w-full" /> : (data.topics ?? []).length === 0 ? <Empty /> : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(() => {
                  const total = data.topics.reduce((s, t) => s + (t.mentions || 0), 0);
                  return data.topics.map((t) => {
                    const lab = (t.pos ?? 0) + (t.neg ?? 0) + (t.neu ?? 0);
                    const share = total > 0 ? (t.mentions / total) * 100 : 0;
                    return (
                      <div key={t.label} className="rounded-lg border border-border p-4 bg-card/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold">{t.label}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{share.toFixed(1)}% relevância</span>
                        </div>
                        {lab > 0 && (
                          <div className="flex h-1.5 rounded-full overflow-hidden bg-muted mb-2">
                            <div style={{ width: `${pct(t.pos ?? 0, lab)}%`, backgroundColor: COLORS.positive }} />
                            <div style={{ width: `${pct(t.neg ?? 0, lab)}%`, backgroundColor: COLORS.negative }} />
                            <div style={{ width: `${pct(t.neu ?? 0, lab)}%`, backgroundColor: COLORS.neutral }} />
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground">{compact(t.mentions)} evidências relacionadas</div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </Card>
          )}

          {/* TERMOS EM ALTA */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Termos em alta</h2>
            <p className="text-sm text-muted-foreground mb-6">Entidades (pessoas, partidos, instituições), hashtags, slogans e regiões. Sem verbos ou stopwords.</p>
            {loading || !data ? <Skeleton className="h-40 w-full" /> : (data.terms ?? []).length === 0 ? <Empty /> : (
              <div className="flex flex-wrap gap-2">
                {data.terms.map((t) => {
                  const max = data.terms[0]?.count ?? 1;
                  const intensity = Math.max(0.3, Math.min(1, t.count / max));
                  return (
                    <div
                      key={`${t.kind}-${t.term}`}
                      className="rounded-full px-4 py-2 text-sm border border-border flex items-center gap-2 bg-card"
                      style={{ fontSize: `${0.85 + intensity * 0.35}rem`, opacity: 0.6 + intensity * 0.4 }}
                      title={`${t.kind} · ${compact(t.count)}`}
                    >
                      <span className={`${TERM_KIND_COLOR[t.kind] ?? "font-semibold"} font-semibold`}>
                        {t.term}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.kind}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {data?.reasoning && (
            <Card className="p-4 text-xs text-muted-foreground flex gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>{data.reasoning}</span>
            </Card>
          )}
          </>)}

          {socialViewDebug && (
            <pre id="social_view_debug" className="hidden" aria-hidden="true">
              {JSON.stringify(socialViewDebug)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function BigKpi({ icon, label, value, sub, valueClassName }: { icon: React.ReactNode; label: string; value: string | null; sub?: string; valueClassName?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
        <span className="text-primary">{icon}</span>{label}
      </div>
      {value === null ? <Skeleton className="h-9 w-32" /> : (
        <div className={`text-3xl font-bold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
      )}
      {sub && <div className="text-xs text-muted-foreground mt-2">{sub}</div>}
    </Card>
  );
}

function Empty() {
  return <div className="text-sm text-muted-foreground py-10 text-center">Sem dados suficientes para este período.</div>;
}
