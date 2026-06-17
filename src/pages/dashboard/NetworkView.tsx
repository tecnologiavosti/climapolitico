import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { MessageSquare, Activity, Gauge, Crown, Radar as RadarIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// ------------------------------------------------------------
// Pipeline: Visão por Rede Social agora reutiliza o Radar Político
// (radar-job-create + radar-job-status) como fonte primária. Todos os
// blocos são derivados dos eventos coletados. Sentimento por evento é
// inferido pela função network-view-sentiment. Tópicos/termos pela
// função network-view-intelligence (sobre títulos+resumos reais).
// ------------------------------------------------------------

interface RadarEvent {
  id?: string;
  title: string;
  summary?: string;
  description?: string;
  snippet?: string;
  content?: string;
  category?: string;
  event_date: string;
  source_count?: number;
  social_score?: number;
  importance?: number;
  sources?: Array<{ name?: string; url?: string; type?: string }>;
}

interface RadarJobStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  events_count: number;
  events: RadarEvent[];
  error: string | null;
  has_more?: boolean;
}

const NETWORK_LABEL: Record<string, string> = {
  youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", telegram: "Telegram",
  twitter: "X / Twitter", news: "Notícias", linkedin: "LinkedIn", reddit: "Reddit",
  instagram: "Instagram", bluesky: "Bluesky",
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
const compact = (n: number) => Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n ?? 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const parseDateBoundary = (value: string, boundary: "start" | "end") =>
  new Date(`${value}T${boundary === "end" ? "23:59:59.999" : "00:00:00"}`);
const formatDisplayDate = (value: string) => format(parseDateBoundary(value, "start"), "dd/MM/yyyy");

// Aliases canônicos network → tokens que o Radar pode salvar em type/name/url
const NETWORK_ALIASES: Record<string, string[]> = {
  youtube: ["youtube", "invidious", "yt.", "youtu.be"],
  tiktok: ["tiktok"],
  instagram: ["instagram", "instagr.am"],
  facebook: ["facebook", "fb.com"],
  telegram: ["telegram", "t.me"],
  twitter: ["twitter", "x.com", "nitter", "bluesky", "bsky", " x ", "/x/"],
  reddit: ["reddit", "4chan", "lemmy"],
  linkedin: ["linkedin"],
  news: [
    "news", "google_news", "gdelt", "g1", "uol", "folha", "globo",
    "jornal", "portal", "estadao", "veja", "terra", "cnn", "bbc",
    "noticia", "notícia", "press", "rss",
  ],
};

const STANDALONE_NETWORK: Record<string, string> = {
  x: "twitter", twitter: "twitter",
  youtube: "youtube", tiktok: "tiktok", instagram: "instagram",
  facebook: "facebook", telegram: "telegram", reddit: "reddit",
  linkedin: "linkedin", bluesky: "twitter",
  news: "news", google_news: "news",
};

// Mapeia source.type/source.name → network canônica usada na UI
function mapSourceToNetwork(s: { name?: string; url?: string; type?: string }): string | null {
  // 1) Match exato em type/name (cobre "x", "twitter", "news", "google_news", etc.)
  for (const raw of [s.type, s.name]) {
    if (!raw) continue;
    const key = String(raw).trim().toLowerCase();
    if (STANDALONE_NETWORK[key]) return STANDALONE_NETWORK[key];
  }
  // 2) Match por substring (cobre URLs e nomes compostos)
  const blob = ` ${s.type ?? ""} ${s.name ?? ""} ${s.url ?? ""} `.toLowerCase();
  for (const [net, tokens] of Object.entries(NETWORK_ALIASES)) {
    if (tokens.some((t) => blob.includes(t))) return net;
  }
  return null;
}

function eventNetworks(ev: RadarEvent): string[] {
  const set = new Set<string>();
  for (const s of ev.sources ?? []) {
    const n = mapSourceToNetwork(s);
    if (n) set.add(n);
  }
  // Sem sources reconhecidas → tratamos como "news" (cobertura de imprensa)
  if (set.size === 0) set.add("news");
  return Array.from(set);
}

type TopicRow = { label?: string; theme?: string; mentions: number; pos: number; neg: number; neu: number; relevance?: number };
type TermRow = { term: string; count: number; kind: "hashtag" | "entity" };

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

  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [startingJob, setStartingJob] = useState(false);
  const lastJobKey = useRef<string | null>(null);

  // Range efetivo
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

  const rangeDays = useMemo(
    () => Math.max(1, Math.ceil((effectiveRange.end.getTime() - effectiveRange.start.getTime()) / 86_400_000)),
    [effectiveRange],
  );

  const activePeriodLabel = customRange
    ? `Período: ${formatDisplayDate(customRange.startDate)} até ${formatDisplayDate(customRange.endDate)}`
    : `Período: Últimos ${PERIOD_LABEL[days] ?? days + " dias"}`;

  const { data: candidates } = useQuery({
    queryKey: ["nv-candidates", user?.id, isAdmin],
    queryFn: async () => {
      let q = supabase.from("candidates").select("id, full_name").eq("status", "active");
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      const { data, error } = await q.order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const candidateName = useMemo(
    () => candidates?.find((c: any) => c.id === candidateId)?.full_name as string | undefined,
    [candidates, candidateId],
  );

  // Dispara job do Radar sempre que candidato/período mudar
  const jobKey = `${candidateId}|${effectiveRange.key}`;
  const startMutation = useMutation({
    mutationFn: async () => {
      if (candidateId === "all" || !candidateName) throw new Error("Selecione um candidato");
      const start_date = effectiveRange.start.toISOString().slice(0, 10);
      const end_date = effectiveRange.end.toISOString().slice(0, 10);
      const { data, error } = await supabase.functions.invoke("radar-job-create", {
        body: { candidate_id: candidateId, candidate_name: candidateName, start_date, end_date, categories: [], sort: "date", force_refresh: false },
      });
      if (error) throw error;
      return data as { job_id?: string | null; status: string; events?: RadarEvent[]; cached?: boolean };
    },
    onSuccess: (data) => {
      if (Array.isArray(data.events) && data.events.length > 0) {
        setEvents(data.events);
      } else {
        setEvents([]);
      }
      setJobId(data.job_id ?? null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Falha ao iniciar coleta";
      toast.error(msg);
      setEvents([]);
      setJobId(null);
    },
  });

  useEffect(() => {
    if (candidateId === "all" || !candidateName) {
      setEvents([]);
      setJobId(null);
      lastJobKey.current = null;
      return;
    }
    if (lastJobKey.current === jobKey) return;
    lastJobKey.current = jobKey;
    setEvents([]);
    setJobId(null);
    setStartingJob(true);
    startMutation.mutate(undefined, { onSettled: () => setStartingJob(false) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey, candidateName]);

  // Polling do status
  const statusQuery = useQuery({
    queryKey: ["nv-radar-job", jobId, events.length],
    enabled: !!jobId && jobId !== "cache",
    refetchInterval: (q) => {
      const s = (q.state.data as RadarJobStatus | undefined)?.status;
      if (s === "completed" || s === "failed") return false;
      return 2500;
    },
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("radar-job-status", {
        body: { job_id: jobId, page_size: 50, offset: events.length, sort: "date" },
      });
      if (error) throw error;
      return data as RadarJobStatus;
    },
  });

  useEffect(() => {
    const next = statusQuery.data?.events;
    if (!Array.isArray(next) || next.length === 0) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id || `${e.event_date}|${e.title}`));
      const merged = [...prev];
      for (const e of next) {
        const k = e.id || `${e.event_date}|${e.title}`;
        if (!seen.has(k)) merged.push(e);
      }
      return merged;
    });
  }, [statusQuery.data]);

  // Auto-prefetch páginas seguintes enquanto backend tem mais
  useEffect(() => {
    const total = statusQuery.data?.events_count ?? 0;
    if (!jobId || jobId === "cache") return;
    if (statusQuery.isFetching) return;
    if (total > events.length) {
      const t = setTimeout(() => statusQuery.refetch(), 300);
      return () => clearTimeout(t);
    }
  }, [statusQuery.data?.events_count, events.length, jobId, statusQuery.isFetching, statusQuery]);

  const jobStatus = statusQuery.data?.status;
  const jobLoading = startingJob || (!!jobId && jobStatus !== "completed" && jobStatus !== "failed");

  // Filtra eventos por range e por rede selecionada
  const filteredEvents = useMemo(() => {
    const startMs = effectiveRange.start.getTime();
    const endMs = effectiveRange.end.getTime();
    let afterDate = 0;
    const result = events.filter((ev) => {
      const t = Date.parse(ev.event_date ?? "");
      if (!Number.isFinite(t)) return false;
      if (t < startMs || t > endMs) return false;
      afterDate++;
      if (network !== "all") {
        const nets = eventNetworks(ev);
        if (!nets.includes(network)) return false;
      }
      return true;
    });
    if (events.length > 0) {
      // Diagnóstico temporário: rastreia onde os eventos se perdem no filtro
      // eslint-disable-next-line no-console
      console.log("[NetworkView] Radar total:", events.length, "after date:", afterDate, "after network(" + network + "):", result.length);
    }
    return result;
  }, [events, effectiveRange, network]);

  // Sentimento por evento via edge function
  const sentimentQuery = useQuery({
    queryKey: ["nv-sentiment", candidateId, effectiveRange.key, filteredEvents.length],
    enabled: !!user?.id && filteredEvents.length > 0 && !jobLoading,
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: async () => {
      const samples = filteredEvents.slice(0, 200).map((ev, i) => ({
        id: String(ev.id ?? `${i}-${ev.event_date}`),
        text: `${ev.title ?? ""}. ${ev.summary ?? ev.snippet ?? ""}`.slice(0, 320),
      }));
      const { data, error } = await supabase.functions.invoke("network-view-sentiment", { body: { samples } });
      if (error) throw error;
      const map = new Map<string, "pos" | "neg" | "neu">();
      for (const r of (data?.results ?? []) as Array<{ id: string; sentiment: "pos" | "neg" | "neu" }>) {
        map.set(r.id, r.sentiment);
      }
      return map;
    },
  });

  // Tópicos + termos via edge function (sobre títulos+resumos)
  const analyzeQuery = useQuery({
    queryKey: ["nv-analyze", candidateId, effectiveRange.key, filteredEvents.length],
    enabled: !!user?.id && filteredEvents.length > 0 && !jobLoading,
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: async () => {
      const samples: string[] = [];
      const seen = new Set<string>();
      for (const ev of filteredEvents) {
        const t = `${ev.title ?? ""}. ${ev.summary ?? ev.snippet ?? ""}`.replace(/\s+/g, " ").trim();
        if (t.length < 8) continue;
        const k = t.slice(0, 160).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        samples.push(t.slice(0, 400));
        if (samples.length >= 120) break;
      }
      if (samples.length === 0) return { topics: [] as TopicRow[], terms: [] as TermRow[] };
      const { data, error } = await supabase.functions.invoke("network-view-intelligence", {
        body: {
          candidate_id: candidateId === "all" ? null : candidateId,
          start_date: effectiveRange.start.toISOString(),
          end_date: effectiveRange.end.toISOString(),
          samples,
        },
      });
      if (error) throw error;
      return (data ?? { topics: [], terms: [] }) as { topics: TopicRow[]; terms: TermRow[] };
    },
  });

  const analyticsLoading = jobLoading || sentimentQuery.isFetching || analyzeQuery.isFetching;

  // Agregações por rede
  const byNet = useMemo(() => {
    type Row = { network: string; mentions: number; engagement: number; pos: number; neg: number; neu: number };
    const map = new Map<string, Row>();
    const sentMap = sentimentQuery.data ?? new Map<string, "pos" | "neg" | "neu">();
    for (const ev of filteredEvents) {
      const nets = eventNetworks(ev);
      const score = Number(ev.social_score ?? 0) + Number(ev.source_count ?? 0);
      const id = String(ev.id ?? `${ev.event_date}|${ev.title}`);
      const sent = sentMap.get(id) ?? "neu";
      for (const n of nets) {
        const r = map.get(n) ?? { network: n, mentions: 0, engagement: 0, pos: 0, neg: 0, neu: 0 };
        r.mentions += 1;
        r.engagement += score;
        r[sent] += 1;
        map.set(n, r);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.mentions - a.mentions);
  }, [filteredEvents, sentimentQuery.data]);

  const totalMentions = filteredEvents.length;
  const totalEngagement = useMemo(
    () => filteredEvents.reduce((s, ev) => s + Number(ev.social_score ?? 0) + Number(ev.source_count ?? 0), 0),
    [filteredEvents],
  );
  const networkTotal = useMemo(() => byNet.reduce((s, n) => s + n.mentions, 0), [byNet]);
  const dominant = byNet[0] ?? null;

  // Sentimento global
  const sentAgg = useMemo(() => {
    const acc = { pos: 0, neg: 0, neu: 0 };
    const sentMap = sentimentQuery.data ?? new Map<string, "pos" | "neg" | "neu">();
    for (const ev of filteredEvents) {
      const id = String(ev.id ?? `${ev.event_date}|${ev.title}`);
      acc[sentMap.get(id) ?? "neu"] += 1;
    }
    return acc;
  }, [filteredEvents, sentimentQuery.data]);
  const sentLabeled = sentAgg.pos + sentAgg.neg + sentAgg.neu;
  const netSentiment = sentLabeled > 0 ? Math.round(((sentAgg.pos - sentAgg.neg) / sentLabeled) * 100) : 0;
  const netLabel =
    netSentiment >= 40 ? "Muito favorável" :
    netSentiment >= 10 ? "Favorável" :
    netSentiment <= -40 ? "Muito desfavorável" :
    netSentiment <= -10 ? "Desfavorável" : "Neutro";
  const netTone = netSentiment >= 10 ? "text-success" : netSentiment <= -10 ? "text-destructive" : "text-muted-foreground";

  // Evolução temporal com bucketing dinâmico
  const series = useMemo(() => {
    if (filteredEvents.length === 0) return [] as Array<{ date: string; sortKey: number; total: number; positivo: number; negativo: number }>;
    type Bucket = "day" | "week" | "month" | "quarter" | "semester";
    const bucket: Bucket =
      rangeDays <= 30 ? "day" :
      rangeDays <= 90 ? "week" :
      rangeDays <= 365 ? "month" :
      rangeDays <= 1460 ? "quarter" : "semester";

    const keyFor = (d: Date): { key: string; sortKey: number; label: string } => {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      if (bucket === "day") {
        return { key: d.toISOString().slice(0, 10), sortKey: d.getTime(), label: format(d, "dd/MM") };
      }
      if (bucket === "week") {
        const ws = new Date(Date.UTC(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
        return { key: ws.toISOString().slice(0, 10), sortKey: ws.getTime(), label: format(ws, "dd/MM") };
      }
      if (bucket === "month") {
        return { key: `${y}-${String(m + 1).padStart(2, "0")}`, sortKey: Date.UTC(y, m, 1), label: format(new Date(Date.UTC(y, m, 1)), "MM/yyyy") };
      }
      if (bucket === "quarter") {
        const q = Math.floor(m / 3);
        return { key: `${y}-Q${q + 1}`, sortKey: Date.UTC(y, q * 3, 1), label: `Q${q + 1}/${y}` };
      }
      const s = m < 6 ? 1 : 2;
      return { key: `${y}-S${s}`, sortKey: Date.UTC(y, (s - 1) * 6, 1), label: `S${s}/${y}` };
    };

    const sentMap = sentimentQuery.data ?? new Map<string, "pos" | "neg" | "neu">();
    const map = new Map<string, { sortKey: number; date: string; total: number; positivo: number; negativo: number }>();
    for (const ev of filteredEvents) {
      const d = new Date(ev.event_date);
      if (isNaN(d.getTime())) continue;
      const { key, sortKey, label } = keyFor(d);
      const cur = map.get(key) ?? { sortKey, date: label, total: 0, positivo: 0, negativo: 0 };
      cur.total += 1;
      const id = String(ev.id ?? `${ev.event_date}|${ev.title}`);
      const sent = sentMap.get(id) ?? "neu";
      if (sent === "pos") cur.positivo += 1;
      else if (sent === "neg") cur.negativo += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.sortKey - b.sortKey);
  }, [filteredEvents, rangeDays, sentimentQuery.data]);

  // Termos: aceita apenas políticos/partidos/hashtags/instituições
  const TERM_BLOCKLIST = new Set([
    "afirmou", "disse", "falou", "diz", "afirma", "fala", "comentou", "destacou",
    "mato", "grosso", "rio", "sao", "são", "paulo", "minas", "gerais",
    "cenario", "cenário", "contexto", "noticia", "notícia", "politica", "política",
  ]);
  function termAllowed(t: TermRow): boolean {
    const term = (t.term ?? "").trim();
    if (term.length < 3) return false;
    if (t.kind === "hashtag") return true;
    const low = term.toLowerCase();
    if (TERM_BLOCKLIST.has(low)) return false;
    if (low.split(/\s+/).every((w) => TERM_BLOCKLIST.has(w))) return false;
    // exige pelo menos uma letra maiúscula (entidade) ou ser composto
    const hasUpper = /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(term);
    const isMulti = term.includes(" ");
    return hasUpper || isMulti;
  }
  const mergedTerms = useMemo(
    () => (analyzeQuery.data?.terms ?? []).filter(termAllowed).slice(0, 25),
    [analyzeQuery.data],
  );
  const mergedTopics: TopicRow[] = useMemo(
    () => (analyzeQuery.data?.topics ?? []).filter((t) => !!(t.label || t.theme)),
    [analyzeQuery.data],
  );

  const applyCustomRange = () => {
    if (!startDate || !endDate) {
      setCustomError("Selecione ambas as datas");
      return;
    }
    const start = parseDateBoundary(startDate, "start");
    const end = parseDateBoundary(endDate, "end");
    if (end < start) {
      setCustomError("Data final não pode ser menor que a inicial");
      return;
    }
    setSelectedPeriod("custom");
    setCustomRange({ startDate, endDate });
    setCustomError(null);
  };

  const needsCandidate = candidateId === "all";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Visão por Rede Social</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Inteligência social baseada no mesmo pipeline do Radar Político — coleta externa real por período.
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
            <Button onClick={applyCustomRange}>Aplicar</Button>
          </div>
          {customError && <div className="text-xs text-destructive mt-3">{customError}</div>}
        </Card>
      )}

      {needsCandidate && (
        <Card className="p-8 text-center">
          <RadarIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">Selecione um candidato</h3>
          <p className="text-sm text-muted-foreground">
            A coleta usa o pipeline do Radar Político (notícias, redes sociais, vídeos). Escolha um candidato no filtro acima para iniciar a análise.
          </p>
        </Card>
      )}

      {!needsCandidate && jobLoading && (
        <Card className="p-4 text-sm text-muted-foreground">
          Coletando fontes externas para {candidateName}... {statusQuery.data?.events_count ? `${statusQuery.data.events_count} eventos até agora.` : ""}
        </Card>
      )}

      {!needsCandidate && (
        <>
          {/* BLOCO 1 — RESUMO EXECUTIVO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <BigKpi icon={<MessageSquare className="h-5 w-5" />} label="Total de menções" value={analyticsLoading ? null : fmt(totalMentions)} />
            <BigKpi icon={<Activity className="h-5 w-5" />} label="Repercussão estimada" value={analyticsLoading ? null : compact(totalEngagement)} sub={analyticsLoading ? "" : "Soma de social_score + nº de fontes por evento"} />
            <BigKpi
              icon={<Gauge className="h-5 w-5" />}
              label="Sentimento líquido"
              value={analyticsLoading ? null : `${netSentiment > 0 ? "+" : ""}${netSentiment}`}
              sub={analyticsLoading ? "" : netLabel}
              valueClassName={netTone}
            />
            <BigKpi
              icon={<Crown className="h-5 w-5" />}
              label="Rede dominante"
              value={analyticsLoading ? null : dominant ? (NETWORK_LABEL[dominant.network] ?? dominant.network) : "—"}
              sub={analyticsLoading ? "" : dominant ? `${fmt(dominant.mentions)} eventos · ${compact(dominant.engagement)} repercussão` : ""}
            />
          </div>

          {/* BLOCO 2 — DISTRIBUIÇÃO POR REDE */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Distribuição por rede</h2>
            <p className="text-sm text-muted-foreground mb-6">Participação real de cada plataforma nos eventos coletados.</p>
            {analyticsLoading ? <Skeleton className="h-64 w-full" /> : byNet.length === 0 ? <Empty /> : (
              <div className="space-y-3">
                {byNet.map((n) => {
                  const share = pct(n.mentions, networkTotal);
                  return (
                    <div key={n.network} className="grid grid-cols-12 items-center gap-3">
                      <div className="col-span-3 md:col-span-2 text-sm font-medium">{NETWORK_LABEL[n.network] ?? n.network}</div>
                      <div className="col-span-6 md:col-span-7">
                        <div className="h-3 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-primary to-primary/60" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                      <div className="col-span-3 md:col-span-3 flex items-center justify-end gap-4 text-xs tabular-nums">
                        <span className="text-muted-foreground hidden md:inline">{compact(n.engagement)} repercussão</span>
                        <span className="w-12 text-right text-foreground font-medium">{share}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* BLOCO 3 — EVOLUÇÃO TEMPORAL */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Evolução temporal</h2>
            <p className="text-sm text-muted-foreground mb-6">Volume de eventos por bucket dinâmico, com sobreposição de sentimento.</p>
            {analyticsLoading ? <Skeleton className="h-72 w-full" /> : series.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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

          {/* BLOCO 4 — SENTIMENTO POR REDE */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Sentimento por rede</h2>
            <p className="text-sm text-muted-foreground mb-6">Sentimento médio dos eventos em cada plataforma (inferido por IA).</p>
            {analyticsLoading ? <Skeleton className="h-56 w-full" /> : byNet.length === 0 ? <Empty /> : (
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
                    {byNet.map((n) => {
                      const lab = n.pos + n.neg + n.neu;
                      const p = pct(n.pos, lab), neg = pct(n.neg, lab), nu = pct(n.neu, lab);
                      return (
                        <tr key={n.network} className="border-b border-border/40 last:border-0">
                          <td className="py-3 pr-4 font-medium">{NETWORK_LABEL[n.network] ?? n.network}</td>
                          <td className="py-3 pr-4">
                            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted min-w-[140px]">
                              <div style={{ width: `${p}%`, backgroundColor: COLORS.positive }} />
                              <div style={{ width: `${neg}%`, backgroundColor: COLORS.negative }} />
                              <div style={{ width: `${nu}%`, backgroundColor: COLORS.neutral }} />
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums text-success">{p}%</td>
                          <td className="py-3 pr-4 text-right tabular-nums text-destructive">{neg}%</td>
                          <td className="py-3 text-right tabular-nums text-muted-foreground">{nu}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* BLOCO 5 — ASSUNTOS DOMINANTES */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Assuntos dominantes</h2>
            <p className="text-sm text-muted-foreground mb-6">Temas extraídos pela IA a partir dos eventos reais coletados no período.</p>
            {analyticsLoading ? <Skeleton className="h-56 w-full" /> : mergedTopics.length === 0 ? <Empty /> : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(() => {
                  const topicsTotal = mergedTopics.reduce((s, t) => s + (t.mentions || 0), 0);
                  return mergedTopics.map((t) => {
                    const lab = t.pos + t.neg + t.neu;
                    const shareNum = topicsTotal > 0 ? (t.mentions / topicsTotal) * 100 : 0;
                    const shareLabel = `${shareNum.toFixed(1)}%`;
                    const posP = pct(t.pos, lab);
                    const topicLabel = t.label ?? t.theme;
                    return (
                      <div key={topicLabel} className="rounded-lg border border-border p-4 bg-card/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold">{topicLabel}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{shareLabel} relevância</span>
                        </div>
                        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted mb-2">
                          <div style={{ width: `${pct(t.pos, lab)}%`, backgroundColor: COLORS.positive }} />
                          <div style={{ width: `${pct(t.neg, lab)}%`, backgroundColor: COLORS.negative }} />
                          <div style={{ width: `${pct(t.neu, lab)}%`, backgroundColor: COLORS.neutral }} />
                        </div>
                        <div className="text-[11px] text-success">{posP}% tom positivo estimado</div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </Card>

          {/* BLOCO 6 — TERMOS EM ALTA */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-1">Termos em alta</h2>
            <p className="text-sm text-muted-foreground mb-6">Entidades, hashtags e nomes próprios detectados nos eventos coletados.</p>
            {analyticsLoading ? <Skeleton className="h-40 w-full" /> : mergedTerms.length === 0 ? <Empty /> : (
              <div className="flex flex-wrap gap-2">
                {mergedTerms.map((t) => {
                  const max = (mergedTerms[0]?.count ?? 1);
                  const intensity = Math.max(0.3, Math.min(1, t.count / max));
                  return (
                    <div
                      key={`${t.kind}-${t.term}`}
                      className="rounded-full px-4 py-2 text-sm border border-border flex items-center gap-2 bg-card"
                      style={{ fontSize: `${0.85 + intensity * 0.35}rem`, opacity: 0.6 + intensity * 0.4 }}
                    >
                      <span className={t.kind === "hashtag" ? "text-primary font-semibold" : "font-semibold"}>{t.term}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
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
  return <div className="text-sm text-muted-foreground py-10 text-center">Sem dados no período selecionado.</div>;
}
