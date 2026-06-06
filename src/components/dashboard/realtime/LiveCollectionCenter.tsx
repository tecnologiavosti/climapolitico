import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, TrendingUp, Smile, Frown, Minus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Mantém a mesma interface para compatibilidade com o monitor
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

interface CandidateLite { full_name: string; party?: string | null; }

const PHRASES = [
  "Detectando assuntos emergentes…",
  "Analisando repercussão nacional…",
  "Mapeando veículos de comunicação…",
  "Identificando tendências políticas…",
  "Processando sentimento das publicações…",
  "Cruzando sinais de múltiplas fontes…",
];

const initials = (n: string) =>
  n.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("");

const sentimentVerdict = (p?: number, neu?: number, n?: number) => {
  const P = p ?? 0, N = n ?? 0, U = neu ?? 0;
  if (P + N + U === 0) return { label: "—", icon: <Minus className="h-3.5 w-3.5" />, tone: "text-muted-foreground" };
  if (P > N && P >= U) return { label: "Positivo", icon: <Smile className="h-3.5 w-3.5" />, tone: "text-emerald-500" };
  if (N > P && N >= U) return { label: "Negativo", icon: <Frown className="h-3.5 w-3.5" />, tone: "text-red-500" };
  return { label: "Neutro", icon: <Minus className="h-3.5 w-3.5" />, tone: "text-amber-500" };
};

/** Animação de fundo: pulsos radiais + linhas conectadas (puro SVG/CSS). */
const AmbientBackdrop = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
    {/* Gradient orbs */}
    <motion.div
      className="absolute -top-32 -left-32 h-80 w-80 rounded-full blur-3xl"
      style={{ background: "radial-gradient(circle, hsl(var(--primary)/0.25), transparent 60%)" }}
      animate={{ x: [0, 30, 0], y: [0, 20, 0], scale: [1, 1.1, 1] }}
      transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
    />
    <motion.div
      className="absolute -bottom-40 -right-32 h-96 w-96 rounded-full blur-3xl"
      style={{ background: "radial-gradient(circle, hsl(var(--primary)/0.18), transparent 60%)" }}
      animate={{ x: [0, -25, 0], y: [0, -15, 0], scale: [1, 1.15, 1] }}
      transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 1 }}
    />

    {/* Pulse rings */}
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30"
          style={{ width: 120, height: 120 }}
          animate={{ scale: [1, 3.2], opacity: [0.5, 0] }}
          transition={{ duration: 3.5, repeat: Infinity, delay: i * 1.1, ease: "easeOut" }}
        />
      ))}
    </div>

    {/* Connected dots */}
    <svg className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none">
      <defs>
        <linearGradient id="line-grad" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[
        ["10%", "20%", "50%", "55%"],
        ["50%", "55%", "85%", "30%"],
        ["50%", "55%", "20%", "80%"],
        ["50%", "55%", "75%", "75%"],
      ].map(([x1, y1, x2, y2], i) => (
        <motion.line
          key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="url(#line-grad)" strokeWidth="1"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: [0, 0.8, 0.2] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }}
        />
      ))}
      {[
        ["10%", "20%"], ["85%", "30%"], ["20%", "80%"], ["75%", "75%"],
      ].map(([cx, cy], i) => (
        <motion.circle
          key={i} cx={cx} cy={cy} r="3" fill="hsl(var(--primary))"
          animate={{ scale: [1, 1.6, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </svg>
  </div>
);

export const LiveCollectionCenter = ({
  progress,
  candidate,
}: {
  progress: LiveProgress;
  candidate?: CandidateLite | null;
}) => {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPhraseIdx(i => (i + 1) % PHRASES.length), 2400);
    return () => clearInterval(t);
  }, []);

  const topic = progress.emergingTopics?.[0];
  const verdict = sentimentVerdict(progress.positivePct, progress.neutralPct, progress.negativePct);
  const trendValue =
    (progress.mentionsProcessed ?? 0) > 0
      ? `${(progress.mentionsProcessed ?? 0).toLocaleString("pt-BR")} menções hoje`
      : "Calculando…";

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-card via-card/80 to-primary/5 backdrop-blur-sm">
        <AmbientBackdrop />
        <CardContent className="relative p-8 sm:p-12 flex flex-col items-center text-center space-y-5">
          {/* Avatar + identidade */}
          {candidate && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="relative">
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{ background: "conic-gradient(from 0deg, hsl(var(--primary)), transparent, hsl(var(--primary)))" }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                />
                <div className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-background flex items-center justify-center m-[3px]">
                  <span className="text-2xl sm:text-3xl font-bold tracking-tight">{initials(candidate.full_name)}</span>
                </div>
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-semibold">{candidate.full_name}</h2>
                {candidate.party && (
                  <p className="text-xs text-muted-foreground mt-0.5">{candidate.party}</p>
                )}
              </div>
            </motion.div>
          )}

          {/* Título central */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-2xl sm:text-4xl font-bold tracking-tight max-w-2xl bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent"
          >
            Analisando cenário político em tempo real
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-sm sm:text-base text-muted-foreground max-w-xl"
          >
            A IA está identificando tendências, repercussões e movimentos relevantes.
          </motion.p>

          {/* Frase rotativa */}
          <div className="h-6 flex items-center">
            <AnimatePresence mode="wait">
              <motion.span
                key={phraseIdx}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="inline-flex items-center gap-2 text-xs sm:text-sm text-primary/90"
              >
                <Sparkles className="h-3.5 w-3.5" />{PHRASES[phraseIdx]}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* Preview ao vivo: 3 elementos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full max-w-2xl pt-2">
            <PreviewPill
              icon={<Flame className="h-3.5 w-3.5 text-amber-500" />}
              label="Assunto do momento"
              value={topic ?? "Identificando…"}
              loading={!topic}
            />
            <PreviewPill
              icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}
              label="Tendência atual"
              value={trendValue}
              loading={!progress.mentionsProcessed}
            />
            <PreviewPill
              icon={<span className={verdict.tone}>{verdict.icon}</span>}
              label="Sentimento predominante"
              value={verdict.label}
              loading={verdict.label === "—"}
            />
          </div>
        </CardContent>
      </Card>

      {/* Skeleton elegante dos gráficos */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-6 w-32 rounded-full" />
          </div>
          <Skeleton className="h-56 w-full rounded-lg" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <Card key={i} className="border-border/60 bg-card/60 backdrop-blur-sm">
            <CardContent className="p-5 space-y-2.5">
              <Skeleton className="h-4 w-40" />
              {[0, 1, 2, 3].map(j => <Skeleton key={j} className="h-6 w-full" />)}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

const PreviewPill = ({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value: string; loading?: boolean; }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
    className="rounded-xl border border-border/60 bg-background/40 backdrop-blur px-3 py-2.5"
  >
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
      {icon}<span className="truncate">{label}</span>
    </div>
    <div className={cn("mt-1 text-sm font-semibold truncate", loading && "text-muted-foreground/70")}>
      {value}
    </div>
  </motion.div>
);
