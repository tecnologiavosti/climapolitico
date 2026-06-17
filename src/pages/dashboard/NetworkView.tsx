import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { MessageSquare, Activity, Gauge, Crown, CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const ALLOWED_NETWORKS = new Set([
  "youtube", "facebook", "tiktok", "telegram", "twitter", "google_news", "linkedin", "reddit", "instagram",
]);

const NETWORK_LABEL: Record<string, string> = {
  youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok", telegram: "Telegram",
  twitter: "X / Twitter", google_news: "Notícias", linkedin: "LinkedIn", reddit: "Reddit", instagram: "Instagram",
};

const NETWORKS_FILTER = [
  { value: "all", label: "Todas as redes" },
  ...Array.from(ALLOWED_NETWORKS).map((v) => ({ value: v, label: NETWORK_LABEL[v] ?? v })),
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

type NetRow = { network: string; mentions: number; engagement: number; likes: number; replies: number; shares: number; pos: number; neg: number; neu: number };
type SeriesRow = { day: string; p: number; n: number; u: number };
type TopicRow = { label?: string; topic?: string; theme?: string; mentions: number; pos: number; neg: number; neu: number; relevance?: number; positive?: number };
type TermRow = { term: string; count: number; kind: "hashtag" | "entity" };

export default function NetworkView() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [network, setNetwork] = useState("all");
  const [candidateId, setCandidateId] = useState<string>("all");
  const [days, setDays] = useState(365);
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | undefined>(undefined);
  const [draftEnd, setDraftEnd] = useState<Date | undefined>(undefined);
  const [customError, setCustomError] = useState<string | null>(null);

  // Effective days used for backend fetch: when custom is active,
  // fetch enough days back from "now" to cover startDate; we then
  // post-filter the timeline by the explicit range.
  const effectiveDays = useMemo(() => {
    if (!customRange) return days;
    const now = Date.now();
    const span = Math.ceil((now - customRange.start.getTime()) / 86_400_000);
    return Math.max(1, span);
  }, [customRange, days]);

  const activePeriodLabel = customRange
    ? `Período: ${format(customRange.start, "dd/MM/yyyy")} - ${format(customRange.end, "dd/MM/yyyy")}`
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

  const params = {
    p_candidate_id: candidateId === "all" ? null : candidateId,
    p_network: network === "all" ? null : network,
    p_days: effectiveDays,
  };

  const fetchBlock = async (rpc: string) => {
    const label = `[NetworkView] ${rpc}`;
    console.time(label);
    try {
      const { data, error } = await (supabase.rpc as any)(rpc, params);
      if (error) {
        console.error(`✖ ${rpc} error:`, error);
        throw error;
      }
      if (data && data.ok === false) {
        console.error(`✖ ${rpc} ok=false:`, data.message);
        throw new Error(data.message || `Falha em ${rpc}`);
      }
      return data;
    } finally {
      console.timeEnd(label);
    }
  };

  const query = useQuery({
    queryKey: ["nv-blocks", user?.id, network, candidateId, effectiveDays, customRange?.start?.toISOString(), customRange?.end?.toISOString()],
    queryFn: async () => {
      console.log("[NetworkView] filters →", { user: user?.id, candidate: candidateId, network, period: days });
      // allSettled: timeout em UM bloco não derruba os outros
      const settled = await Promise.allSettled([
        fetchBlock("network_view_summary"),
        fetchBlock("network_view_sentiment_block"),
        fetchBlock("network_view_engagement_block"),
        fetchBlock("network_view_topics_block"),
        fetchBlock("network_view_terms_block"),
      ]);
      const [summary, sentiment, engagement, topics, terms] = settled.map((s) =>
        s.status === "fulfilled" ? s.value : null,
      );
      const names = ["summary", "sentiment", "engagement", "topics", "terms"];
      const failures: Record<string, string> = {};
      settled.forEach((s, i) => {
        if (s.status === "rejected") {
          const msg = (s.reason as Error)?.message || String(s.reason);
          failures[names[i]] = msg;
          console.error(`[NetworkView] bloco ${names[i]} falhou:`, msg);
        }
      });
      const result = {
        kpis: summary?.data?.kpis ?? {},
        sentimentKpis: sentiment?.data?.kpis ?? {},
        series: (sentiment?.data?.series ?? []) as SeriesRow[],
        byNet: ((engagement?.data?.by_network ?? []) as NetRow[]).filter((n) => ALLOWED_NETWORKS.has(n.network)),
        topics: ((topics?.data?.topics ?? []) as TopicRow[]).filter((t) => !!t.theme),
        terms: (terms?.data?.terms ?? []) as TermRow[],
        failures,
      };
      console.log("[NetworkView] pipeline →", {
        total: result.kpis?.total ?? 0,
        engagement_sum: result.kpis?.engagement ?? 0,
        networks: result.byNet.length,
        topics_n: result.topics.length,
        terms_n: result.terms.length,
        series_n: result.series.length,
        failures,
      });
      return result;
    },
    enabled: !!user?.id,
    retry: 1,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const failures = (query.data as any)?.failures ?? {};
  const failedBlocks = Object.keys(failures);
  const needsJsFallback = !!(failures.topics || failures.terms);
  const errorMessage = query.error
    ? "Não foi possível carregar a análise. Tente novamente."
    : null;
  const reprocessingMsg = failedBlocks.length > 0 ? "Reprocessando temas e termos..." : null;

  // Fallback JS: se topics/terms falharam, busca amostra leve e processa no cliente
  const fallback = useQuery({
    queryKey: ["nv-fallback", user?.id, candidateId, network, effectiveDays, needsJsFallback],
    enabled: !!user?.id && needsJsFallback,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      console.time("[NetworkView] fallback-fetch");
      const PAGE = 1000;
      const MAX_ROWS = 20000;
      const all: any[] = [];
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        let q = supabase
          .from("social_interactions")
          .select("post_title, comment_text, social_network, sentiment_label")
          .is("invalidated_at", null)
          .order("collected_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (candidateId !== "all") q = q.eq("candidate_id", candidateId);
        if (network !== "all") q = q.eq("social_network", network);
        const { data, error } = await q;
        if (error) { console.error("fallback fetch error", error); break; }
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      console.timeEnd("[NetworkView] fallback-fetch");
      console.log("[NetworkView] fallback rows fetched:", all.length);
      return computeTopicsAndTerms(all);
    },

  });
  // Camada 2 — Inteligência IA (sempre disponível, usada quando dados reais são insuficientes)
  const aiIntel = useQuery({
    queryKey: ["nv-ai-intel", candidateId, network, effectiveDays, customRange?.start?.toISOString(), customRange?.end?.toISOString()],
    enabled: !!user?.id,
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("network-view-intelligence", {
        body: {
          candidate_id: candidateId === "all" ? null : candidateId,
          network: network === "all" ? null : network,
          days: effectiveDays,
        },
      });
      if (error) throw error;
      return data as { by_network: NetRow[]; series: SeriesRow[]; topics: TopicRow[]; terms: TermRow[]; period: string };
    },
  });

  const loading = query.isLoading;
  const d = query.data;

  const totalMentions = d?.kpis?.total ?? 0;
  const totalEngagement = d?.kpis?.engagement ?? 0;

  // Sentimento líquido — SEMPRE dados reais (Camada 1)
  const sFromBlock = { pos: d?.sentimentKpis?.pos ?? 0, neg: d?.sentimentKpis?.neg ?? 0, neu: d?.sentimentKpis?.neu ?? 0 };
  const sFromNet = (d?.byNet ?? []).reduce(
    (acc, n) => ({ pos: acc.pos + (n.pos || 0), neg: acc.neg + (n.neg || 0), neu: acc.neu + (n.neu || 0) }),
    { pos: 0, neg: 0, neu: 0 },
  );
  const sBlockTotal = sFromBlock.pos + sFromBlock.neg + sFromBlock.neu;
  const sent = sBlockTotal > 0 ? sFromBlock : sFromNet;
  const labeled = sent.pos + sent.neg + sent.neu;
  const netSentiment = labeled > 0 ? Math.round(((sent.pos - sent.neg) / labeled) * 100) : 0;
  const netLabel =
    netSentiment >= 40 ? "Muito favorável" :
    netSentiment >= 10 ? "Favorável" :
    netSentiment <= -40 ? "Muito desfavorável" :
    netSentiment <= -10 ? "Desfavorável" : "Neutro";
  const netTone = netSentiment >= 10 ? "text-success" : netSentiment <= -10 ? "text-destructive" : "text-muted-foreground";

  // Camada 2: SEMPRE IA-driven. Dados reais NÃO são fonte primária aqui.
  const aiByNet: NetRow[] = ((aiIntel.data?.by_network ?? []) as NetRow[])
    .filter((n) => ALLOWED_NETWORKS.has(n.network));
  const aiSeries: SeriesRow[] = (aiIntel.data?.series ?? []) as SeriesRow[];
  const invalidLabel = (value: unknown) => {
    const raw = String(value ?? "").trim();
    const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return !raw || ["-", "—", "politica", "politico", "brasil", "cenario", "contexto", "noticia"].includes(normalized);
  };
  const aiTopics: TopicRow[] = ((aiIntel.data?.topics ?? []) as TopicRow[])
    .map((t) => ({ ...t, label: t.label ?? t.topic ?? t.theme, theme: t.theme ?? t.label ?? t.topic }))
    .filter((t) => !invalidLabel(t.label));
  const aiTerms: TermRow[] = (aiIntel.data?.terms ?? []) as TermRow[];

  // Rede dominante: prefere real (Camada 1) quando há volume; senão IA
  const dominant = useMemo(() => {
    const realArr = d?.byNet ?? [];
    const arr = realArr.length > 0 ? realArr : aiByNet;
    if (!arr.length) return null;
    return [...arr].sort((a, b) => (b.mentions * 0.4 + b.engagement * 0.6) - (a.mentions * 0.4 + a.engagement * 0.6))[0];
  }, [d, aiByNet]);

  // Distribuição por rede — IA sempre
  const networkTotal = useMemo(() => aiByNet.reduce((s, n) => s + n.mentions, 0), [aiByNet]);
  const sortedNetworks = useMemo(() => [...aiByNet].sort((a, b) => b.mentions - a.mentions), [aiByNet]);

  // Evolução temporal — IA sempre; filtra por intervalo customizado quando ativo
  const series = useMemo(() => {
    const startMs = customRange ? customRange.start.getTime() : null;
    const endMs = customRange ? customRange.end.getTime() + 86_399_000 : null;
    return [...aiSeries]
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day))
      .filter((r) => {
        if (startMs == null || endMs == null) return true;
        const t = new Date(r.day + "T00:00:00Z").getTime();
        return t >= startMs && t <= endMs;
      })
      .sort((a, b) => new Date(a.day + "T00:00:00Z").getTime() - new Date(b.day + "T00:00:00Z").getTime())
      .map((r) => ({
        iso: r.day,
        date: format(parseISO(r.day), "dd/MM"),
        positivo: r.p,
        negativo: r.n,
        total: r.p + r.n + r.u,
      }));
  }, [aiSeries, customRange]);

  // Assuntos dominantes — IA sempre
  const mergedTopics = aiTopics;
  // Termos em alta — IA sempre
  const mergedTerms = aiTerms;






  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Visão por Rede Social</h1>
          <p className="text-muted-foreground mt-1 text-sm">Inteligência social institucional — volume, repercussão e sentimento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos candidatos</SelectItem>
              {candidates?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={network} onValueChange={setNetwork}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>{NETWORKS_FILTER.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {errorMessage && (
        <Card className="p-4 border-destructive bg-destructive/5">
          <div className="text-sm text-destructive font-medium">{errorMessage}</div>
        </Card>
      )}



      {/* BLOCO 1 — RESUMO EXECUTIVO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <BigKpi icon={<MessageSquare className="h-5 w-5" />} label="Total de menções" value={loading ? null : fmt(totalMentions)} />
        <BigKpi icon={<Activity className="h-5 w-5" />} label="Total de interações" value={loading ? null : compact(totalEngagement)} sub={loading ? "" : `${compact(d?.kpis?.likes ?? 0)} curtidas · ${compact(d?.kpis?.replies ?? 0)} comentários · ${compact(d?.kpis?.shares ?? 0)} compart.`} />
        <BigKpi
          icon={<Gauge className="h-5 w-5" />}
          label="Sentimento líquido"
          value={loading ? null : `${netSentiment > 0 ? "+" : ""}${netSentiment}`}
          sub={loading ? "" : netLabel}
          valueClassName={netTone}
        />
        <BigKpi
          icon={<Crown className="h-5 w-5" />}
          label="Rede dominante"
          value={loading ? null : dominant ? (NETWORK_LABEL[dominant.network] ?? dominant.network) : "—"}
          sub={loading ? "" : dominant ? `${fmt(dominant.mentions)} menções · ${compact(dominant.engagement)} interações` : ""}
        />
      </div>

      {/* BLOCO 2 — DISTRIBUIÇÃO POR REDE */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-1">Distribuição por rede</h2>
        <p className="text-sm text-muted-foreground mb-6">Participação de cada plataforma no volume e nas interações.</p>
        {aiIntel.isLoading ? <Skeleton className="h-64 w-full" /> : sortedNetworks.length === 0 ? <Empty /> : (
          <div className="space-y-3">
            {sortedNetworks.map((n) => {
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
                    <span className="text-muted-foreground hidden md:inline">{compact(n.engagement)} interações est.</span>
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
        <p className="text-sm text-muted-foreground mb-6">Volume diário com sobreposição de sentimento positivo e negativo.</p>
        {aiIntel.isLoading ? <Skeleton className="h-72 w-full" /> : series.length === 0 ? <Empty /> : (
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
        <p className="text-sm text-muted-foreground mb-6">Distribuição percentual de positivo, negativo e neutro em cada plataforma.</p>
        {aiIntel.isLoading ? <Skeleton className="h-56 w-full" /> : sortedNetworks.length === 0 ? <Empty /> : (
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
                {sortedNetworks.map((n) => {
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
        <p className="text-sm text-muted-foreground mb-6">Volume, participação e sentimento médio por tema.</p>
        {aiIntel.isLoading ? <Skeleton className="h-56 w-full" /> : (mergedTopics.length === 0) ? <Empty /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(() => {
              const topicsTotal = mergedTopics.reduce((s, t) => s + (t.mentions || 0), 0);
              return mergedTopics.map((t) => {
                const lab = t.pos + t.neg + t.neu;
                const shareNum = topicsTotal > 0 ? (t.mentions / topicsTotal) * 100 : 0;
                const shareLabel = `${shareNum.toFixed(1)}%`;
                const posP = pct(t.pos, lab);
                const topicLabel = t.label ?? t.topic ?? t.theme;
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
        <p className="text-sm text-muted-foreground mb-6">Hashtags, nomes e entidades com maior relevância contextual no período.</p>
        {aiIntel.isLoading ? <Skeleton className="h-40 w-full" /> : mergedTerms.length === 0 ? <Empty /> : (
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
  return <div className="text-sm text-muted-foreground py-10 text-center">Sem dados para o período selecionado.</div>;
}

// ============================================================
// FALLBACK CLIENT-SIDE: extração leve de temas e termos
// Usado quando os blocos SQL (topics/terms) dão timeout.
// ============================================================
const THEME_KEYWORDS: Record<string, string[]> = {
  "Eleições": ["eleic", "eleiç", "voto", "votar", "candidat", "campanha", "urna", "tse", "pesquisa", "intenção de voto", "intencao de voto", "segundo turno", "primeiro turno", "btg", "nexus", "ibope", "datafolha", "quaest", "paraná pesquisas", "parana pesquisas"],
  "Economia": ["economia", "inflaç", "inflac", "pib", "juros", "selic", "dólar", "dolar", "imposto", "tributár", "tributar", "fiscal", "arcabouço", "arcabouco"],
  "STF / Justiça": ["stf", "supremo", "moraes", "judiciár", "judiciar", "ministro", "tribunal", "pgr", "pf ", "polícia federal", "policia federal", "corte", "barroso", "dino", "fachin", "toffoli"],
  "Corrupção": ["corrupç", "corrupc", "propina", "lavagem", "desvio", "esquema", "delaç", "delac", "operação", "operacao"],
  "Segurança": ["segurança pública", "seguranca publica", "polícia", "policia", "crime", "violênc", "violenc", "facç", "facc", "pcc", "cv "],
  "Saúde": ["sus", "saúde", "saude", "hospital", "vacina", "médico", "medico"],
  "Educação": ["educaç", "educac", "escola", "universidade", "enem", "professor", "fies", "prouni"],
  "Congresso": ["congresso", "senado", "câmara", "camara", "deputad", "senador", "lira", "pacheco", "comissão", "comissao", "cpi", "pec ", "projeto de lei"],
  "Governo Lula": ["lula", "haddad", "alckmin", "planalto", "governo federal", "ministério", "ministerio"],
  "Oposição": ["bolsonaro", "tarcísio", "tarcisio", "zema", "caiado", "ratinho", "pl ", "novo", "união brasil", "uniao brasil"],
  "Internacional": ["trump", "biden", "putin", "maduro", "milei", "ucrân", "ucran", "israel", "china", "argentina", "venezuela"],
  "Meio Ambiente": ["amazôn", "amazon", "desmatamento", "clima", "ambiental", "ibama", "cop "],
};
const SOCIAL_BLACKLIST = new Set(["facebook","youtube","instagram","telegram","twitter","reddit","linkedin","tiktok","whatsapp","threads","kwai","x.com","fb","ig","yt"]);
const STOPWORDS = new Set([
  "de","da","do","das","dos","a","o","e","é","em","um","uma","para","com","no","na","nos","nas","que","se","por","ao","aos","como","mais","mas","ou","já","foi","ser","sobre","ele","ela","eles","elas","isso","esse","essa","este","esta","quando","onde","sim","não","nao","sua","seu","suas","seus","vai","tem","teve","ter","só","so","muito","pelo","pela","entre","até","ate","você","voce","vocês","voces",
  // HTML/web noise
  "https","http","com.br","www","amp","href","target","_blank","blank","font","nbsp","color","style","span","div","class","src","alt","img","html","body","head","meta","link","script","rel","noopener","noreferrer","google","news","com","br","org","net",
  ...Array.from(SOCIAL_BLACKLIST),
]);
const HEX_RE = /^[a-f0-9]{3}$|^[a-f0-9]{6}$/i;
const HAS_LETTER_RE = /[a-zà-ÿ]/i;

function normalizeTerm(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}


function cleanText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function computeTopicsAndTerms(rows: Array<{ post_title: string | null; comment_text: string | null; social_network: string | null; sentiment_label: string | null }>) {
  console.log("[NetworkView] fallback rows:", rows.length);
  const themeStats: Record<string, { mentions: number; pos: number; neg: number; neu: number }> = {};
  const hashCount: Record<string, number> = {};
  const wordCount: Record<string, number> = {};
  const hashRe = /#([\p{L}\p{N}_]{2,})/gu;

  for (const r of rows) {
    const text = cleanText(`${r.post_title ?? ""} ${r.comment_text ?? ""}`);
    if (!text) continue;
    const norm = normalizeTerm(text);
    const sentRaw = (r.sentiment_label ?? "").toLowerCase();
    const sentKey = sentRaw.startsWith("pos") ? "pos" : sentRaw.startsWith("neg") ? "neg" : "neu";

    for (const [theme, kws] of Object.entries(THEME_KEYWORDS)) {
      if (kws.some((k) => norm.includes(normalizeTerm(k)))) {
        const t = (themeStats[theme] ||= { mentions: 0, pos: 0, neg: 0, neu: 0 });
        t.mentions++;
        (t as any)[sentKey]++;
      }
    }

    let m;
    while ((m = hashRe.exec(text)) !== null) {
      const tag = normalizeTerm(m[1]);
      if (tag.length < 2 || STOPWORDS.has(tag) || SOCIAL_BLACKLIST.has(tag) || HEX_RE.test(tag) || !HAS_LETTER_RE.test(tag)) continue;
      hashCount["#" + tag] = (hashCount["#" + tag] ?? 0) + 1;
    }

    for (const raw of text.split(/[^\p{L}\p{N}_#]+/u)) {
      if (!raw || raw.startsWith("#")) continue;
      const w = normalizeTerm(raw);
      if (w.length < 3 || STOPWORDS.has(w) || SOCIAL_BLACKLIST.has(w) || /^\d+$/.test(w) || HEX_RE.test(w) || !HAS_LETTER_RE.test(w)) continue;
      wordCount[w] = (wordCount[w] ?? 0) + 1;
    }
  }


  const topics = Object.entries(themeStats)
    .map(([theme, s]) => ({ theme, mentions: s.mentions, pos: s.pos, neg: s.neg, neu: s.neu }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 8);

  const hashTerms = Object.entries(hashCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, count]) => ({ term, count, kind: "hashtag" as const }));

  const wordTerms = Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term, count]) => ({ term, count, kind: "entity" as const }));

  const terms = [...hashTerms, ...wordTerms].slice(0, 25);
  return { topics, terms };
}
