import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  MessageSquare, TrendingUp, TrendingDown, Heart, Hash, Users, Activity, Crown, Sparkles, ExternalLink, Eye, MessageCircle, Share2, AlertTriangle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const NETWORKS = [
  { value: "all", label: "Todas" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "X / Twitter" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "telegram", label: "Telegram" },
  { value: "reddit", label: "Reddit" },
  { value: "google_news", label: "Notícias" },
  { value: "linkedin", label: "LinkedIn" },
];

const PERIODS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
  { value: 180, label: "6 meses" },
  { value: 365, label: "1 ano" },
  { value: 3650, label: "Total" },
];

const COLORS = {
  positive: "hsl(var(--success))",
  negative: "hsl(var(--destructive))",
  neutral: "hsl(var(--warning))",
  primary: "hsl(var(--primary))",
  accent: "hsl(var(--accent))",
};

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type Agg = {
  kpis: {
    total: number; authors: number; engagement: number;
    likes: number; replies: number; shares: number;
    pos: number; neg: number; neu: number;
    prev_total: number; prev_pos: number; prev_neg: number; prev_neu: number;
  };
  series: { day: string; p: number; n: number; u: number }[];
  by_network: { network: string; mentions: number; likes: number; replies: number; shares: number; engagement: number }[];
  heatmap: { dow: number; hr: number; c: number }[];
  hashtags: { tag: string; c: number; pos: number; neg: number; neu: number; prev_c: number }[];
  topics: { theme: string; mentions: number; pos: number; neg: number; neu: number; prev_mentions: number }[];
  top_posts: { id: string; social_network: string; comment_text: string; comment_author: string; sent: string; eng: number; score?: number; likes: number; replies: number; shares: number; views?: number; thumbnail_url?: string | null; post_url?: string | null; original_posted_at: string; collected_at: string }[];
};

type SectionResponse<T> = {
  ok?: boolean;
  data?: T;
  message?: string;
  diagnostics?: {
    duration_ms?: number;
    records_read?: number;
    records_returned?: number;
    cache_hit?: boolean;
    plan?: unknown;
  };
};

type CoreAgg = Pick<Agg, "kpis" | "series" | "by_network" | "heatmap">;
type ContentAgg = Pick<Agg, "hashtags" | "topics">;
type TopPostsAgg = Pick<Agg, "top_posts">;

