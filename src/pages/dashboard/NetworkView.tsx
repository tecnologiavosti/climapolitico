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
  MessageSquare, TrendingUp, TrendingDown, Heart, Hash, Users, Activity, Crown, Sparkles, ExternalLink,
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
  hashtags: { tag: string; c: number }[];
  topics: { theme: string; mentions: number; pos: number; neg: number; neu: number }[];
  top_posts: { id: string; social_network: string; comment_text: string; comment_author: string; sent: string; eng: number; likes: number; replies: number; shares: number; original_posted_at: string; collected_at: string }[];
};

const fmt = (n: number) => n.toLocaleString("pt-BR");
const compact = (n: number) => Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const growth = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0);

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

  const { data: agg, isLoading, error } = useQuery({
    queryKey: ["nv-agg", user?.id, network, candidateId, days],
    queryFn: async (): Promise<Agg> => {
      const { data, error } = await supabase.rpc("network_view_aggregate", {
        p_candidate_id: candidateId === "all" ? null : candidateId,
        p_network: network === "all" ? null : network,
        p_days: days,
      });
      if (error) throw error;
      return data as unknown as Agg;
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

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
  const dominant = agg?.by_network?.[0]?.network ?? "—";

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

  const aiSummary = useMemo(() => {
    if (!agg || !agg.by_network.length) return null;
    const top = agg.by_network[0];
    const sorted = [...agg.by_network].sort((a, b) => {
      const aPos = (agg.top_posts.filter((p) => p.social_network === a.network && p.sent === "positive").length);
      const bPos = (agg.top_posts.filter((p) => p.social_network === b.network && p.sent === "positive").length);
      return bPos - aPos;
    });
    const mostPositive = sorted[0]?.network ?? top.network;
    const trend = growthPct >= 0 ? `crescimento de ${growthPct}%` : `queda de ${Math.abs(growthPct)}%`;
    return `${top.network.charAt(0).toUpperCase() + top.network.slice(1)} concentra o maior volume de menções (${compact(top.mentions)}), com ${trend} no período. ${mostPositive.charAt(0).toUpperCase() + mostPositive.slice(1)} aparece como a rede com maior proporção de apoio entre os posts mais relevantes. O sentimento geral está em ${posPct}% positivo, ${negPct}% negativo e ${neuPct}% neutro.`;
  }, [agg, growthPct, posPct, negPct, neuPct]);

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

      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          Erro ao carregar dados: {(error as Error).message}
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Total de menções" value={fmt(total)} icon={<MessageSquare className="h-4 w-4" />} loading={isLoading} />
        <Kpi label="Interações" value={compact(k?.engagement ?? 0)} icon={<Activity className="h-4 w-4" />} loading={isLoading} sub={`${fmt(k?.likes ?? 0)} curtidas`} />
        <Kpi label="Sentimento positivo" value={`${posPct}%`} icon={<Heart className="h-4 w-4 text-success" />} loading={isLoading} sub={`${fmt(k?.pos ?? 0)} menções`} tone="success" delta={posPct - prevPosPct} />
        <Kpi label="Sentimento negativo" value={`${negPct}%`} icon={<TrendingDown className="h-4 w-4 text-destructive" />} loading={isLoading} sub={`${fmt(k?.neg ?? 0)} menções`} tone="destructive" delta={negPct - prevNegPct} invertDelta />
        <Kpi label="Crescimento" value={`${growthPct >= 0 ? "+" : ""}${growthPct}%`} icon={growthPct >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} loading={isLoading} sub="vs. período anterior" tone={growthPct >= 0 ? "success" : "destructive"} />
        <Kpi label="Rede dominante" value={dominant === "—" ? "—" : dominant.charAt(0).toUpperCase() + dominant.slice(1)} icon={<Crown className="h-4 w-4" />} loading={isLoading} sub={agg?.by_network?.[0] ? `${compact(agg.by_network[0].mentions)} menções` : ""} />
      </div>

      {/* AI Insight */}
      {!isLoading && aiSummary && (
        <Card className="p-5 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Sparkles className="h-5 w-5 text-primary" /></div>
            <div>
              <h3 className="font-bold mb-1">Resumo da IA</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{aiSummary}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Sentiment temporal + distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-2">
          <h3 className="text-lg font-bold mb-1">Sentimento ao longo do tempo</h3>
          <p className="text-sm text-muted-foreground mb-4">Evolução de positivo, negativo e neutro</p>
          {isLoading ? <Skeleton className="h-[300px] w-full" /> : sentimentSeries.length === 0 ? (
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
          {isLoading ? <Skeleton className="h-[300px] w-full" /> : sentimentPie.length === 0 ? (
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
                <SentBar label="Positivo" pct={posPct} delta={posPct - prevPosPct} color={COLORS.positive} />
                <SentBar label="Negativo" pct={negPct} delta={negPct - prevNegPct} color={COLORS.negative} invert />
                <SentBar label="Neutro" pct={neuPct} delta={neuPct - prevNeuPct} color={COLORS.neutral} />
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
          {isLoading ? <Skeleton className="h-[280px] w-full" /> : !agg?.by_network.length ? <EmptyState /> : (
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
      <Card className="p-6">
        <h3 className="text-lg font-bold mb-1">Horários de maior movimento</h3>
        <p className="text-sm text-muted-foreground mb-4">Dia da semana × hora — concentração de atividade</p>
        {isLoading ? <Skeleton className="h-[220px] w-full" /> : !agg?.heatmap.length ? <EmptyState /> : (
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

      {/* Topics + Hashtags */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Assuntos dominantes</h3>
          <p className="text-sm text-muted-foreground mb-4">Temas detectados nas menções</p>
          {isLoading ? <Skeleton className="h-[200px] w-full" /> : !agg?.topics.length ? <EmptyState /> : (
            <div className="space-y-2">
              {agg.topics.map((t) => {
                const lab = t.pos + t.neg + t.neu;
                return (
                  <div key={t.theme} className="border border-border rounded-md p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">{t.theme}</span>
                      <span className="text-sm text-muted-foreground">{fmt(t.mentions)} menções</span>
                    </div>
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
          <p className="text-sm text-muted-foreground mb-4">Top 15 do período</p>
          {isLoading ? <Skeleton className="h-[200px] w-full" /> : !agg?.hashtags.length ? <EmptyState /> : (
            <div className="flex flex-wrap gap-2">
              {agg.hashtags.map((h) => (
                <Badge
                  key={h.tag}
                  variant="secondary"
                  style={{ fontSize: `${0.75 + (h.c / maxHashtag) * 0.6}rem` }}
                >
                  {h.tag} <span className="ml-1 opacity-60">{fmt(h.c)}</span>
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Top posts */}
      <Card className="p-6">
        <h3 className="text-lg font-bold mb-1">Top 5 posts</h3>
        <p className="text-sm text-muted-foreground mb-4">Posts com maior engajamento no período</p>
        {isLoading ? <Skeleton className="h-[300px] w-full" /> : !agg?.top_posts.length ? <EmptyState /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agg.top_posts.map((p) => (
              <div key={p.id} className="border border-border rounded-lg p-4 hover:bg-muted/30 transition">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className="text-xs">{p.social_network}</Badge>
                  {p.sent && (
                    <Badge variant={p.sent === "positive" ? "default" : p.sent === "negative" ? "destructive" : "secondary"} className="text-[10px]">
                      {p.sent === "positive" ? "Positivo" : p.sent === "negative" ? "Negativo" : "Neutro"}
                    </Badge>
                  )}
                </div>
                <p className="text-sm line-clamp-3 mb-2">{p.comment_text}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate max-w-[140px]">{p.comment_author || "anônimo"}</span>
                  <span><Users className="h-3 w-3 inline mr-1" />{compact(p.eng)} interações</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {p.original_posted_at && format(parseISO(p.original_posted_at), "dd MMM yyyy", { locale: ptBR })}
                </div>
                <Button variant="ghost" size="sm" className="mt-2 w-full text-xs h-7" disabled>
                  <ExternalLink className="h-3 w-3 mr-1" /> Ver detalhes
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
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

function SentBar({ label, pct: p, delta, color, invert }: { label: string; pct: number; delta: number; color: string; invert?: boolean }) {
  const goodDelta = invert ? delta < 0 : delta > 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-semibold">{p}%</span>
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

function EmptyState() {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground text-center px-4">
      Nenhum dado encontrado para esta rede no período selecionado.
    </div>
  );
}
