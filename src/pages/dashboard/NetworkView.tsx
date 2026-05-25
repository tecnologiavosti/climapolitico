import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { isHiddenNetwork } from "@/lib/networkVisibility";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { MessageSquare, TrendingUp, TrendingDown, Heart, Hash, Clock, Users } from "lucide-react";
import { format, subDays, parseISO, getHours } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Lista canônica das redes exibidas no filtro */
const NETWORKS: { value: string; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "X / Twitter" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "reddit", label: "Reddit" },
  { value: "telegram", label: "Telegram" },
  { value: "google_news", label: "Notícias" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "bluesky", label: "Bluesky" },
];

const COLORS = {
  positive: "hsl(var(--success))",
  negative: "hsl(var(--destructive))",
  neutral: "hsl(var(--warning))",
  primary: "hsl(var(--primary))",
};

const STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","em","um","uma","para","por","com",
  "que","se","na","no","nas","nos","é","ao","aos","ou","mais","como","muito",
  "ser","ter","seu","sua","seus","suas","mas","já","só","pra","pro","isso",
  "isso","esse","essa","este","esta","tudo","nada","quem","onde","quando",
  "porque","quer","tá","tô","aqui","ali","lá","sim","não","você","voce",
  "ele","ela","eles","elas","nós","vocês","minha","meu","this","that","the",
  "of","and","to","in","is","it","for","on","at","with","i","you","https",
  "http","www","com","br",
]);

