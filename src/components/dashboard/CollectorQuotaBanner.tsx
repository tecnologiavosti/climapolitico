import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PausedCollector {
  collector_name: string;
  paused_until: string;
  daily_calls: number;
  max_daily_calls: number;
}

/**
 * Shows a banner whenever any collector is paused due to quota.
 * Polls every 5 minutes.
 */
export function CollectorQuotaBanner() {
  const { data } = useQuery({
    queryKey: ["paused-collectors"],
    queryFn: async (): Promise<PausedCollector[]> => {
      const { data, error } = await supabase
        .from("collector_quota_state")
        .select("collector_name, paused_until, daily_calls, max_daily_calls")
        .not("paused_until", "is", null)
        .gt("paused_until", new Date().toISOString());
      if (error) throw error;
      return (data as PausedCollector[]) || [];
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  if (!data || data.length === 0) return null;

  return (
    <Alert variant="default" className="border-warning/40 bg-warning/10">
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertTitle>
        {data.length === 1 ? "Coletor pausado" : `${data.length} coletores pausados`}
      </AlertTitle>
      <AlertDescription className="space-y-1 mt-1">
        {data.map((c) => (
          <div key={c.collector_name} className="text-sm">
            <strong>{c.collector_name}</strong> pausado até{" "}
            {format(new Date(c.paused_until), "HH:mm", { locale: ptBR })} — quota diária atingida
            ({Number(c.daily_calls ?? 0).toLocaleString("pt-BR")} / {Number(c.max_daily_calls ?? 0).toLocaleString("pt-BR")}).
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
