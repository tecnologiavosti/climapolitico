import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { toast } from "sonner";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SLORow {
  slo_id: string;
  name: string;
  metric_name: string;
  comparator: string;
  target_value: number;
  current_value: number;
  is_compliant: boolean;
  severity: string;
  window_minutes: number;
  samples: number;
}

interface DLQRow {
  job_type: string;
  dead_count: number;
  oldest: string | null;
  newest: string | null;
}

export default function SLOPage() {
  const { isAdmin, loading: adminLoading } = useAdminCheck();
  const [slos, setSlos] = useState<SLORow[]>([]);
  const [dlq, setDlq] = useState<DLQRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [requeuing, setRequeuing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: sloData, error: sloErr }, { data: dlqData, error: dlqErr }] = await Promise.all([
      supabase.rpc("compute_slo_status" as any),
      supabase.rpc("dlq_summary" as any),
    ]);
    if (sloErr) toast.error("Erro ao carregar SLOs: " + sloErr.message);
    else setSlos((sloData as SLORow[]) || []);
    if (dlqErr) toast.error("Erro ao carregar DLQ: " + dlqErr.message);
    else setDlq((dlqData as DLQRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const requeue = async (jobType: string) => {
    setRequeuing(jobType);
    const { data, error } = await supabase.rpc("requeue_dead_jobs" as any, {
      _job_type: jobType,
      _limit: 500,
    });
    setRequeuing(null);
    if (error) toast.error("Falha ao reprocessar: " + error.message);
    else {
      toast.success(`${data ?? 0} job(s) recolocados na fila`);
      load();
    }
  };

  if (adminLoading) return <div className="p-6"><Loader2 className="animate-spin" /></div>;
  if (!isAdmin) return <div className="p-6 text-muted-foreground">Acesso restrito a administradores.</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SLO &amp; SLA</h1>
          <p className="text-muted-foreground text-sm">Metas de serviço e fila de jobs mortos (DLQ).</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Status dos SLOs</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : slos.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum SLO configurado.</p>
          ) : (
            <div className="space-y-3">
              {slos.map((s) => (
                <div key={s.slo_id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    {s.is_compliant ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    )}
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Métrica: {s.metric_name} · Janela: {s.window_minutes}min · Amostras: {s.samples}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">
                      Atual: <span className="font-mono">{Number(s.current_value).toFixed(2)}</span>
                      {" / "}
                      Meta: <span className="font-mono">{s.comparator === "lte" ? "≤" : "≥"} {s.target_value}</span>
                    </div>
                    <Badge variant={s.is_compliant ? "secondary" : "destructive"} className="mt-1">
                      {s.is_compliant ? "Compliant" : "Violado"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Dead-Letter Queue (DLQ)</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : dlq.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum job morto. ✅</p>
          ) : (
            <div className="space-y-2">
              {dlq.map((d) => (
                <div key={d.job_type} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <div className="font-medium">{d.job_type}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.dead_count} jobs · Mais antigo: {d.oldest ? new Date(d.oldest).toLocaleString("pt-BR") : "-"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => requeue(d.job_type)}
                    disabled={requeuing === d.job_type}
                  >
                    {requeuing === d.job_type ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reprocessar (até 500)"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
