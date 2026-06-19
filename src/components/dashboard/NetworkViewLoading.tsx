import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Loader2, Circle, Sparkles } from "lucide-react";

interface Props {
  candidateName?: string;
  networkLabel?: string;
  periodLabel?: string;
}

const STEPS = [
  "Coletando posts públicos",
  "Extraindo comentários",
  "Agrupando narrativas",
  "Analisando sentimento",
  "Gerando resumo IA",
];

const ROTATING = [
  "Mapeando menções…",
  "Analisando comentários…",
  "Detectando polarização…",
  "Encontrando padrões virais…",
  "Gerando insights…",
];

export default function NetworkViewLoading({ candidateName, networkLabel, periodLabel }: Props) {
  const [progress, setProgress] = useState(6);
  const [msgIndex, setMsgIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setProgress((p) => (p >= 94 ? 94 : p + Math.max(1, Math.round((96 - p) / 22))));
      setElapsed((e) => e + 1);
    }, 700);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setMsgIndex((i) => (i + 1) % ROTATING.length), 2000);
    return () => clearInterval(t);
  }, []);

  const activeStep = Math.min(STEPS.length - 1, Math.floor((progress / 100) * STEPS.length));
  const eta = Math.max(3, Math.round(((100 - progress) / 100) * 30));

  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden p-6 md:p-8 border-primary/30 bg-gradient-to-br from-card via-card to-primary/5">
        <BackgroundFx />

        <div className="relative space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary/80">
                <Sparkles className="h-3.5 w-3.5" />
                Social listening em execução
              </div>
              <h2 className="text-xl md:text-2xl font-bold">
                Analisando presença digital{candidateName ? ` de ${candidateName}` : ""}
              </h2>
              <p className="text-sm text-muted-foreground">
                {networkLabel ?? "Todas as redes"} · {periodLabel ?? "Período selecionado"}
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tabular-nums text-primary">{progress}%</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                ~{eta}s restantes
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <AnimatePresence mode="wait">
              <motion.p
                key={msgIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.35 }}
                className="text-sm text-muted-foreground"
              >
                {ROTATING[msgIndex]}
              </motion.p>
            </AnimatePresence>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {STEPS.map((label, i) => {
              const state = i < activeStep ? "done" : i === activeStep ? "active" : "pending";
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                    state === "done"
                      ? "border-success/40 bg-success/5 text-success"
                      : state === "active"
                      ? "border-primary/40 bg-primary/5 text-primary"
                      : "border-border bg-muted/20 text-muted-foreground"
                  }`}
                >
                  {state === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : state === "active" ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{label}</span>
                </li>
              );
            })}
          </ul>

          <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80">
            Tempo decorrido: {elapsed}s
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function BackgroundFx() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl animate-pulse" />
      <div
        className="absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-accent/10 blur-3xl animate-pulse"
        style={{ animationDelay: "1.2s" }}
      />
      {[...Array(8)].map((_, i) => (
        <motion.span
          key={i}
          className="absolute h-1.5 w-1.5 rounded-full bg-primary/40"
          style={{ top: `${(i * 37) % 100}%`, left: `${(i * 53) % 100}%` }}
          animate={{ y: [0, -12, 0], opacity: [0.2, 0.8, 0.2] }}
          transition={{ duration: 3 + (i % 3), repeat: Infinity, delay: i * 0.25 }}
        />
      ))}
    </div>
  );
}
