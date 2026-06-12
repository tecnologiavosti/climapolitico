import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, CalendarDays, Newspaper, ChevronDown, ChevronUp,
  Landmark, Vote, Gavel, Mic, Users, TrendingUp, Video, MessageSquare, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { AnnualPeaksTimeline } from "@/components/events/AnnualPeaksTimeline";
import { MonthlyPeaksHeatmap } from "@/components/events/MonthlyPeaksHeatmap";
import { Slider } from "@/components/ui/slider";
import { EnterprisePeakSheet, type EnterprisePeakEvent } from "@/components/events/EnterprisePeakSheet";




interface HistoricalEvent {
  name: string;
  type: string;
  start_date: string;
  end_date: string;
  description: string;
  motivo?: string;
  what_happened?: string;
  why_happened?: string;
  participants?: string[];
  political_impact?: string;
  electoral_impact?: string;
  aftermath?: string;
  keywords?: string[];
  relevance_score: number;
  publications_count: number;
  distinct_outlets: number;
  coverage_days?: number;
  news_count: number;
  videos_count: number;
  posts_count: number;
  estimated_volume: number;
  volume_available?: boolean;
  sentiment_available?: boolean;
  evidence_level?: string;
  sentiment_positive: number;
  sentiment_negative: number;
  sentiment_neutral: number;
  sources_count?: number;
  outlet_names?: string[];
  internal_mentions?: number;
  internal_authors?: number;
  internal_engagement?: number;
  internal_by_network?: Record<string, number>;
  internal_window_days?: number;
  coverage_quality?: "forte" | "media" | "fraca" | "ai_only";
  detected_by?: "external" | "external_social" | "internal_ssot" | "none";
  peak_type?: "external_confirmed" | "external_social" | "internal_trend";
  political_relevance?: number;
  category?: string;
  status?: "confirmed" | "probable" | "weak" | "indeterminate";
  confidence_score?: number;
  independent_strong_sources?: number;
  trusted_sources_count?: number;
  relevance_band?: "baixa" | "media" | "alta" | "critica";
  signals?: Array<"z" | "ewma" | "momentum" | "burst" | "anomaly">;
}

const CATEGORY_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "eleicoes", label: "Eleições" },
  { id: "operacoes_pf", label: "Operações PF" },
  { id: "stf", label: "STF" },
  { id: "tse", label: "TSE" },
  { id: "cpi", label: "CPI" },
  { id: "julgamentos", label: "Julgamentos" },
  { id: "escandalos", label: "Escândalos" },
  { id: "prisoes", label: "Prisões" },
  { id: "debates", label: "Debates" },
  { id: "congresso", label: "Congresso" },
  { id: "executivo", label: "Executivo" },
  { id: "economia", label: "Economia" },
  { id: "internacional", label: "Internacional" },
  { id: "outros", label: "Outros" },
];

