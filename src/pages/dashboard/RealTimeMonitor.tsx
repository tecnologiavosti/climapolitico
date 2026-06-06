import { useState, useEffect, useRef, lazy, Suspense, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useRealTimeAnalytics, type RealTimeMetrics, type SocialInteraction } from "@/hooks/useRealTimeAnalytics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Radio, Clock, CheckCircle2, TrendingUp, MessageSquare, Smile, Frown, Newspaper, Flame } from "lucide-react";
import { CandidateSelector } from "@/components/dashboard/realtime/CandidateSelector";
import { RealTimeKPIs } from "@/components/dashboard/realtime/RealTimeKPIs";
import { ProcessingStatusCard } from "@/components/dashboard/realtime/ProcessingStatusCard";
import { cn } from "@/lib/utils";

// Lazy: pesados não devem bloquear KPIs
const RealTimeSentimentChart = lazy(() =>
  import("@/components/dashboard/realtime/RealTimeSentimentChart").then(m => ({ default: m.RealTimeSentimentChart }))
);
const RealTimeSentimentGauge = lazy(() =>
  import("@/components/dashboard/realtime/RealTimeSentimentGauge").then(m => ({ default: m.RealTimeSentimentGauge }))
);
const RealTimeCommentsFeed = lazy(() =>
  import("@/components/dashboard/realtime/RealTimeCommentsFeed").then(m => ({ default: m.RealTimeCommentsFeed }))
);

interface Candidate { id: string; full_name: string; }

// ===== Cache local 5 min — abre instantâneo do último snapshot =====
const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheKey = (uid: string, cid: string) => `rt-monitor:${uid}:${cid}`;
interface CachedSnapshot { metrics: RealTimeMetrics; comments: SocialInteraction[]; savedAt: number; }

const readCache = (k: string): CachedSnapshot | null => {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSnapshot;
    return parsed?.metrics ? parsed : null;
  } catch { return null; }
};
const writeCache = (k: string, snap: CachedSnapshot) => {
  try { localStorage.setItem(k, JSON.stringify(snap)); } catch {}
};

const formatRelative = (d: Date) => {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 10) return "agora";
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return d.toLocaleDateString("pt-BR");
};

type SyncState = "idle" | "syncing" | "synced";

interface QuickCardProps { icon: React.ReactNode; label: string; value: string; tone?: string; }
const QuickCard = ({ icon, label, value, tone = "text-foreground" }: QuickCardProps) => (
  <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
    <CardContent className="p-3 flex items-center gap-3">
      <div className="rounded-md bg-muted/60 p-2 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
        <div className={cn("text-lg font-bold tabular-nums truncate", tone)}>{value}</div>
      </div>
    </CardContent>
  </Card>
);