export default function NetworkView() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [network, setNetwork] = useState("all");
  const [candidateId, setCandidateId] = useState<string>("all");
  const [days, setDays] = useState(7);

  // Lista de candidatos
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

  // Interações do período
  const { data: interactions, isLoading } = useQuery({
    queryKey: ["nv-interactions", user?.id, isAdmin, network, candidateId, days],
    queryFn: async () => {
      const since = subDays(new Date(), days).toISOString();
      let q = supabase
        .from("social_interactions")
        .select("id, social_network, comment_text, comment_author, likes_count, replies_count, shares_count, sentiment_label, sentiment_score, original_posted_at, collected_at, candidate_id")
        .gte("collected_at", since)
        .order("collected_at", { ascending: false })
        .limit(5000);
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      if (network !== "all") q = q.eq("social_network", network);
      if (candidateId !== "all") q = q.eq("candidate_id", candidateId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).filter((r) => !isHiddenNetwork(r.social_network));
    },
    enabled: !!user,
  });

  // KPIs agregados
  const kpis = useMemo(() => {
    const list = interactions || [];
    const total = list.length;
    const likes = list.reduce((s, r) => s + (r.likes_count || 0), 0);
    const replies = list.reduce((s, r) => s + (r.replies_count || 0), 0);
    const shares = list.reduce((s, r) => s + (r.shares_count || 0), 0);
    const engagement = likes + replies + shares;
    const pos = list.filter((r) => r.sentiment_label === "positive").length;
    const neg = list.filter((r) => r.sentiment_label === "negative").length;
    const neu = list.filter((r) => r.sentiment_label === "neutral").length;
    const labeled = pos + neg + neu;
    const sentimentPct = labeled > 0 ? Math.round((pos / labeled) * 100) : 0;

    // crescimento: comparar primeira metade vs segunda metade
    const half = Math.floor(days / 2);
    const cutoff = subDays(new Date(), half).getTime();
    const recent = list.filter((r) => new Date(r.collected_at || 0).getTime() >= cutoff).length;
    const previous = list.length - recent;
    const growth = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : recent > 0 ? 100 : 0;

    const authors = new Set(list.map((r) => r.comment_author).filter(Boolean)).size;

    return { total, engagement, sentimentPct, growth, pos, neg, neu, authors, likes, replies, shares };
  }, [interactions, days]);

  // Série diária de sentimento
  const sentimentSeries = useMemo(() => {
    const map = new Map<string, { date: string; positive: number; negative: number; neutral: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "dd/MM");
      map.set(d, { date: d, positive: 0, negative: 0, neutral: 0 });
    }
    for (const r of interactions || []) {
      if (!r.collected_at) continue;
      const key = format(new Date(r.collected_at), "dd/MM");
      const e = map.get(key);
      if (!e) continue;
      if (r.sentiment_label === "positive") e.positive++;
      else if (r.sentiment_label === "negative") e.negative++;
      else if (r.sentiment_label === "neutral") e.neutral++;
    }
    return Array.from(map.values());
  }, [interactions, days]);

  // Distribuição pizza
  const sentimentPie = useMemo(() => [
    { name: "Positivo", value: kpis.pos, color: COLORS.positive },
    { name: "Negativo", value: kpis.neg, color: COLORS.negative },
    { name: "Neutro", value: kpis.neu, color: COLORS.neutral },
  ].filter((d) => d.value > 0), [kpis]);

  // Engajamento por rede (quando "all")
  const engagementByNetwork = useMemo(() => {
    const m = new Map<string, { network: string; engagement: number; mentions: number }>();
    for (const r of interactions || []) {
      const k = r.social_network || "outro";
      const e = m.get(k) || { network: k, engagement: 0, mentions: 0 };
      e.engagement += (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0);
      e.mentions += 1;
      m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => b.engagement - a.engagement);
  }, [interactions]);

  // Top posts (por engajamento)
  const topPosts = useMemo(() => {
    return [...(interactions || [])]
      .map((r) => ({
        ...r,
        eng: (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0),
      }))
      .sort((a, b) => b.eng - a.eng)
      .slice(0, 8);
  }, [interactions]);

  // Hashtags
  const topHashtags = useMemo(() => {
    const counter = new Map<string, number>();
    for (const r of interactions || []) {
      const matches = (r.comment_text || "").match(/#[\p{L}0-9_]+/gu) || [];
      for (const tag of matches) {
        const k = tag.toLowerCase();
        counter.set(k, (counter.get(k) || 0) + 1);
      }
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, count]) => ({ tag, count }));
  }, [interactions]);

  // Horários (heatmap simples por hora 0-23)
  const hourBuckets = useMemo(() => {
    const bins = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    for (const r of interactions || []) {
      const dt = r.original_posted_at || r.collected_at;
      if (!dt) continue;
      bins[getHours(new Date(dt))].count++;
    }
    return bins;
  }, [interactions]);
  const maxHour = Math.max(1, ...hourBuckets.map((b) => b.count));

  // Word cloud (palavras mais frequentes)
  const wordCloud = useMemo(() => {
    const counter = new Map<string, number>();
    for (const r of interactions || []) {
      const txt = (r.comment_text || "").toLowerCase();
      const words = txt.match(/[\p{L}]{4,}/gu) || [];
      for (const w of words) {
        if (STOPWORDS.has(w)) continue;
        counter.set(w, (counter.get(w) || 0) + 1);
      }
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([word, count]) => ({ word, count }));
  }, [interactions]);
  const maxWord = Math.max(1, ...wordCloud.map((w) => w.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Visão por Rede Social
          </h1>
          <p className="text-muted-foreground mt-1">
            KPIs, gráficos, top posts e horários — filtre por rede e candidato.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={network} onValueChange={setNetwork}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Rede" /></SelectTrigger>
            <SelectContent>
              {NETWORKS.map((n) => (
                <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos candidatos</SelectItem>
              {candidates?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="14">Últimos 14 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total de menções" value={kpis.total.toLocaleString("pt-BR")} icon={<MessageSquare className="h-5 w-5" />} loading={isLoading} sub={`${kpis.authors} autores únicos`} />
        <KpiCard
          label="Crescimento"
          value={`${kpis.growth >= 0 ? "+" : ""}${kpis.growth}%`}
          icon={kpis.growth >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          loading={isLoading}
          sub="vs. metade anterior"
          tone={kpis.growth >= 0 ? "success" : "destructive"}
        />
        <KpiCard label="Sentimento positivo" value={`${kpis.sentimentPct}%`} icon={<Heart className="h-5 w-5" />} loading={isLoading} sub={`${kpis.pos} pos · ${kpis.neg} neg · ${kpis.neu} neu`} />
        <KpiCard label="Engajamento" value={kpis.engagement.toLocaleString("pt-BR")} icon={<Users className="h-5 w-5" />} loading={isLoading} sub={`${kpis.likes} likes · ${kpis.replies} resp · ${kpis.shares} comp`} />
      </div>

      {/* Gráficos linha + pizza */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Sentimento ao longo do tempo</h3>
          <p className="text-sm text-muted-foreground mb-4">Últimos {days} dias</p>
          {isLoading ? <Skeleton className="h-[280px] w-full" /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={sentimentSeries}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" className="text-muted-foreground" />
                <YAxis className="text-muted-foreground" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="positive" stroke={COLORS.positive} strokeWidth={2} name="Positivo" />
                <Line type="monotone" dataKey="negative" stroke={COLORS.negative} strokeWidth={2} name="Negativo" />
                <Line type="monotone" dataKey="neutral" stroke={COLORS.neutral} strokeWidth={2} name="Neutro" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Distribuição de sentimento</h3>
          <p className="text-sm text-muted-foreground mb-4">Proporção positivo / negativo / neutro</p>
          {isLoading ? <Skeleton className="h-[280px] w-full" /> : sentimentPie.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground">Sem comentários analisados no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={sentimentPie} cx="50%" cy="50%" outerRadius={95} dataKey="value" label={(e: any) => `${e.name}: ${e.value}`}>
                  {sentimentPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Engajamento por rede (só quando 'all') */}
      {network === "all" && (
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Engajamento por rede</h3>
          <p className="text-sm text-muted-foreground mb-4">Soma de curtidas + respostas + compartilhamentos</p>
          {isLoading ? <Skeleton className="h-[280px] w-full" /> : engagementByNetwork.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground">Sem dados</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={engagementByNetwork}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="network" className="text-muted-foreground" />
                <YAxis className="text-muted-foreground" />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="engagement" fill={COLORS.primary} name="Engajamento" />
                <Bar dataKey="mentions" fill="hsl(var(--accent))" name="Menções" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}

      {/* Top posts + Hashtags */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-4">Posts mais relevantes</h3>
          {isLoading ? <Skeleton className="h-[300px] w-full" /> : topPosts.length === 0 ? (
            <div className="text-muted-foreground text-sm">Sem posts no período.</div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {topPosts.map((p) => (
                <div key={p.id} className="border border-border rounded-md p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-xs">{p.social_network}</Badge>
                    <span className="text-xs text-muted-foreground">{p.eng.toLocaleString("pt-BR")} interações</span>
                  </div>
                  <p className="text-sm line-clamp-2">{p.comment_text || "(sem texto)"}</p>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>{p.comment_author || "anônimo"}</span>
                    {p.sentiment_label && (
                      <Badge variant={p.sentiment_label === "positive" ? "default" : p.sentiment_label === "negative" ? "destructive" : "secondary"} className="text-[10px]">
                        {p.sentiment_label}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Hash className="h-5 w-5" /> Hashtags mais frequentes</h3>
          <p className="text-sm text-muted-foreground mb-4">Top 15 do período</p>
          {isLoading ? <Skeleton className="h-[200px] w-full" /> : topHashtags.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma hashtag encontrada nos comentários.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topHashtags.map((h) => (
                <Badge key={h.tag} variant="secondary" className="text-sm" style={{ fontSize: `${Math.max(0.75, Math.min(1.4, h.count / Math.max(1, topHashtags[0].count) * 1.4))}rem` }}>
                  {h.tag} <span className="ml-1 opacity-60">{h.count}</span>
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Horários + Nuvem */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Clock className="h-5 w-5" /> Horários com mais atividade</h3>
          <p className="text-sm text-muted-foreground mb-4">Distribuição por hora do dia (0-23)</p>
          {isLoading ? <Skeleton className="h-[180px] w-full" /> : (
            <div className="grid grid-cols-12 gap-1 items-end h-[160px]">
              {hourBuckets.map((b) => (
                <HelpTooltip key={b.hour} text={`${String(b.hour).padStart(2, "0")}h — ${b.count} menções`}>
                  <div className="flex flex-col items-center justify-end h-full cursor-help">
                    <div
                      className="w-full bg-primary/70 hover:bg-primary transition-colors rounded-t"
                      style={{ height: `${(b.count / maxHour) * 100}%`, minHeight: "2px" }}
                    />
                    <span className="text-[10px] text-muted-foreground mt-1">{b.hour}</span>
                  </div>
                </HelpTooltip>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold mb-1">Nuvem de palavras</h3>
          <p className="text-sm text-muted-foreground mb-4">Termos mais usados (excluídas stopwords)</p>
          {isLoading ? <Skeleton className="h-[180px] w-full" /> : wordCloud.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem palavras suficientes para gerar a nuvem.</div>
          ) : (
            <div className="flex flex-wrap gap-2 items-baseline">
              {wordCloud.map((w) => {
                const scale = 0.8 + (w.count / maxWord) * 1.6;
                const opacity = 0.5 + (w.count / maxWord) * 0.5;
                return (
                  <span
                    key={w.word}
                    className="text-primary font-semibold"
                    style={{ fontSize: `${scale}rem`, opacity }}
                    title={`${w.count} ocorrências`}
                  >
                    {w.word}
                  </span>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label, value, sub, icon, loading, tone,
}: {
  label: string; value: string; sub?: string; icon: React.ReactNode; loading?: boolean;
  tone?: "success" | "destructive" | "default";
}) {
  const toneClass = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          {loading ? <Skeleton className="h-8 w-20 mt-2" /> : (
            <p className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</p>
          )}
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className="p-2 bg-gradient-primary rounded-md text-white">{icon}</div>
      </div>
    </Card>
  );
}
