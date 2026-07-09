import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "pending" | "collecting" | "done" | "error";

type Source = {
  key: string;
  label: string;
  /** valor de `collector` aceito pela edge function `orchestrate-all-collectors` */
  collector: string;
};

const SOURCES: Source[] = [
  { key: "telegram", label: "Telegram", collector: "telegram" },
  { key: "gnews", label: "Google News", collector: "google news" },
  { key: "youtube", label: "YouTube", collector: "youtube" },
  { key: "twitter", label: "X (Twitter)", collector: "twitter/x" },
  { key: "facebook", label: "Facebook", collector: "facebook rss" },
  { key: "tiktok", label: "TikTok", collector: "tiktok" },
  { key: "reddit", label: "Reddit", collector: "reddit" },
  { key: "wikipedia", label: "Wikipedia", collector: "wikipedia" },
];

interface Props {
  open: boolean;
  candidateId: string | null;
  candidateName?: string;
  onClose: () => void;
}

export function AutoCollectionOverlay({ open, candidateId, candidateName, onClose }: Props) {
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !candidateId) return;
    // Evita duplicar disparo para o mesmo candidato
    if (startedFor.current === candidateId) return;
    startedFor.current = candidateId;

    const initial: Record<string, Status> = {};
    SOURCES.forEach((s) => (initial[s.key] = "collecting"));
    setStatuses(initial);

    console.log("[Candidato criado] Iniciando coleta automática", { candidateId, candidateName });

    // Dispara todas em paralelo — cada uma isola seu erro.
    const runs = SOURCES.map(async (s) => {
      try {
        const { error } = await supabase.functions.invoke("orchestrate-all-collectors", {
          body: { candidateId, collector: s.collector },
        });
        if (error) throw error;
        setStatuses((prev) => ({ ...prev, [s.key]: "done" }));
        console.log(`[Coleta] ${s.label} OK`);
      } catch (e) {
        console.warn(`[Coleta] ${s.label} falhou`, e);
        setStatuses((prev) => ({ ...prev, [s.key]: "error" }));
      }
    });

    Promise.allSettled(runs).then(async () => {
      console.log("[Coleta] Todas as fontes concluídas — atualizando interface");
      // Refresca dados no cliente
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["candidate-consolidated-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["candidate-rankings"] });
      queryClient.invalidateQueries({ queryKey: ["real-time-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      // Fecha após 2s
      setTimeout(() => {
        onClose();
        startedFor.current = null;
      }, 2000);
    });
  }, [open, candidateId, candidateName, onClose, queryClient]);

  const allDone = SOURCES.every((s) => {
    const st = statuses[s.key];
    return st === "done" || st === "error";
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && allDone) onClose(); }}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {allDone ? "Coleta concluída" : "Coletando dados do candidato..."}
          </DialogTitle>
          <DialogDescription>
            {candidateName ? `Preparando o monitoramento de ${candidateName}.` : "Preparando monitoramento inicial."}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 py-2">
          {SOURCES.map((s) => {
            const st: Status = statuses[s.key] ?? "pending";
            return (
              <li key={s.key} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="font-medium">{s.label}</span>
                <span className={cn(
                  "flex items-center gap-1.5 text-xs",
                  st === "done" && "text-emerald-600 dark:text-emerald-400",
                  st === "error" && "text-destructive",
                  st === "collecting" && "text-amber-600 dark:text-amber-400",
                  st === "pending" && "text-muted-foreground",
                )}>
                  {st === "collecting" && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Coletando...</>}
                  {st === "done" && <><CheckCircle2 className="h-3.5 w-3.5" /> Concluído</>}
                  {st === "error" && <><XCircle className="h-3.5 w-3.5" /> Erro</>}
                  {st === "pending" && "Aguardando"}
                </span>
              </li>
            );
          })}
        </ul>
        {allDone && (
          <p className="text-center text-sm text-muted-foreground">
            Coleta concluída com sucesso. Atualizando interface…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