const emptyKpis: Agg["kpis"] = {
  total: 0, authors: 0, engagement: 0,
  likes: 0, replies: 0, shares: 0,
  pos: 0, neg: 0, neu: 0,
  prev_total: 0, prev_pos: 0, prev_neg: 0, prev_neu: 0,
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString("pt-BR");
const compact = (n: number) => Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
// Crescimento: exige base mínima de 10 e satura em ±500% para não distorcer.
const growth = (cur: number, prev: number) => {
  if (prev < 10) return null;
  const g = Math.round(((cur - prev) / prev) * 100);
  if (g > 500) return 500;
  if (g < -100) return -100;
  return g;
};
const HASHTAG_BLOCKLIST = /\b(fyp+|fyppp+|foryou|foryoupage|parati|viral\d*|funny|funnyvideos?|trending|tiktok|reels?|shorts?|explore|explorepage|likes?forlikes?|followme|like4like|comedy|memes?)\b/i;
const isValidHashtag = (tag: string) => {
  const clean = tag
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF\u00A0]/g, "")
    .toLowerCase()
    .replace(/^#+/, "");
  if (clean.length < 3 || clean.length > 40) return false;
  if (!/[a-z]/.test(clean)) return false;
  if (/(.)\1{5,}/.test(clean)) return false; // 6+ caracteres repetidos
  if (HASHTAG_BLOCKLIST.test(clean)) return false;
  if (/^(x200b|xfeff|nbsp|amp|[0-9_\-]+|[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(clean)) return false;
  return true;
};
const isWithinSelectedPeriod = (date: string | null | undefined, days: number) => {
  if (!date) return false;
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return false;
  if (days >= 3650) return true;
  return time >= Date.now() - days * 24 * 60 * 60 * 1000 && time <= Date.now() + 60 * 1000;
};

const sectionErrorMessage = (section: string) => `Não foi possível carregar ${section}. As demais seções continuam disponíveis.`;

export default function NetworkView() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [network, setNetwork] = useState("all");
  const [candidateId, setCandidateId] = useState<string>("all");
  const [days, setDays] = useState(30);

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

  const queryParams = {
    p_candidate_id: candidateId === "all" ? null : candidateId,
    p_network: network === "all" ? null : network,
    p_days: days,
  };

  const coreQuery = useQuery({
    queryKey: ["nv-core", user?.id, network, candidateId, days],
    queryFn: async (): Promise<SectionResponse<CoreAgg>> => {
      const started = performance.now();
      const { data, error } = await supabase.rpc("network_view_core_metrics", queryParams);
      const elapsed = Math.round(performance.now() - started);
      if (error) {
        console.error("[NetworkView] core RPC failed", { elapsed, error, queryParams });
        throw error;
      }
      console.info("[NetworkView] core loaded", { elapsed, diagnostics: (data as SectionResponse<CoreAgg>)?.diagnostics });
      return data as SectionResponse<CoreAgg>;
    },
    enabled: !!user,
    staleTime: 15 * 60_000, gcTime: 60 * 60_000, refetchOnWindowFocus: false,
  });

  const contentQuery = useQuery({
    queryKey: ["nv-content", user?.id, network, candidateId, days],
    queryFn: async (): Promise<SectionResponse<ContentAgg>> => {
      const started = performance.now();
      const { data, error } = await supabase.rpc("network_view_content_metrics", queryParams);
      const elapsed = Math.round(performance.now() - started);
      if (error) {
        console.error("[NetworkView] content RPC failed", { elapsed, error, queryParams });
        throw error;
      }
      console.info("[NetworkView] content loaded", { elapsed, diagnostics: (data as SectionResponse<ContentAgg>)?.diagnostics });
      return data as SectionResponse<ContentAgg>;
    },
    enabled: !!user,
    staleTime: 15 * 60_000, gcTime: 60 * 60_000, refetchOnWindowFocus: false,
  });

  const topPostsQuery = useQuery({
    queryKey: ["nv-top-posts", user?.id, network, candidateId, days],
    queryFn: async (): Promise<SectionResponse<TopPostsAgg>> => {
      const started = performance.now();
      const { data, error } = await supabase.functions.invoke("social/top-posts", {
        body: {
          candidateId: candidateId === "all" ? null : candidateId,
          network: network === "all" ? null : network,
          days,
        },
      });
      const elapsed = Math.round(performance.now() - started);
      if (error) {
        console.error("[NetworkView] top_posts RPC failed", { elapsed, error, queryParams });
        throw error;
      }
      console.info("[NetworkView] top_posts loaded", { elapsed, diagnostics: (data as SectionResponse<TopPostsAgg>)?.diagnostics });
      return data as SectionResponse<TopPostsAgg>;
    },
    enabled: !!user,
    staleTime: 15 * 60_000, gcTime: 60 * 60_000, refetchOnWindowFocus: false,
  });

  const coreData = coreQuery.data?.data;
  const contentData = contentQuery.data?.data;
  const topPostsData = topPostsQuery.data?.data;
  const isLoadingCore = coreQuery.isLoading;
  const isLoadingContent = contentQuery.isLoading;
  const isLoadingTopPosts = topPostsQuery.isLoading;
  const sectionErrors = [
    coreQuery.error || (coreQuery.data?.ok === false ? new Error(coreQuery.data.message || sectionErrorMessage("métricas gerais")) : null),
    contentQuery.error || (contentQuery.data?.ok === false ? new Error(contentQuery.data.message || sectionErrorMessage("assuntos e hashtags")) : null),
    topPostsQuery.error || (topPostsQuery.data?.ok === false ? new Error(topPostsQuery.data.message || sectionErrorMessage("top posts")) : null),
  ].filter(Boolean) as Error[];

  const agg: Agg = {
    kpis: coreData?.kpis ?? emptyKpis,
    series: coreData?.series ?? [],
    by_network: coreData?.by_network ?? [],
    heatmap: coreData?.heatmap ?? [],
    hashtags: (contentData?.hashtags ?? []).filter((h) => isValidHashtag(h.tag)),
    topics: (contentData?.topics ?? []).filter((t) => t.theme?.trim() && t.mentions > 0),
    top_posts: (topPostsData?.top_posts ?? []).filter((p) => isWithinSelectedPeriod(p.original_posted_at, days)),
  };

  const k = agg?.kpis;
  const total = k?.total ?? 0;
  const labeled = (k?.pos ?? 0) + (k?.neg ?? 0) + (k?.neu ?? 0);
  const posPct = pct(k?.pos ?? 0, labeled);
  const negPct = pct(k?.neg ?? 0, labeled);
  const neuPct = pct(k?.neu ?? 0, labeled);
  const prevLabeled = (k?.prev_pos ?? 0) + (k?.prev_neg ?? 0) + (k?.prev_neu ?? 0);
  const prevPosPct = pct(k?.prev_pos ?? 0, prevLabeled);
  const prevNegPct = pct(k?.prev_neg ?? 0, prevLabeled);
  const prevNeuPct = pct(k?.prev_neu ?? 0, prevLabeled);
  const growthPct = growth(total, k?.prev_total ?? 0);

  // Rede dominante por score composto: 50% volume normalizado + 50% engajamento normalizado
  const dominantNet = useMemo(() => {
    const nets = agg?.by_network ?? [];
    if (!nets.length) return null;
    const maxM = Math.max(1, ...nets.map((n) => n.mentions || 0));
    const maxE = Math.max(1, ...nets.map((n) => n.engagement || 0));
    const scored = nets.map((n) => ({
      ...n,
      dominanceScore: ((n.mentions || 0) / maxM) * 0.5 + ((n.engagement || 0) / maxE) * 0.5,
    }));
    scored.sort((a, b) => b.dominanceScore - a.dominanceScore);
    return scored[0];
  }, [agg]);
  const dominant = dominantNet?.network ?? "—";

  // Interações reais = curtidas + comentários + compartilhamentos (views NÃO entram)
  const realInteractions = (k?.likes ?? 0) + (k?.replies ?? 0) + (k?.shares ?? 0);

  const networksSum = (agg?.by_network ?? []).reduce((s, n) => s + (n.mentions || 0), 0);
  const consistencyOk = total === 0 || (
    Math.abs(networksSum - total) / Math.max(total, 1) <= 0.01 &&
    Math.abs(labeled - total) / Math.max(total, 1) <= 0.05
  );
  const lowVolume = total > 0 && total < 50;

  const sentimentSeries = useMemo(() => {
    return (agg?.series ?? []).map((d) => {
      const tot = d.p + d.n + d.u;
      return {
        date: format(parseISO(d.day), "dd/MM"),
        positivo: d.p,
        negativo: d.n,
        neutro: d.u,
        positivoPct: pct(d.p, tot),
        negativoPct: pct(d.n, tot),
        neutroPct: pct(d.u, tot),
      };
    });
  }, [agg]);

  const sentimentPie = [
    { name: "Positivo", value: k?.pos ?? 0, color: COLORS.positive },
    { name: "Negativo", value: k?.neg ?? 0, color: COLORS.negative },
    { name: "Neutro", value: k?.neu ?? 0, color: COLORS.neutral },
  ].filter((d) => d.value > 0);

  const heat = useMemo(() => {
    const m = new Map<string, number>();
    let max = 0;
    for (const h of agg?.heatmap ?? []) {
      m.set(`${h.dow}-${h.hr}`, h.c);
      if (h.c > max) max = h.c;
    }
    return { m, max: Math.max(1, max) };
  }, [agg]);

  const maxHashtag = Math.max(1, ...(agg?.hashtags ?? []).map((h) => h.c));

  // Resumo executivo derivado dos dados reais: forte_em / sofre_em / narrativas / momento.
  const aiBullets = useMemo(() => {
    if (!agg || total < 30 || !agg.by_network.length) return null;
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const nets = [...agg.by_network].sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
    const strong = nets[0];
    const weakSentNet = [...agg.by_network]
      .map((n) => ({ ...n, neg: Math.max(0, (n.mentions || 0) - (n.likes || 0) - (n.replies || 0)) }))
      .sort((a, b) => b.neg - a.neg)[0];
    const topTopics = (agg.topics ?? []).slice(0, 3).map((t) => t.theme).filter(Boolean);
    const moment = growthPct === null
      ? "Sem base histórica suficiente para avaliar tendência."
      : growthPct >= 30 ? `Crescimento acelerado (+${growthPct}% vs. período anterior).`
      : growthPct <= -30 ? `Queda significativa (${growthPct}% vs. período anterior).`
      : `Estabilidade no volume (${growthPct >= 0 ? "+" : ""}${growthPct}%).`;
    return [
      { label: "Mais forte em", text: `${cap(strong.network)} — ${fmt(strong.mentions)} menções, ${compact(strong.engagement || 0)} interações.` },
      { label: "Sofre mais em", text: negPct > posPct
          ? `Sentimento negativo predomina (${negPct}% vs. ${posPct}% positivo).`
          : `${cap(weakSentNet?.network ?? "—")} com a menor proporção positiva.` },
      { label: "Narrativas dominantes", text: topTopics.length ? topTopics.join(" · ") : "Sem temas dominantes classificados." },
      { label: "Momento", text: moment },
    ];
  }, [agg, total, growthPct, posPct, negPct]);

  // Alertas IA baseados em regras: variação > 30%, crise de sentimento, pico em horário eleitoral (17h-22h).
  const aiAlerts = useMemo(() => {
    const alerts: { level: "success" | "warning" | "destructive"; title: string; detail: string }[] = [];
    if (!agg) return alerts;
    // Variação por rede (precisa comparar com prev — usamos só growth global aqui)
    if (growthPct !== null && growthPct >= 30) {
      alerts.push({ level: "success", title: "Crescimento anormal", detail: `Volume +${growthPct}% vs. período anterior.` });
    } else if (growthPct !== null && growthPct <= -30) {
      alerts.push({ level: "destructive", title: "Queda acentuada", detail: `Volume ${growthPct}% vs. período anterior.` });
    }
    // Crise de sentimento
    if (prevLabeled > 0 && labeled > 0 && (negPct - prevNegPct) >= 15) {
      alerts.push({ level: "destructive", title: "Aumento de sentimento negativo", detail: `+${negPct - prevNegPct}pp de negativo em relação ao período anterior.` });
    }
    // Pico em horário eleitoral (17h-22h)
    const electoralPeak = (agg.heatmap ?? []).filter((h) => h.hr >= 17 && h.hr <= 22);
    const totalElectoral = electoralPeak.reduce((s, h) => s + h.c, 0);
    const totalHeat = (agg.heatmap ?? []).reduce((s, h) => s + h.c, 0);
    if (totalHeat > 100 && totalElectoral / totalHeat >= 0.5) {
      alerts.push({ level: "warning", title: "Pico em janela eleitoral", detail: `${Math.round((totalElectoral / totalHeat) * 100)}% das menções ocorrem entre 17h-22h.` });
    }
    return alerts;
  }, [agg, growthPct, negPct, prevNegPct, labeled, prevLabeled]);


  return (
    <div className="space-y-6">
      {/* Header + Filters */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Visão por Rede Social
          </h1>
          <p className="text-muted-foreground mt-1">
            Análise detalhada de comportamento, sentimento e repercussão por plataforma.
          </p>
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
            <SelectContent>{NETWORKS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {sectionErrors.length > 0 && (
        <Card className="p-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {sectionErrors.map((err, index) => (
            <div key={`${err.message}-${index}`}>{err.message}</div>
          ))}
        </Card>
      )}

      {!isLoadingCore && !consistencyOk && (
        <Card className="p-4 border-warning/40 bg-warning/5 text-sm">
          Recalculando agregações — algumas métricas estão sendo reprocessadas para garantir consistência.
        </Card>
      )}

      {!isLoadingCore && total > 0 && total < 50 && (
        <Card className="p-4 border-warning/40 bg-warning/5 text-sm flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold mb-0.5">Dados insuficientes para análise estatística confiável</div>
            <div className="text-muted-foreground text-xs">Apenas {fmt(total)} menções no período selecionado. Aumente o período ou aguarde mais coleta para análises mais robustas.</div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Total de menções" value={fmt(total)} icon={<MessageSquare className="h-4 w-4" />} loading={isLoadingCore} />
        <Kpi label="Interações" value={compact(realInteractions)} icon={<Activity className="h-4 w-4" />} loading={isLoadingCore} sub={`${compact(k?.likes ?? 0)} ♥ · ${compact(k?.replies ?? 0)} 💬 · ${compact(k?.shares ?? 0)} ↗`} />
        <Kpi label="Sentimento positivo" value={`${posPct}%`} icon={<Heart className="h-4 w-4 text-success" />} loading={isLoadingCore} sub={`${fmt(k?.pos ?? 0)} menções`} tone="success" delta={prevLabeled > 0 ? posPct - prevPosPct : undefined} />
        <Kpi label="Sentimento negativo" value={`${negPct}%`} icon={<TrendingDown className="h-4 w-4 text-destructive" />} loading={isLoadingCore} sub={`${fmt(k?.neg ?? 0)} menções`} tone="destructive" delta={prevLabeled > 0 ? negPct - prevNegPct : undefined} invertDelta />
        <Kpi label="Crescimento" value={growthPct === null ? "—" : `${growthPct >= 0 ? "+" : ""}${growthPct}%`} icon={growthPct === null || growthPct >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} loading={isLoadingCore} sub={growthPct === null ? "Sem base histórica suficiente" : "vs. período anterior"} tone={growthPct === null || growthPct >= 0 ? "success" : "destructive"} />
        <Kpi label="Rede dominante" value={dominant === "—" ? "—" : dominant.charAt(0).toUpperCase() + dominant.slice(1)} icon={<Crown className="h-4 w-4" />} loading={isLoadingCore} sub={dominantNet && total > 0 ? `${fmt(dominantNet.mentions)} menções · ${compact(dominantNet.engagement || 0)} int.` : ""} />
      </div>

      {/* AI Alerts */}
      {!isLoadingCore && aiAlerts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {aiAlerts.map((a, i) => {
            const toneClass = a.level === "destructive" ? "border-destructive/40 bg-destructive/5"
              : a.level === "warning" ? "border-warning/40 bg-warning/5"
              : "border-success/40 bg-success/5";
            const iconClass = a.level === "destructive" ? "text-destructive"
              : a.level === "warning" ? "text-warning" : "text-success";
            return (
              <Card key={i} className={`p-3 flex items-start gap-2 ${toneClass}`}>
                <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold">{a.title}</div>
                  <div className="text-[11px] text-muted-foreground">{a.detail}</div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* AI Insight */}
      {!isLoadingCore && aiBullets && (
        <Card className="p-5 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0"><Sparkles className="h-5 w-5 text-primary" /></div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold mb-2">Resumo executivo</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                {aiBullets.map((b) => (
                  <div key={b.label} className="text-sm">
                    <span className="font-semibold text-foreground">{b.label}: </span>
                    <span className="text-muted-foreground">{b.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Sentiment temporal + distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-2">
          <h3 className="text-lg font-bold mb-1">Sentimento ao longo do tempo</h3>
          <p className="text-sm text-muted-foreground mb-4">Evolução de positivo, negativo e neutro</p>
          {isLoadingCore ? <Skeleton className="h-[300px] w-full" /> : sentimentSeries.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={sentimentSeries}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  formatter={(value: any, name: any, props: any) => {
                    const pctKey = name === "Positivo" ? "positivoPct" : name === "Negativo" ? "negativoPct" : "neutroPct";
                    return [`${value} (${props.payload[pctKey]}%)`, name];
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="positivo" stroke={COLORS.positive} strokeWidth={2} name="Positivo" dot={false} />
                <Line type="monotone" dataKey="negativo" stroke={COLORS.negative} strokeWidth={2} name="Negativo" dot={false} />
                <Line type="monotone" dataKey="neutro" stroke={COLORS.neutral} strokeWidth={2} name="Neutro" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Distribuição de sentimento</h3>
          <p className="text-sm text-muted-foreground mb-4">Proporção atual e variação</p>
          {isLoadingCore ? <Skeleton className="h-[300px] w-full" /> : sentimentPie.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={sentimentPie} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={2}>
                    {sentimentPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                <SentBar label="Positivo" pct={posPct} count={k?.pos ?? 0} delta={prevLabeled > 0 ? posPct - prevPosPct : 0} color={COLORS.positive} />
                <SentBar label="Negativo" pct={negPct} count={k?.neg ?? 0} delta={prevLabeled > 0 ? negPct - prevNegPct : 0} color={COLORS.negative} invert />
                <SentBar label="Neutro" pct={neuPct} count={k?.neu ?? 0} delta={prevLabeled > 0 ? neuPct - prevNeuPct : 0} color={COLORS.neutral} />
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Engagement by network */}
      {network === "all" && (
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Engajamento por rede</h3>
          <p className="text-sm text-muted-foreground mb-4">Curtidas, respostas e compartilhamentos</p>
          {isLoadingCore ? <Skeleton className="h-[280px] w-full" /> : !agg?.by_network.length ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={agg.by_network}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="network" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="likes" fill={COLORS.positive} name="Curtidas" stackId="a" />
                <Bar dataKey="replies" fill={COLORS.primary} name="Comentários" stackId="a" />
                <Bar dataKey="shares" fill={COLORS.accent} name="Compartilhamentos" stackId="a" />
                <Bar dataKey="mentions" fill={COLORS.neutral} name="Menções" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}

      {/* Heatmap */}
      {!lowVolume && (
      <Card className="p-6">
        <h3 className="text-lg font-bold mb-1">Horários de maior movimento</h3>
        <p className="text-sm text-muted-foreground mb-4">Dia da semana × hora — concentração de atividade</p>
        {isLoadingCore ? <Skeleton className="h-[220px] w-full" /> : !agg?.heatmap.length ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <div className="inline-grid gap-1" style={{ gridTemplateColumns: "auto repeat(24, minmax(20px, 1fr))" }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-[9px] text-center text-muted-foreground">{h}</div>
              ))}
              {DOW.map((dn, di) => (
                <>
                  <div key={`l-${di}`} className="text-[10px] text-muted-foreground pr-2 flex items-center">{dn}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const c = heat.m.get(`${di}-${h}`) || 0;
                    const intensity = c / heat.max;
                    return (
                      <div
                        key={`${di}-${h}`}
                        title={`${dn} ${h}h — ${fmt(c)} menções`}
                        className="aspect-square rounded-sm"
                        style={{ backgroundColor: `hsl(var(--primary) / ${0.08 + intensity * 0.85})` }}
                      />
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        )}
      </Card>
      )}

      {/* Top Posts */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">Top posts</h3>
          <Badge variant="outline" className="text-[10px]">score = curtidas + 2·comentários + 3·shares + 0,1·views</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Posts com maior repercussão no período</p>
        {isLoadingTopPosts ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        ) : !agg?.top_posts?.length ? (
          <div className="h-[160px] flex flex-col items-center justify-center text-sm text-muted-foreground text-center px-4 gap-2">
            <MessageSquare className="h-6 w-6 opacity-40" />
            <span>Sem posts com engajamento suficiente nesse recorte. Tente ampliar o período ou trocar de rede.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agg.top_posts.slice(0, 10).map((p) => {
              const sentColor = p.sent?.toLowerCase().startsWith("pos") ? COLORS.positive
                : p.sent?.toLowerCase().startsWith("neg") ? COLORS.negative : COLORS.neutral;
              return (
                <div key={p.id} className="border border-border rounded-lg p-3 hover:shadow-sm transition-shadow flex gap-3">
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt="" loading="lazy" className="w-16 h-16 rounded-md object-cover shrink-0 bg-muted" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-16 h-16 rounded-md bg-muted shrink-0 flex items-center justify-center"><MessageSquare className="h-5 w-5 text-muted-foreground/50" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Badge variant="secondary" className="text-[9px] uppercase">{p.social_network}</Badge>
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: `${sentColor}22`, color: sentColor }}>{p.sent}</span>
                    </div>
                    <p className="text-xs text-foreground line-clamp-2 mb-1">{p.comment_text}</p>
                    <div className="text-[10px] text-muted-foreground truncate mb-1">@{p.comment_author || "anônimo"}</div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{compact(p.likes)}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{compact(p.replies)}</span>
                      <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{compact(p.shares)}</span>
                      {(p.views ?? 0) > 0 && <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{compact(p.views ?? 0)}</span>}
                      {p.post_url && (
                        <a href={p.post_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Topics + Hashtags */}
      {!lowVolume && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Assuntos dominantes</h3>
          <p className="text-sm text-muted-foreground mb-4">Temas detectados em posts, comentários e respostas (agrupamento semântico)</p>
          {isLoadingContent ? <LoadingMessage label="Carregando assuntos..." /> : !agg?.topics.length ? <EmptyState /> : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2">
              {agg.topics.map((t) => {
                const lab = t.pos + t.neg + t.neu;
                const variation = growth(t.mentions, t.prev_mentions);
                const posP = pct(t.pos, lab);
                return (
                  <div key={t.theme} className="border border-border rounded-md p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold">{t.theme}</span>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{fmt(t.mentions)} menções</span>
                        {variation === null ? <span className="text-muted-foreground">Sem base histórica</span> : <span className={`font-medium ${variation >= 0 ? "text-success" : "text-destructive"}`}>{variation >= 0 ? "+" : ""}{variation}%</span>}
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mb-1">{posP}% positivo</div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                      <div style={{ width: `${pct(t.pos, lab)}%`, backgroundColor: COLORS.positive }} />
                      <div style={{ width: `${pct(t.neu, lab)}%`, backgroundColor: COLORS.neutral }} />
                      <div style={{ width: `${pct(t.neg, lab)}%`, backgroundColor: COLORS.negative }} />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                      <span>+{pct(t.pos, lab)}%</span>
                      <span>~{pct(t.neu, lab)}%</span>
                      <span>−{pct(t.neg, lab)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Hash className="h-5 w-5" /> Hashtags recorrentes</h3>
          <p className="text-sm text-muted-foreground mb-4">Top 20 — explícitas e implícitas, com variação e sentimento</p>
          {isLoadingContent ? <LoadingMessage label="Carregando hashtags..." /> : !agg?.hashtags.length ? <EmptyState /> : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-2">
              {agg.hashtags.map((h) => {
                const lab = h.pos + h.neg + h.neu;
                const variation = growth(h.c, h.prev_c);
                const posP = pct(h.pos, lab);
                return (
                  <div key={h.tag} className="flex items-center justify-between border border-border rounded-md p-2 text-sm">
                    <span className="font-medium truncate max-w-[40%]">{h.tag}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">{fmt(h.c)}</span>
                      {variation === null ? <span className="text-muted-foreground">Sem base histórica</span> : <span className={`font-medium ${variation >= 0 ? "text-success" : "text-destructive"}`}>{variation >= 0 ? "+" : ""}{variation}%</span>}
                      {lab > 0 && <span className="text-success">{posP}% pos</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      )}

    </div>
  );
}

function Kpi({ label, value, icon, loading, sub, tone, delta, invertDelta }: {
  label: string; value: string; icon: React.ReactNode; loading?: boolean; sub?: string;
  tone?: "success" | "destructive"; delta?: number; invertDelta?: boolean;
}) {
  const goodDelta = invertDelta ? (delta ?? 0) < 0 : (delta ?? 0) > 0;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className={tone === "destructive" ? "text-destructive" : tone === "success" ? "text-success" : "text-primary"}>{icon}</span>
      </div>
      {loading ? <Skeleton className="h-7 w-20" /> : <div className="text-xl font-bold">{value}</div>}
      <div className="flex items-center justify-between mt-1">
        {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
        {delta !== undefined && delta !== 0 && (
          <span className={`text-[10px] font-medium ${goodDelta ? "text-success" : "text-destructive"}`}>
            {delta > 0 ? "+" : ""}{delta}pp
          </span>
        )}
      </div>
    </Card>
  );
}

function SentBar({ label, pct: p, count, delta, color, invert }: { label: string; pct: number; count?: number; delta: number; color: string; invert?: boolean }) {
  const goodDelta = invert ? delta < 0 : delta > 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-semibold">{p}%{count !== undefined ? ` (${Number(count ?? 0).toLocaleString("pt-BR")})` : ""}</span>
          {delta !== 0 && (
            <span className={goodDelta ? "text-success" : "text-destructive"}>
              ({delta > 0 ? "+" : ""}{delta}pp)
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function LoadingMessage({ label }: { label: string }) {
  return (
    <div className="h-[200px] flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground text-center px-4">
      <Skeleton className="h-8 w-8 rounded-full" />
      <span>{label}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground text-center px-4">
      Nenhum dado encontrado para esta rede no período selecionado.
    </div>
  );
}
