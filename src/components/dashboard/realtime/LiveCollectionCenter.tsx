import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useCountUp } from "@/hooks/useCountUp";
import {
  Newspaper, Smartphone, Video, MessageSquare, BarChart3, Bot,
  CheckCircle2, Loader2, Sparkles, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface LiveProgress {
  news?: number;
  posts?: number;
  videos?: number;
  comments?: number;
  mentionsProcessed?: number;
  sentimentClassified?: number;
  positivePct?: number;
  neutralPct?: number;
  negativePct?: number;
  emergingTopics?: string[];
  steps: {
    collectNews: boolean;
    collectSocial: boolean;
    processAI: boolean;
    classifySentiment: boolean;
    buildCharts: boolean;
  };
}

const DYNAMIC_MESSAGES = [
  "Detectando assuntos do momento…",
  "Identificando tendências políticas…",
  "Analisando repercussão nacional…",
  "Calculando sentimento das publicações…",
  "Mapeando influenciadores políticos…",
  "Cruzando dados de múltiplas fontes…",
  "Avaliando picos de engajamento…",
];

const FEED_ITEMS = [
  "Coletando notícias do Google News",
  "Coletando vídeos do YouTube",
  "Analisando publicações do TikTok",
  "Processando sentimento",
  "Calculando tendências",
  "Detectando assuntos emergentes",
  "Mapeando menções no Instagram",
  "Indexando posts do X (Twitter)",
];

const Counter = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string; }) => {
  const v = useCountUp(value, 600);
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 backdrop-blur-sm p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        <span className={color}>{icon}</span><span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">{v.toLocaleString("pt-BR")}</div>
    </div>
  );
};

const STEPS: { key: keyof LiveProgress["steps"]; label: string }[] = [
  { key: "collectNews", label: "Coleta de notícias" },
  { key: "collectSocial", label: "Coleta de redes sociais" },
  { key: "processAI", label: "Processamento IA" },
  { key: "classifySentiment", label: "Classificação de sentimento" },
  { key: "buildCharts", label: "Construção dos gráficos" },
];

export const LiveCollectionCenter = ({ progress }: { progress: LiveProgress }) => {
  const [msgIdx, setMsgIdx] = useState(0);
  const [feedIdx, setFeedIdx] = useState(0);
  const [feed, setFeed] = useState<{ text: string; ts: number }[]>([]);

  useEffect(() => {
    const t = setInterval(() => setMsgIdx(i => (i + 1) % DYNAMIC_MESSAGES.length), 2200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setFeedIdx(i => {
        const next = (i + 1) % FEED_ITEMS.length;
        setFeed(prev => [{ text: FEED_ITEMS[next], ts: Date.now() }, ...prev].slice(0, 6));
        return next;
      });
    }, 900);
    return () => clearInterval(t);
  }, []);

  // Inicializa feed com algumas linhas
  useEffect(() => {
    setFeed(FEED_ITEMS.slice(0, 3).map((text, i) => ({ text, ts: Date.now() - i * 500 })));
  }, []);

  const completedSteps = useMemo(
    () => STEPS.filter(s => progress.steps[s.key]).length,
    [progress.steps]
  );
  const totalSteps = STEPS.length;
  const pct = Math.round((completedSteps / totalSteps) * 100);

  const pos = progress.positivePct ?? 0;
  const neu = progress.neutralPct ?? 0;
  const neg = progress.negativePct ?? 0;

  return (
    <Card className="border-border/60 bg-gradient-to-br from-primary/5 via-card/60 to-transparent backdrop-blur-sm overflow-hidden">
      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* Mensagem dinâmica + progresso global */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Activity className="h-4 w-4 text-primary" />
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <AnimatePresence mode="wait">
              <motion.span
                key={msgIdx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="text-sm font-medium"
              >
                {DYNAMIC_MESSAGES[msgIdx]}
              </motion.span>
            </AnimatePresence>
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>

        {/* Contadores em tempo real */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Counter icon={<Newspaper className="h-3.5 w-3.5" />} label="Notícias" value={progress.news ?? 0} color="text-violet-500" />
          <Counter icon={<Smartphone className="h-3.5 w-3.5" />} label="Posts" value={progress.posts ?? 0} color="text-primary" />
          <Counter icon={<Video className="h-3.5 w-3.5" />} label="Vídeos" value={progress.videos ?? 0} color="text-rose-500" />
          <Counter icon={<MessageSquare className="h-3.5 w-3.5" />} label="Comentários" value={progress.comments ?? 0} color="text-sky-500" />
          <Counter icon={<BarChart3 className="h-3.5 w-3.5" />} label="Menções proc." value={progress.mentionsProcessed ?? 0} color="text-emerald-500" />
          <Counter icon={<Bot className="h-3.5 w-3.5" />} label="Sentim. class." value={progress.sentimentClassified ?? 0} color="text-amber-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Etapas */}
          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Etapas</div>
            <ul className="space-y-1.5">
              {STEPS.map(s => {
                const done = progress.steps[s.key];
                return (
                  <li key={s.key} className="flex items-center gap-2 text-xs">
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
                    )}
                    <span className={cn(done ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Feed atividade */}
          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Atividade</div>
            <ul className="space-y-1">
              <AnimatePresence initial={false}>
                {feed.map((f, i) => (
                  <motion.li
                    key={f.ts}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1 - i * 0.12, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex items-center gap-2 text-xs"
                  >
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="truncate">{f.text}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>

          {/* Sentimento parcial + topics */}
          <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Sentimento parcial</div>
              {(pos + neu + neg) === 0 ? (
                <p className="text-xs text-muted-foreground">Aguardando classificação…</p>
              ) : (
                <>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${pos}%` }} className="h-full bg-emerald-500" />
                    <motion.div initial={{ width: 0 }} animate={{ width: `${neu}%` }} className="h-full bg-amber-500" />
                    <motion.div initial={{ width: 0 }} animate={{ width: `${neg}%` }} className="h-full bg-red-500" />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[10px] tabular-nums">
                    <span className="text-emerald-500">Positivo {pos}%</span>
                    <span className="text-amber-500">Neutro {neu}%</span>
                    <span className="text-red-500">Negativo {neg}%</span>
                  </div>
                </>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-primary" />Assuntos emergentes
              </div>
              {progress.emergingTopics && progress.emergingTopics.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {progress.emergingTopics.slice(0, 6).map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{t}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Identificando…</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
