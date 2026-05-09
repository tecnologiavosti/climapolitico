import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Activity, AlertTriangle, CheckCircle2, Clock, Database, Loader2, RefreshCw, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";

interface OverviewRow {
  unlabeled_count: number;
  total_interactions: number;
  low_confidence_neutrals: number;
  dlq_pending: number;
  unread_notifications: number;
  avg_duration_ms_1h: number | null;
  errors_1h: number;
  calls_1h: number;
}

export default function Observability() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const overview = useQuery({
    queryKey: ["observability_overview"],
    queryFn: async (): Promise<OverviewRow | null> => {
      const { data, error } = await (supabase as any).from("observability_overview").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  const recentLogs = useQuery({
    queryKey: ["recent_edge_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("edge_function_logs")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });

  const dlq = useQuery({
    queryKey: ["dlq_recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("failed_analyses")
        .select("id, last_error, attempts, last_failed_at, comment_text, provider_used")
        .is("resolved_at", null)
        .order("last_failed_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const o = overview.data;
  const pctUnlabeled = o && o.total_interactions
    ? ((o.unlabeled_count / o.total_interactions) * 100).toFixed(1)
    : "0";
  const errorRate = o && o.calls_1h
    ? ((o.errors_1h / o.calls_1h) * 100).toFixed(1)
    : "0";

  const runBackfill = async (mode: "nulls" | "low_confidence") => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-backfill-sentiment", {
        body: { mode, limit: 300 },
      });
      if (error) throw error;
      toast({
        title: "Bulk processing executado",
        description: `Processados: ${data?.processed ?? 0} | Falhas: ${data?.failed ?? 0}`,
      });
      overview.refetch();
      recentLogs.refetch();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Observabilidade
          </h1>
          <p className="text-sm text-muted-foreground">Saúde da plataforma, filas e jobs.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { overview.refetch(); recentLogs.refetch(); dlq.refetch(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
          <Button size="sm" onClick={() => runBackfill("nulls")} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
            Processar nulos agora
          </Button>
          <Button size="sm" variant="secondary" onClick={() => runBackfill("low_confidence")} disabled={running}>
            Reanalisar neutros
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPI title="% sem rótulo" value={`${pctUnlabeled}%`} hint={`${o?.unlabeled_count ?? "—"} de ${o?.total_interactions ?? "—"}`}
          intent={Number(pctUnlabeled) > 5 ? "danger" : "ok"} icon={<Database className="h-4 w-4" />} />
        <KPI title="Neutros baixa confiança" value={`${o?.low_confidence_neutrals ?? "—"}`} hint="Pendentes de reanálise"
          intent={(o?.low_confidence_neutrals ?? 0) > 1000 ? "warn" : "ok"} icon={<AlertTriangle className="h-4 w-4" />} />
        <KPI title="DLQ pendente" value={`${o?.dlq_pending ?? "—"}`} hint="Análises falhadas não resolvidas"
          intent={(o?.dlq_pending ?? 0) > 100 ? "warn" : "ok"} icon={<AlertTriangle className="h-4 w-4" />} />
        <KPI title="Taxa de erro 1h" value={`${errorRate}%`} hint={`${o?.errors_1h ?? 0}/${o?.calls_1h ?? 0} chamadas`}
          intent={Number(errorRate) > 5 ? "danger" : "ok"} icon={<Activity className="h-4 w-4" />} />
        <KPI title="Tempo médio 1h" value={`${o?.avg_duration_ms_1h ?? "—"} ms`} hint="Edge functions"
          intent="ok" icon={<Clock className="h-4 w-4" />} />
        <KPI title="Notificações não lidas" value={`${o?.unread_notifications ?? "—"}`} hint="Cleanup automático diário 03:00"
          intent="ok" icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Logs recentes (edge functions)</CardTitle></CardHeader>
          <CardContent>
            {recentLogs.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : recentLogs.data?.length ? (
              <div className="space-y-2 max-h-96 overflow-auto">
                {recentLogs.data.map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 text-sm border-b pb-1">
                    <span className="truncate font-mono">{l.function_name}</span>
                    <Badge variant={l.status === "ok" ? "secondary" : "destructive"}>{l.status}</Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {l.duration_ms ?? 0}ms · {formatDistanceToNow(new Date(l.executed_at), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">Sem atividade na última hora.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Dead Letter Queue (últimas falhas)</CardTitle></CardHeader>
          <CardContent>
            {dlq.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : dlq.data?.length ? (
              <div className="space-y-2 max-h-96 overflow-auto">
                {dlq.data.map((d: any) => (
                  <div key={d.id} className="text-sm border-b pb-2">
                    <div className="flex justify-between">
                      <Badge variant="outline">{d.attempts} tentativas</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(d.last_failed_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                    <p className="text-xs text-destructive mt-1 truncate">{d.last_error}</p>
                    <p className="text-xs text-muted-foreground truncate">{d.comment_text?.slice(0, 80)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma falha pendente. ✨</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPI({ title, value, hint, intent, icon }: {
  title: string; value: string; hint: string;
  intent: "ok" | "warn" | "danger"; icon: React.ReactNode;
}) {
  const color = intent === "danger" ? "text-destructive" : intent === "warn" ? "text-amber-500" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="flex items-center gap-1">{icon}{title}</span>
        </div>
        <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}
