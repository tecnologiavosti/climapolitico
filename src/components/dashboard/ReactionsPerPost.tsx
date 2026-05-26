import { useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Heart, Share2, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import { subDays } from "date-fns";
import { isHiddenNetwork } from "@/lib/networkVisibility";

// Carrega Recharts apenas quando o usuário entra na aba — reduz JS inicial.
const ChartsBlock = lazy(() => import("./ReactionsPerPostCharts"));

interface Props {
  candidateId?: string;
  days?: number;
}

type PeriodKey = "total" | "7d" | "30d" | "90d" | "6m" | "1y" | "custom";

interface SummaryData {
  totalRecords: number;
  postsCount: number;
  commentsCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  classifiedCount: number;
  pendingCount: number;
  totalLikes: number;
  totalReplies: number;
  totalShares: number;
  totalInteractions: number;
  dominantTopics: { topic: string; mentions: number }[];
}

export interface PostRow {
  id: string;
  social_network: string;
  likes_count: number | null;
  replies_count: number | null;
  shares_count: number | null;
  sentiment_label: string | null;
  collected_at: string | null;
}

function periodRange(period: PeriodKey, customStart: string, customEnd: string) {
  const end = period === "custom" && customEnd ? new Date(`${customEnd}T23:59:59`).toISOString() : null;
  if (period === "total") return { start: null, end };
  if (period === "custom") return { start: customStart ? new Date(`${customStart}T00:00:00`).toISOString() : null, end };
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : period === "6m" ? 180 : 365;
  return { start: subDays(new Date(), days).toISOString(), end };
}

function normalizeSentiment(label: string | null): "positive" | "negative" | "neutral" | null {
  const v = (label || "").trim().toLowerCase();
  if (["positivo", "positive", "pos"].includes(v)) return "positive";
  if (["negativo", "negative", "neg"].includes(v)) return "negative";
  if (["neutro", "neutral", "neu"].includes(v)) return "neutral";
  return null;
}

export function ReactionsPerPost({ candidateId }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("total");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const range = useMemo(() => periodRange(selectedPeriod, customStart, customEnd), [selectedPeriod, customStart, customEnd]);

  // KPIs agregados — vem 100% pré-computado do banco (RPC).
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["reactions-summary", user?.id, isAdmin, candidateId, range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_reactions_per_post_summary" as any, {
        _user_id: user!.id,
        _candidate_id: candidateId ?? null,
        _period_start: range.start,
        _period_end: range.end,
      });
      if (error) throw error;
      return data as SummaryData;
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  // Amostra de interações (posts + comentários + respostas) para gráficos + top 5.
  // Totais reais vêm do RPC agregado; aqui trazemos só uma amostra p/ visualizações.
  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: ["reactions-interactions", user?.id, isAdmin, candidateId, range.start, range.end],
    queryFn: async () => {
      let q = supabase
        .from("social_interactions")
        .select("id, social_network, likes_count, replies_count, shares_count, sentiment_label, collected_at")
        .order("collected_at", { ascending: false })
        .limit(1000);
      if (range.start) q = q.gte("collected_at", range.start);
      if (range.end) q = q.lte("collected_at", range.end);
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      if (candidateId) q = q.eq("candidate_id", candidateId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as PostRow[]).filter((r) => !isHiddenNetwork(r.social_network));
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const totals = useMemo(() => {
    const d = summary;
    const pos = d?.positiveCount || 0;
    const neg = d?.negativeCount || 0;
    const neu = d?.neutralCount || 0;
    const labeled = d?.classifiedCount || 0;
    const totalRecords = d?.totalRecords || 0;
    return {
      pos, neg, neu, labeled,
      totalRecords,
      postsCount: d?.postsCount || 0,
      commentsCount: d?.commentsCount || 0,
      totalLikes: d?.totalLikes || 0,
      totalShares: d?.totalShares || 0,
      totalInteractions: d?.totalInteractions || 0,
      posPct: labeled > 0 ? Math.round((pos / labeled) * 100) : 0,
      negPct: labeled > 0 ? Math.round((neg / labeled) * 100) : 0,
      neuPct: labeled > 0 ? Math.round((neu / labeled) * 100) : 0,
    };
  }, [summary]);

  const top5 = useMemo(() => {
    const list = posts || [];
    return [...list]
      .map((p) => ({
        ...p,
        engagement: (p.likes_count || 0) + (p.replies_count || 0) + (p.shares_count || 0),
      }))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 5);
  }, [posts]);

  const topTopics = useMemo(() => {
    return (summary?.dominantTopics || []).slice(0, 8)
      .map((t) => ({ label: t.topic.charAt(0).toUpperCase() + t.topic.slice(1), mentions: t.mentions }));
  }, [summary?.dominantTopics]);

  function dominantSentiment(label: string | null) {
    const s = normalizeSentiment(label);
    if (s === "positive") return { label: "Positivo", color: "text-emerald-600 border-emerald-500/40 bg-emerald-500/10", Icon: ThumbsUp };
    if (s === "negative") return { label: "Negativo", color: "text-rose-600 border-rose-500/40 bg-rose-500/10", Icon: ThumbsDown };
    return { label: "Neutro", color: "text-muted-foreground border-border bg-muted", Icon: Minus };
  }

  return (
    <Card className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HelpTooltip text="Resumo agregado dos posts coletados. Sem listagem de comentários para garantir carregamento rápido.">
          <div className="cursor-help">
            <h3 className="text-lg font-bold">Reações por posts</h3>
            <p className="text-sm text-muted-foreground">Métricas agregadas — gráficos e top 5 posts</p>
          </div>
        </HelpTooltip>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedPeriod} onValueChange={(v) => setSelectedPeriod(v as PeriodKey)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Período" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="total">Total</SelectItem>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
              <SelectItem value="90d">90 dias</SelectItem>
              <SelectItem value="6m">6 meses</SelectItem>
              <SelectItem value="1y">1 ano</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {selectedPeriod === "custom" && (
            <>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-[150px]" />
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-[150px]" />
            </>
          )}
        </div>
      </div>

      {summaryLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : totals.postsCount === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum post no período.</div>
      ) : (
        <>
          {/* KPIs principais */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiBox label="Posts coletados" value={totals.postsCount} />
            <KpiBox label="Curtidas" value={totals.totalLikes} />
            <KpiBox label="Compartilhamentos" value={totals.totalShares} />
            <KpiBox label="Interações totais" value={totals.totalInteractions} highlight />
            <KpiBox label="Sentimento geral" value={totals.posPct - totals.negPct} suffix="%" tone={totals.posPct >= totals.negPct ? "pos" : "neg"} />
          </div>

          {/* Barra de sentimento consolidado */}
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Sentimento consolidado</h4>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <KpiBox label={`Positivo (${totals.posPct}%)`} value={totals.pos} tone="pos" />
              <KpiBox label={`Neutro (${totals.neuPct}%)`} value={totals.neu} tone="neu" />
              <KpiBox label={`Negativo (${totals.negPct}%)`} value={totals.neg} tone="neg" />
            </div>
            <div className="flex h-3 w-full rounded overflow-hidden border border-border">
              <div className="bg-success" style={{ width: `${totals.posPct}%` }} />
              <div className="bg-warning" style={{ width: `${totals.neuPct}%` }} />
              <div className="bg-destructive" style={{ width: `${totals.negPct}%` }} />
            </div>
          </div>

          {topTopics.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Assuntos dominantes:</span>
              {topTopics.map((t) => (
                <Badge key={t.label} variant="secondary" className="text-xs">{t.label} · {t.mentions.toLocaleString("pt-BR")}</Badge>
              ))}
            </div>
          )}

          {/* Gráficos — lazy loaded */}
          {postsLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <Suspense fallback={<Skeleton className="h-80 w-full" />}>
              <ChartsBlock
                posts={posts || []}
                positive={totals.pos}
                negative={totals.neg}
                neutral={totals.neu}
              />
            </Suspense>
          )}

          {/* Top 5 posts */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Top 5 posts por engajamento</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              {top5.map((p) => {
                const ds = dominantSentiment(p.sentiment_label);
                return (
                  <Card key={p.id} className="p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{p.social_network || "?"}</Badge>
                      <Badge className={`text-[10px] border ${ds.color}`}>
                        <ds.Icon className="h-3 w-3 mr-1" />{ds.label}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.collected_at ? new Date(p.collected_at).toLocaleDateString("pt-BR") : "—"}
                    </div>
                    <div className="text-2xl font-bold">{p.engagement.toLocaleString("pt-BR")}</div>
                    <div className="text-[10px] text-muted-foreground -mt-1">Engajamento total</div>
                    <div className="flex justify-between text-xs pt-2 border-t mt-auto">
                      <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{(p.likes_count || 0).toLocaleString("pt-BR")}</span>
                      <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{(p.shares_count || 0).toLocaleString("pt-BR")}</span>
                    </div>
                  </Card>
                );
              })}
              {top5.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full">Nenhum post relevante encontrado no período.</p>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function KpiBox({ label, value, highlight = false, tone, suffix }: { label: string; value: number; highlight?: boolean; tone?: "pos" | "neg" | "neu"; suffix?: string }) {
  const toneClass =
    tone === "pos" ? "bg-success/10 border-success/30"
    : tone === "neg" ? "bg-destructive/10 border-destructive/30"
    : tone === "neu" ? "bg-warning/10 border-warning/30"
    : highlight ? "bg-primary/10 border-primary/30"
    : "bg-muted/40";
  return (
    <div className={`p-3 rounded-lg border ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value.toLocaleString("pt-BR")}{suffix || ""}</div>
    </div>
  );
}