const COVERAGE_BADGE: Record<string, { label: string; className: string }> = {
  forte: { label: "Cobertura forte", className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" },
  media: { label: "Cobertura média", className: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300" },
  fraca: { label: "Cobertura fraca", className: "bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300" },
  ai_only: { label: "Registro histórico (IA)", className: "bg-primary/10 text-primary border-primary/30" },
};

const STATUS_BADGE: Record<string, { label: string; className: string; emoji: string }> = {
  confirmed: { emoji: "🟢", label: "Evento confirmado", className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" },
  probable: { emoji: "🟡", label: "Evento provável", className: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300" },
  weak: { emoji: "🟠", label: "Evidência fraca", className: "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300" },
  indeterminate: { emoji: "🔴", label: "Causa indeterminada", className: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300" },
};

const SIGNAL_LABEL: Record<string, string> = {
  z: "Z-score", ewma: "EWMA", momentum: "Momentum", burst: "Burst", anomaly: "Anomaly",
};

const RELEVANCE_BAND_LABEL: Record<string, string> = {
  baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica",
};

const NETWORK_LABEL: Record<string, string> = {
  youtube: "YouTube", twitter: "Twitter / X", telegram: "Telegram", tiktok: "TikTok",
  facebook: "Facebook", google_news: "Google News", reddit: "Reddit", bluesky: "Bluesky",
  linkedin: "LinkedIn", instagram: "Instagram", mastodon: "Mastodon", lemmy: "Lemmy",
  wikipedia: "Wikipedia", pinterest: "Pinterest", gdelt: "GDELT", "4chan": "4chan",
};

interface ExternalTimelinePoint {
  date: string; total: number; news: number; videos: number; posts: number;
}

interface HistoricalResponse {
  success?: boolean;
  stage?: string;
  error?: string;
  events: HistoricalEvent[];
  publications_collected: number;
  estimated_reach?: number;
  external_timeline?: ExternalTimelinePoint[];
}

const typeIcon: Record<string, JSX.Element> = {
  eleicao: <Vote className="h-4 w-4" />,
  votacao: <Vote className="h-4 w-4" />,
  cpi: <Landmark className="h-4 w-4" />,
  decisao_judicial: <Gavel className="h-4 w-4" />,
  operacao: <Gavel className="h-4 w-4" />,
  debate: <Mic className="h-4 w-4" />,
  entrevista: <Mic className="h-4 w-4" />,
  discurso: <Mic className="h-4 w-4" />,
  coletiva: <Mic className="h-4 w-4" />,
  agenda: <CalendarDays className="h-4 w-4" />,
  noticia: <Newspaper className="h-4 w-4" />,
};

function formatDate(date: string): string {
  try { return new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return date; }
}
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

async function getEdgeFunctionErrorMessage(error: any, data?: any): Promise<string> {
  const payload = data && typeof data === "object" ? data : null;
  if (payload?.stage) return `Falha na etapa: ${payload.stage}${payload.error ? ` — ${payload.error}` : ""}`;
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const body = await response.clone().json();
      if (body?.stage) return `Falha na etapa: ${body.stage}${body.error ? ` — ${body.error}` : ""}`;
      if (body?.error && typeof body.error === "string") return body.error;
      if (body?.message) return String(body.message);
    } catch {
      try {
        const text = await response.clone().text();
        if (text) return text;
      } catch { /* noop */ }
    }
  }
  const message = String(error?.message || "Erro ao detectar picos");
  return message.includes("non-2xx") ? "Falha na etapa: retorno_final" : message;
}

const YEAR_PRESETS = [
  { label: "Eleição 2018", start: "2018-01-01", end: "2018-12-31" },
  { label: "Mandato 2019-2022", start: "2019-01-01", end: "2022-12-31" },
  { label: "Eleição 2022", start: "2022-01-01", end: "2022-12-31" },
  { label: "Mandato 2023-2026", start: "2023-01-01", end: "2026-12-31" },
  { label: "Eleição 2024", start: "2024-01-01", end: "2024-12-31" },
  { label: "Eleição 2026", start: "2026-01-01", end: "2026-12-31" },
];

interface PeakCause {
  response_mode?: "CONFIRMED_EVENT" | "PROBABLE_NARRATIVE" | "UNKNOWN_TRIGGER";
  event_title: string;
  event_summary: string;
  root_cause: string;
  confidence: number;
  // Enterprise v2 fields
  cause?: string;
  why_peak?: string;
  evidence_quality?: "strong" | "moderate" | "weak" | "insufficient";
  sentiment?: number; // -1..+1
  enterprise_score?: number;
  enterprise_band?: "confirmado" | "provavel" | "fraco" | "indeterminado";
  score_components?: { coverage: number; diversity: number; consensus: number; significance: number };
  key_terms?: string[];
  main_networks: string[];
  main_entities: string[];
  top_keywords?: Array<{ term: string; count: number }>;
  top_hashtags?: Array<{ term: string; count: number }>;
  top_domains?: Array<{ domain: string; count: number }>;
  sentiment_summary: string;
  internal_mentions?: number;
  external_evidence?: Array<{ title: string; url: string; outlet: string; publishedAt?: string; source_strength?: "strong" | "weak" }>;
  fallback_text?: string | null;
}


export default function EventReport() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("");
  const [candidateName, setCandidateName] = useState<string>("");
  const [startDate, setStartDate] = useState("2018-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [causes, setCauses] = useState<Record<string, PeakCause>>({});
  const [causeLoading, setCauseLoading] = useState<Record<string, boolean>>({});
  const [causeError, setCauseError] = useState<Record<string, string>>({});
  const [enterpriseEvent, setEnterpriseEvent] = useState<EnterprisePeakEvent | null>(null);

  const { data: candidates } = useQuery({
    queryKey: ["candidates-mine", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates").select("id, full_name, party")
        .eq("user_id", user!.id).order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["external-peaks", candidateId, startDate, endDate],
    queryFn: async (): Promise<HistoricalResponse> => {
      const { data, error } = await supabase.functions.invoke("detect-historical-peaks", {
        body: { candidateId, startDate, endDate },
      });
      if (error) throw new Error(await getEdgeFunctionErrorMessage(error, data));
      if ((data as any)?.success === false || (data as any)?.error) {
        throw new Error(await getEdgeFunctionErrorMessage(null, data));
      }
      return data as HistoricalResponse;
    },
    enabled: false,
  });

  const events = useMemo(() => data?.events || [], [data]);
  const statusCounts = useMemo(() => {
    const c = { confirmed: 0, probable: 0, weak: 0, indeterminate: 0 };
    for (const e of events) {
      const s = (e.status || "indeterminate") as keyof typeof c;
      if (s in c) c[s]++;
    }
    return c;
  }, [events]);
  const filteredEvents = useMemo(
    () => events.filter((e) => {
      if (category !== "all" && (e.category || "outros") !== category) return false;
      if (statusFilter !== "all" && (e.status || "indeterminate") !== statusFilter) return false;
      const score = typeof e.confidence_score === "number" ? e.confidence_score * 100 : (e.relevance_score ?? 0);
      if (score < minConfidence) return false;
      return true;
    }),
    [events, category, statusFilter, minConfidence],
  );
  const eventsByYear = useMemo(() => {
    const groups = new Map<string, HistoricalEvent[]>();
    for (const ev of [...filteredEvents].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
      const year = (ev.start_date || "").slice(0, 4) || "—";
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year)!.push(ev);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEvents]);
  // timeline retornado pelo backend não é exibido — foco em eventos relevantes.

  const handleSearch = () => {
    if (!candidateId) { toast.error("Selecione um candidato"); return; }
    if (!startDate || !endDate || new Date(startDate) > new Date(endDate)) {
      toast.error("Período inválido"); return;
    }
    refetch();
  };

  return (
    <div className="space-y-6 p-2 md:p-4">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-7 w-7 text-primary" /> Picos de Menções
        </h1>
        <p className="text-muted-foreground text-sm">
          Inteligência política histórica. Detecta apenas acontecimentos com repercussão nacional documentada — crises, escândalos, operações, decisões do STF, CPIs, julgamentos, prisões, impeachments, eleições e debates. Comícios, agendas e visitas de rotina são automaticamente descartados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pesquisar picos</CardTitle>
          <CardDescription>Escolha o candidato e o período. A relevância é calculada a partir da diversidade de veículos, da duração da repercussão e do impacto político.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Candidato</label>
              <Select value={candidateId} onValueChange={(v) => { setCandidateId(v); setCandidateName(candidates?.find((c)=>c.id===v)?.full_name || ""); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {candidates?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name}{c.party ? ` (${c.party})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Início</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fim</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {YEAR_PRESETS.map((p) => (
              <Button key={p.label} variant="outline" size="sm"
                onClick={() => { setStartDate(p.start); setEndDate(p.end); }}>
                {p.label}
              </Button>
            ))}
          </div>
          <Button onClick={handleSearch} disabled={isFetching || !candidateId} className="w-full md:w-auto">
            {isFetching ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Pesquisando volume externo...</> : "Detectar picos"}
          </Button>
          {error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : null}
        </CardContent>
      </Card>

      {isFetching ? (
        <Card><CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Coletando publicações externas em portais, redes e plataformas de vídeo...</p>
        </CardContent></Card>
      ) : null}

      {!isFetching && data && events.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground space-y-2">
          <Newspaper className="h-10 w-10 mx-auto opacity-50" />
          <p className="font-medium">Nenhum pico encontrado em fontes externas.</p>
          <p className="text-sm">Buscando correlação nas redes monitoradas… Se ainda assim nada for encontrado, amplie o intervalo ou selecione outro candidato.</p>
        </CardContent></Card>
      ) : null}

      {/* Linha do tempo agregada removida — exibimos apenas acontecimentos com relevância política comprovada. */}

      {events.length > 0 ? (
        <div className="space-y-5">
          {/* Contadores por status */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {([
              { id: "all", label: "Total", emoji: "📊", value: events.length, cls: "border-primary/30 bg-primary/5" },
              { id: "confirmed", label: "Confirmados", emoji: "🟢", value: statusCounts.confirmed, cls: "border-emerald-500/30 bg-emerald-500/5" },
              { id: "probable", label: "Prováveis", emoji: "🟡", value: statusCounts.probable, cls: "border-amber-500/30 bg-amber-500/5" },
              { id: "weak", label: "Fracos", emoji: "🟠", value: statusCounts.weak, cls: "border-orange-500/30 bg-orange-500/5" },
              { id: "indeterminate", label: "Indeterminados", emoji: "🔴", value: statusCounts.indeterminate, cls: "border-rose-500/30 bg-rose-500/5" },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setStatusFilter(s.id)}
                className={`rounded-md border px-3 py-2 text-left transition ${s.cls} ${statusFilter === s.id ? "ring-2 ring-primary" : "opacity-90 hover:opacity-100"}`}
              >
                <div className="text-[11px] uppercase text-muted-foreground">{s.emoji} {s.label}</div>
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" /> Enciclopédia política ({filteredEvents.length}/{events.length})
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_FILTERS.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={category === c.id ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="text-xs font-medium text-muted-foreground sm:w-44">Confiança mínima: <span className="tabular-nums text-foreground">{minConfidence}</span></div>
            <div className="flex-1">
              <Slider value={[minConfidence]} onValueChange={(v) => setMinConfidence(v[0] ?? 0)} min={0} max={100} step={5} />
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhum pico encontrado nesta categoria ou acima da confiança mínima.
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              <AnnualPeaksTimeline
                events={filteredEvents.map((e) => ({
                  date: e.start_date,
                  title: e.name,
                  category: e.category,
                  status: (e.status || "indeterminate") as "confirmed" | "probable" | "weak" | "indeterminate",
                  score: typeof e.confidence_score === "number" ? Math.round(e.confidence_score * 100) : e.relevance_score,
                  mentions: e.internal_mentions || e.estimated_volume || e.publications_count,
                }))}
              />
              <MonthlyPeaksHeatmap
                events={filteredEvents.map((e) => ({
                  date: e.start_date,
                  status: (e.status || "indeterminate") as "confirmed" | "probable" | "weak" | "indeterminate",
                  score: typeof e.confidence_score === "number" ? Math.round(e.confidence_score * 100) : e.relevance_score,
                }))}
              />
            </div>
          )}

          {eventsByYear.map(([year, yearEvents]) => (
            <div key={year} className="space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="text-2xl font-bold tracking-tight text-primary">{year}</h3>
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground">{yearEvents.length} acontecimento{yearEvents.length === 1 ? "" : "s"}</span>
              </div>
              {yearEvents.map((ev, idx) => {
            const key = `${year}-${idx}-${ev.start_date}`;
            const isOpen = !!expanded[key];
            const icon = typeIcon[ev.type] || <Newspaper className="h-4 w-4" />;
            const coverage = COVERAGE_BADGE[ev.coverage_quality || "fraca"];
            const statusBadge = STATUS_BADGE[ev.status || "indeterminate"];
            const categoryLabel = CATEGORY_FILTERS.find((c) => c.id === (ev.category || "outros"))?.label || "Outros";
            return (
              <Card key={key} className="border-l-4 border-l-primary/60">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <CalendarDays className="h-3.5 w-3.5" />
                        <span>{formatDate(ev.start_date)}{ev.end_date && ev.end_date !== ev.start_date ? ` → ${formatDate(ev.end_date)}` : ""}</span>
                        {statusBadge ? (
                          <Badge variant="outline" className={`text-[10px] font-medium ${statusBadge.className}`}>
                            {statusBadge.emoji} {statusBadge.label}
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className="text-[10px] font-normal">{categoryLabel}</Badge>
                        {coverage ? (
                          <Badge variant="outline" className={`text-[10px] font-normal ${coverage.className}`}>{coverage.label}</Badge>
                        ) : null}
                        {typeof ev.relevance_score === "number" ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            Relevância {ev.relevance_score}/100{ev.relevance_band ? ` · ${RELEVANCE_BAND_LABEL[ev.relevance_band]}` : ""}
                          </Badge>
                        ) : null}
                        {Array.isArray(ev.signals) && ev.signals.length > 0 ? (
                          <Badge variant="outline" className="text-[10px] font-normal border-primary/40 text-primary">
                            Sinais: {ev.signals.map((s) => SIGNAL_LABEL[s] || s).join(" · ")}
                          </Badge>
                        ) : null}
                        {typeof ev.trusted_sources_count === "number" && ev.trusted_sources_count > 0 ? (
                          <Badge variant="outline" className="text-[10px] font-normal border-blue-500/40 text-blue-600 dark:text-blue-400">
                            {ev.trusted_sources_count} fonte{ev.trusted_sources_count === 1 ? "" : "s"} confiáve{ev.trusted_sources_count === 1 ? "l" : "is"}
                          </Badge>
                        ) : null}
                      </div>
                      <CardTitle className="text-base md:text-lg leading-snug flex items-start gap-2">
                        <span className="text-primary mt-0.5">{icon}</span>
                        <span>{ev.name}</span>
                      </CardTitle>
                      {ev.status === "indeterminate" ? (
                        <p className="text-xs text-muted-foreground italic">
                          A IA não encontrou evidências externas suficientes para classificar este pico como um evento factual.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="text-[11px] uppercase text-muted-foreground">Citações</div>
                      <div className="text-xl font-bold">Indisponível</div>
                      <div className="text-[11px] text-muted-foreground">não estimamos volume</div>
                    </div>
                    <div className="rounded-md border p-3 flex items-start gap-2">
                      <Newspaper className="h-4 w-4 text-primary mt-0.5" />
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Notícias</div>
                        <div className="text-xl font-bold">{formatNumber(ev.news_count)}</div>
                      </div>
                    </div>
                    <div className="rounded-md border p-3 flex items-start gap-2">
                      <Video className="h-4 w-4 text-red-500 mt-0.5" />
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Vídeos</div>
                        <div className="text-xl font-bold">{formatNumber(ev.videos_count)}</div>
                      </div>
                    </div>
                    <div className="rounded-md border p-3 flex items-start gap-2">
                      <MessageSquare className="h-4 w-4 text-green-600 mt-0.5" />
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Posts</div>
                        <div className="text-xl font-bold">{formatNumber(ev.posts_count)}</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase text-muted-foreground mb-1.5">Sentimento agregado</div>
                    {ev.sentiment_available ? (
                      <>
                        <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
                          <div className="bg-green-500" style={{ width: `${ev.sentiment_positive}%` }} />
                          <div className="bg-zinc-400" style={{ width: `${ev.sentiment_neutral}%` }} />
                          <div className="bg-red-500" style={{ width: `${ev.sentiment_negative}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                          <span className="text-green-600">{ev.sentiment_positive}% positivo</span>
                          <span>{ev.sentiment_neutral}% neutro</span>
                          <span className="text-red-600">{ev.sentiment_negative}% negativo</span>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Dados insuficientes para análise de sentimento.
                      </div>
                    )}
                  </div>

                  <p className="text-sm leading-relaxed">{ev.description}</p>

                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                    Cobertura detectada em <span className="font-semibold text-foreground">{ev.distinct_outlets}</span> veículo{ev.distinct_outlets === 1 ? "" : "s"} · <span className="font-semibold text-foreground">{ev.publications_count}</span> evidência{ev.publications_count === 1 ? "" : "s"} externa{ev.publications_count === 1 ? "" : "s"}.
                  </div>

                  {(ev.internal_mentions ?? 0) > 0 ? (
                    <div className="rounded-md border bg-primary/5 px-3 py-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Repercussão observada nas redes monitoradas (±{ev.internal_window_days ?? 14}d)
                      </p>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-lg font-bold text-foreground">{formatNumber(ev.internal_mentions ?? 0)}</p>
                          <p className="text-[11px] text-muted-foreground">menções</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-foreground">{formatNumber(ev.internal_authors ?? 0)}</p>
                          <p className="text-[11px] text-muted-foreground">autores únicos</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-foreground">{formatNumber(ev.internal_engagement ?? 0)}</p>
                          <p className="text-[11px] text-muted-foreground">engajamento</p>
                        </div>
                      </div>
                      {ev.internal_by_network && Object.keys(ev.internal_by_network).length > 0 ? (
                        <div className="pt-2 border-t space-y-1.5">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Distribuição por rede</p>
                          {Object.entries(ev.internal_by_network)
                            .map(([n, v]) => [n, Number(v) || 0] as [string, number])
                            .sort((a, b) => b[1] - a[1])
                            .filter(([, v]) => v > 0)
                            .map(([net, v]) => {
                              const pct = Math.round((v / Math.max(1, ev.internal_mentions ?? 1)) * 100);
                              return (
                                <div key={net} className="flex items-center gap-2 text-xs">
                                  <span className="w-24 shrink-0 text-muted-foreground">{NETWORK_LABEL[net] ?? net}</span>
                                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                                  </div>
                                  <span className="w-20 text-right tabular-nums text-foreground">{formatNumber(v)} <span className="text-muted-foreground">({pct}%)</span></span>
                                </div>
                              );
                            })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {ev.outlet_names && ev.outlet_names.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Veículos que repercutiram</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ev.outlet_names.map((o, i) => (
                          <Badge key={`${key}-out-${i}`} variant="outline" className="font-normal">{o}</Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" className="gap-2"
                      onClick={async () => {
                        const willOpen = !isOpen;
                        setExpanded((p) => ({ ...p, [key]: willOpen }));
                        if (willOpen && !causes[key] && !causeLoading[key]) {
                          setCauseLoading((p) => ({ ...p, [key]: true }));
                          setCauseError((p) => ({ ...p, [key]: "" }));
                          try {
                            const { data: c, error: cErr } = await supabase.functions.invoke("resolve-peak-cause", {
                              body: {
                                candidateId,
                                candidateName,
                                peakDate: ev.start_date,
                                windowStart: ev.start_date,
                                windowEnd: ev.end_date || ev.start_date,
                                peakMentions: ev.internal_mentions ?? 0,
                              },
                            });
                            if (cErr) throw cErr;
                            if ((c as any)?.error) throw new Error((c as any).error);
                            setCauses((p) => ({ ...p, [key]: c as PeakCause }));
                          } catch (e) {
                            setCauseError((p) => ({ ...p, [key]: (e as Error).message }));
                          } finally {
                            setCauseLoading((p) => ({ ...p, [key]: false }));
                          }
                        }
                      }}>
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      {isOpen ? "Recolher análise IA" : "Análise IA do pico"}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2"
                      onClick={() => setEnterpriseEvent(ev as unknown as EnterprisePeakEvent)}>
                      <BarChart3 className="h-4 w-4" />
                      Métricas enterprise
                    </Button>
                  </div>

                  {isOpen ? (
                    <div className="space-y-4 pt-2 border-t">
                      {causeLoading[key] ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                          <Loader2 className="h-4 w-4 animate-spin" /> Investigando causa do pico…
                        </div>
                      ) : causeError[key] ? (
                        <p className="text-sm text-destructive">{causeError[key]}</p>
                      ) : causes[key] ? (
                        <PeakCauseView cause={causes[key]} />
                      ) : null}

                      {ev.what_happened ? <Section title="O que aconteceu (registro)" body={ev.what_happened} /> : null}
                      {ev.why_happened ? <Section title="Por que gerou repercussão (registro)" body={ev.why_happened} /> : null}
                      {ev.political_impact ? <Section title="Impacto político" body={ev.political_impact} /> : null}
                      {ev.electoral_impact ? <Section title="Impacto eleitoral" body={ev.electoral_impact} /> : null}
                      {ev.aftermath ? <Section title="Desdobramentos" body={ev.aftermath} /> : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
            </div>
          ))}
        </div>
      ) : null}

      <EnterprisePeakSheet
        open={!!enterpriseEvent}
        onOpenChange={(v) => { if (!v) setEnterpriseEvent(null); }}
        event={enterpriseEvent}
      />
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{title}</p>
      <p className="text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function PeakCauseView({ cause }: { cause: PeakCause }) {
  const conf = Math.round((cause.confidence || 0) * 100);
  const confColor = conf >= 60 ? "text-emerald-600 dark:text-emerald-400" : conf >= 30 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500";
  const modeLabel = cause.response_mode === "CONFIRMED_EVENT"
    ? "Evento confirmado"
    : cause.response_mode === "PROBABLE_NARRATIVE"
      ? "Narrativa provável"
      : "Causa indeterminada";
  return (
    <div className="space-y-4 rounded-md border bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{modeLabel}</p>
          <p className="text-base font-semibold leading-snug">{cause.event_title}</p>
        </div>
        <Badge variant="outline" className={`text-xs ${confColor}`}>Confiança {conf}%</Badge>
      </div>

      {cause.fallback_text ? (
        <p className="text-sm text-muted-foreground italic">{cause.fallback_text}</p>
      ) : (
        <>
          {cause.event_summary ? <Section title="O que aconteceu" body={cause.event_summary} /> : null}
          {cause.root_cause ? <Section title="Por que virou pico" body={cause.root_cause} /> : null}
        </>
      )}

      {cause.main_networks?.length ? (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Redes onde mais repercutiu</p>
          <div className="flex flex-wrap gap-1.5">
            {cause.main_networks.slice(0, 8).map((n, i) => (
              <Badge key={i} variant="secondary" className="capitalize">{n}</Badge>
            ))}
          </div>
        </div>
      ) : null}

      {cause.main_entities?.length ? (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Principais entidades</p>
          <div className="flex flex-wrap gap-1.5">
            {cause.main_entities.slice(0, 12).map((e, i) => (
              <Badge key={i} variant="outline">{e}</Badge>
            ))}
          </div>
        </div>
      ) : null}

      {cause.top_keywords?.length ? (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Termos mais associados</p>
          <div className="flex flex-wrap gap-1.5">
            {cause.top_keywords.slice(0, 12).map((k, i) => (
              <Badge key={i} variant="outline" className="font-normal">{k.term} <span className="text-muted-foreground ml-1">({k.count})</span></Badge>
            ))}
          </div>
        </div>
      ) : null}

      {cause.sentiment_summary ? (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Sentimento</p>
          <p className="text-sm">{cause.sentiment_summary}</p>
        </div>
      ) : null}

      {cause.external_evidence?.length ? (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Evidências externas ({cause.external_evidence.length})</p>
          <ul className="space-y-1 text-sm">
            {cause.external_evidence.slice(0, 8).map((e, i) => (
              <li key={i} className="leading-snug">
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {e.title || e.url}
                </a>
                <span className="text-muted-foreground"> — {e.outlet}{e.publishedAt ? ` · ${e.publishedAt.slice(0, 10)}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Baseado em {cause.internal_mentions ?? 0} interações monitoradas. Nenhuma publicação externa relevante foi encontrada na janela.</p>
      )}
    </div>
  );
}
