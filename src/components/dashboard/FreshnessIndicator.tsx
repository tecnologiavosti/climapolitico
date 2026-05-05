import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  /** ISO timestamp of last calculation. */
  lastCalculatedAt?: string | null;
  /** Candidate id for manual recalc. */
  candidateId?: string;
  /** Hide the recalc button (e.g. on aggregate KPIs). */
  hideRecalc?: boolean;
}

/**
 * Tiny "Atualizado há X min" pill below KPI cards.
 * Color tier: gray <30min · orange 30min–2h · red >2h.
 */
export function FreshnessIndicator({ lastCalculatedAt, candidateId, hideRecalc }: Props) {
  const [recalc, setRecalc] = useState(false);

  if (!lastCalculatedAt) {
    return (
      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <Clock className="h-3 w-3" /> Sem dados
      </span>
    );
  }

  const minutesAgo = (Date.now() - new Date(lastCalculatedAt).getTime()) / 60000;
  const tier = minutesAgo > 120 ? "stale" : minutesAgo > 30 ? "old" : "fresh";

  const colorMap = {
    fresh: "text-muted-foreground",
    old: "text-warning",
    stale: "text-destructive",
  } as const;

  const handleRecalc = async () => {
    if (!candidateId) return;
    setRecalc(true);
    const t = toast.loading("Recalculando métricas...");
    try {
      const { error } = await supabase.functions.invoke("recalculate-candidate-metrics", {
        body: { candidateId },
      });
      if (error) throw error;
      toast.dismiss(t);
      toast.success("Métricas recalculadas");
    } catch (e: unknown) {
      toast.dismiss(t);
      toast.error(`Falha ao recalcular: ${(e as Error).message}`);
    } finally {
      setRecalc(false);
    }
  };

  return (
    <div className={`text-[11px] inline-flex items-center gap-1 ${colorMap[tier]}`}>
      {tier === "fresh" ? <Clock className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      <span>
        {tier === "stale" ? "Dados desatualizados — " : "Atualizado "}
        {formatDistanceToNow(new Date(lastCalculatedAt), { addSuffix: true, locale: ptBR })}
      </span>
      {!hideRecalc && tier !== "fresh" && candidateId && (
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1 text-[11px]"
          onClick={handleRecalc}
          disabled={recalc}
          aria-label="Recalcular métricas"
        >
          <RefreshCw className={`h-3 w-3 ${recalc ? "animate-spin" : ""}`} />
        </Button>
      )}
    </div>
  );
}