const RealTimeMonitor = () => {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [, force] = useState(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  // ===== Snapshot do cache (alimenta UI instantaneamente) =====
  const [cached, setCached] = useState<CachedSnapshot | null>(null);

  const { metrics: liveMetrics, comments: liveComments, isLoading, error, refreshMetrics } =
    useRealTimeAnalytics(selectedCandidateId ? [selectedCandidateId] : [], 60000);

  // Carrega candidatos
  useEffect(() => {
    const fetchCandidates = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("candidates")
        .select("id, full_name")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("full_name");
      if (data) {
        setCandidates(data);
        if (data.length > 0 && !selectedCandidateId) setSelectedCandidateId(data[0].id);
      }
      setLoadingCandidates(false);
    };
    fetchCandidates();
  }, [user]);

  // Carrega snapshot do cache ao trocar candidato — instantâneo
  useEffect(() => {
    if (!user || !selectedCandidateId) { setCached(null); return; }
    const snap = readCache(cacheKey(user.id, selectedCandidateId));
    setCached(snap);
    if (snap) setLastUpdate(new Date(snap.savedAt));
  }, [user, selectedCandidateId]);

  // Persiste snapshot quando dados frescos chegam
  useEffect(() => {
    if (!user || !selectedCandidateId || !liveMetrics) return;
    const snap: CachedSnapshot = { metrics: liveMetrics, comments: liveComments, savedAt: Date.now() };
    writeCache(cacheKey(user.id, selectedCandidateId), snap);
    setCached(snap);
    setLastUpdate(new Date());
  }, [liveMetrics, liveComments, user, selectedCandidateId]);

  // Tick para atualizar "há X min"
  useEffect(() => {
    tickRef.current = setInterval(() => force(n => n + 1), 30000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  // Dados efetivos: prefere live, cai para cache
  const metrics = liveMetrics ?? cached?.metrics ?? null;
  const comments = liveComments?.length ? liveComments : (cached?.comments ?? []);

  // Status de sincronização (sem "Finalizando..." infinito)
  const cacheAge = lastUpdate ? Date.now() - lastUpdate.getTime() : Infinity;
  const cacheStale = cacheAge > CACHE_TTL_MS;
  const syncState: SyncState = isLoading ? "syncing" : (metrics ? "synced" : "idle");

  const handleRefresh = () => { refreshMetrics(); };
  const selectedCandidate = candidates.find(c => c.id === selectedCandidateId);

  // Quick cards: dados derivados (não bloqueiam)
  const quick = useMemo(() => {
    if (!metrics) return null;
    const today = metrics.sentimentHistory?.[metrics.sentimentHistory.length - 1];
    const mentionsToday = today ? today.positive + today.neutral + today.negative : metrics.totalMentions;
    const topNetwork = metrics.mentionsByNetwork?.[0];
    return {
      mentionsToday,
      positive: metrics.positiveMentions,
      negative: metrics.negativeMentions,
      collected: metrics.totalCollected,
      topic: topNetwork ? topNetwork.network : "—",
    };
  }, [metrics]);

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 mt-0.5">
            <Radio className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Monitor em Tempo Real</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Painel instantâneo de menções, sentimento e engajamento
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-xs">
            {syncState === "syncing" ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                <span className="text-muted-foreground">Atualizando dados...</span>
              </>
            ) : syncState === "synced" ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span className="text-muted-foreground">
                  {lastUpdate ? `Última atualização: ${formatRelative(lastUpdate)}` : "Dados sincronizados"}
                </span>
              </>
            ) : (
              <>
                <Clock className="h-3 w-3" />
                <span className="text-muted-foreground">Aguardando dados</span>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-8 gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Candidate selector */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              EM TEMPO REAL
            </span>
            <span className="text-xs text-muted-foreground hidden sm:inline">Monitorar:</span>
          </div>
          {loadingCandidates ? (
            <div className="h-11 w-full sm:w-[280px] rounded-md bg-muted/40 animate-pulse" />
          ) : (
            <CandidateSelector
              candidates={candidates}
              value={selectedCandidateId}
              onChange={setSelectedCandidateId}
              disabled={false}
            />
          )}
          {selectedCandidate && metrics && (
            <span className="text-xs text-muted-foreground ml-auto">
              <span className="font-semibold text-foreground tabular-nums">{metrics.processedMentions.toLocaleString("pt-BR")}</span>
              {" de "}
              <span className="tabular-nums">{metrics.totalCollected.toLocaleString("pt-BR")}</span>
              {" analisados"}
              {metrics.pendingMentions > 0 && (
                <span className="ml-2 text-amber-500">• {metrics.pendingMentions.toLocaleString("pt-BR")} pendentes</span>
              )}
            </span>
          )}
        </CardContent>
      </Card>

      {!selectedCandidateId ? (
        <Card className="border-border/60 bg-card/60">
          <CardContent className="py-16 text-center">
            <Radio className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <h3 className="text-base font-semibold mb-1">Selecione um candidato</h3>
            <p className="text-sm text-muted-foreground">Escolha um candidato para iniciar o monitoramento</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {error && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
            </Card>
          )}

          {/* Aviso sutil de cache stale — nunca bloqueia */}
          <AnimatePresence>
            {cached && cacheStale && !isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            )}
          </AnimatePresence>

          {/* Cards rápidos — visíveis instantaneamente */}
          {quick ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <QuickCard icon={<TrendingUp className="h-4 w-4 text-primary" />} label="Menções Hoje" value={quick.mentionsToday.toLocaleString("pt-BR")} />
              <QuickCard icon={<Smile className="h-4 w-4 text-emerald-500" />} label="Sentimento +" value={quick.positive.toLocaleString("pt-BR")} tone="text-emerald-500" />
              <QuickCard icon={<Frown className="h-4 w-4 text-red-500" />} label="Sentimento −" value={quick.negative.toLocaleString("pt-BR")} tone="text-red-500" />
              <QuickCard icon={<Newspaper className="h-4 w-4 text-violet-500" />} label="Coletadas" value={quick.collected.toLocaleString("pt-BR")} />
              <QuickCard icon={<Flame className="h-4 w-4 text-amber-500" />} label="Assunto do Momento" value={quick.topic} />
              <QuickCard icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Última Atualização" value={lastUpdate ? formatRelative(lastUpdate) : "—"} />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-lg" />)}
            </div>
          )}

          {/* KPIs */}
          <motion.div
            key={selectedCandidateId + "-kpi"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <RealTimeKPIs metrics={metrics} />
          </motion.div>

          {metrics && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.03 }}
            >
              <ProcessingStatusCard metrics={metrics} />
            </motion.div>
          )}

          {/* Gráficos — não bloqueiam, falhas isoladas */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Suspense fallback={<Skeleton className="lg:col-span-2 h-72 rounded-lg" />}>
              <motion.div
                className="lg:col-span-2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
              >
                {metrics ? <RealTimeSentimentChart metrics={metrics} /> : <Skeleton className="h-72 rounded-lg" />}
              </motion.div>
            </Suspense>
            <Suspense fallback={<Skeleton className="h-72 rounded-lg" />}>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                {metrics ? <RealTimeSentimentGauge metrics={metrics} /> : <Skeleton className="h-72 rounded-lg" />}
              </motion.div>
            </Suspense>
          </div>

          {/* Feed por último */}
          <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
            >
              <RealTimeCommentsFeed comments={comments} isLoading={false} />
            </motion.div>
          </Suspense>
        </>
      )}
    </div>
  );
};

export default RealTimeMonitor;
