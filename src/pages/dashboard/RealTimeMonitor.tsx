import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useRealTimeAnalytics } from "@/hooks/useRealTimeAnalytics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Radio, Clock, Check, Loader2 } from "lucide-react";
import { CandidateSelector } from "@/components/dashboard/realtime/CandidateSelector";
import { RealTimeKPIs } from "@/components/dashboard/realtime/RealTimeKPIs";
import { RealTimeSentimentChart } from "@/components/dashboard/realtime/RealTimeSentimentChart";
import { RealTimeSentimentGauge } from "@/components/dashboard/realtime/RealTimeSentimentGauge";
import { RealTimeCommentsFeed } from "@/components/dashboard/realtime/RealTimeCommentsFeed";
import { ProcessingStatusCard } from "@/components/dashboard/realtime/ProcessingStatusCard";
import { cn } from "@/lib/utils";

const LOADING_STEPS = [
  { label: "Coleta de notícias", threshold: 15 },
  { label: "Coleta de redes sociais", threshold: 35 },
  { label: "Análise de sentimento", threshold: 55 },
  { label: "Processamento de entidades", threshold: 72 },
  { label: "Cálculo de métricas", threshold: 88 },
  { label: "Finalização", threshold: 98 },
];

interface Candidate {
  id: string;
  full_name: string;
}

const RealTimeMonitor = () => {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStart, setLoadingStart] = useState<number | null>(null);
  const progressTimer = useRef<NodeJS.Timeout | null>(null);

  const { metrics, comments, isLoading, error, refreshMetrics } = useRealTimeAnalytics(
    selectedCandidateId ? [selectedCandidateId] : [],
    60000
  );

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

  // Realistic progress while loading
  useEffect(() => {
    if (isLoading) {
      setLoadingProgress(8);
      setLoadingStart(Date.now());
      progressTimer.current && clearInterval(progressTimer.current);
      progressTimer.current = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 92) return prev;
          const step = prev < 40 ? 6 : prev < 70 ? 3 : 1;
          return Math.min(92, prev + step);
        });
      }, 350);
    } else {
      progressTimer.current && clearInterval(progressTimer.current);
      if (loadingProgress > 0) {
        setLoadingProgress(100);
        setTimeout(() => { setLoadingProgress(0); setLoadingStart(null); }, 600);
      }
      if (metrics) setLastUpdate(new Date());
    }
    return () => { progressTimer.current && clearInterval(progressTimer.current); };
  }, [isLoading, metrics]);

  // Etapa atual + ETA
  const currentStepIdx = LOADING_STEPS.findIndex(s => loadingProgress < s.threshold);
  const currentStep = currentStepIdx >= 0 ? LOADING_STEPS[currentStepIdx] : LOADING_STEPS[LOADING_STEPS.length - 1];
  const etaSeconds = (() => {
    if (!loadingStart || loadingProgress <= 5 || loadingProgress >= 100) return null;
    const elapsed = (Date.now() - loadingStart) / 1000;
    const rate = loadingProgress / elapsed; // % per sec
    if (rate <= 0) return null;
    return Math.max(1, Math.round((100 - loadingProgress) / rate));
  })();


  const handleRefresh = async () => {
    await refreshMetrics();
  };

  const selectedCandidate = candidates.find(c => c.id === selectedCandidateId);
  const showLoading = isLoading && !metrics;

  return (
    <div className="space-y-5 pb-8">
      {/* Top progress bar */}
      <AnimatePresence>
        {loadingProgress > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 right-0 z-50"
          >
            <Progress value={loadingProgress} className="h-0.5 rounded-none bg-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 mt-0.5">
            <Radio className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Monitor de Comentários</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Acompanhe menções, engajamento e sentimentos em tempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Atualizado às {lastUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
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

      {/* Candidate selector bar */}
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
              disabled={isLoading}
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

          {/* Loading status banner */}
          {showLoading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card className="border-border/60 bg-card/60">
                <CardContent className="py-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Carregando dados em tempo real...
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">{loadingProgress}%</span>
                  </div>
                  <Progress value={loadingProgress} className="h-1.5" />
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* KPIs */}
          <motion.div
            key={selectedCandidateId + "-kpi"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <RealTimeKPIs metrics={metrics} />
          </motion.div>

          {/* Status do processamento */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.03 }}
          >
            <ProcessingStatusCard metrics={metrics} />
          </motion.div>

          {/* Chart + Gauge */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <motion.div
              className="lg:col-span-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
            >
              <RealTimeSentimentChart metrics={metrics} />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <RealTimeSentimentGauge metrics={metrics} />
            </motion.div>
          </div>

          {/* Feed full width */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
          >
            <RealTimeCommentsFeed comments={comments} isLoading={showLoading} />
          </motion.div>
        </>
      )}
    </div>
  );
};

export default RealTimeMonitor;
