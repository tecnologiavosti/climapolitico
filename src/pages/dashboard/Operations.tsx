import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, Cpu, Database, RefreshCw, Zap } from "lucide-react";

type Overview = {
  queued: number; leased: number; running: number; failed: number; dead: number;
  succeeded_last_hour: number; active_workers: number; open_alerts: number;
};

export default function Operations() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [stuck, setStuck] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [o, p, w, a, s] = await Promise.all([
      supabase.from("operations_overview").select("*").maybeSingle(),
      supabase.from("provider_health").select("*").order("health_score", { ascending: false }),
      supabase.from("worker_heartbeats").select("*").gte("last_heartbeat_at", new Date(Date.now() - 5 * 60_000).toISOString()).order("last_heartbeat_at", { ascending: false }),
      supabase.from("system_alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(20),
      supabase.from("analysis_jobs").select("id,job_type,attempts,last_error,leased_at,worker_id").eq("status", "leased").lt("lease_expires_at", new Date().toISOString()).limit(10),
    ]);
    setOv(o.data as any);
    setProviders(p.data || []);
    setWorkers(w.data || []);
    setAlerts(a.data || []);
    setStuck(s.data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    // Realtime: invalida ao receber qualquer mudança nas tabelas operacionais
    const ch = supabase
      .channel("ops-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "analysis_jobs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "system_alerts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_heartbeats" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "provider_health" }, () => load())
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, []);

  async function trigger(name: string) {
    await supabase.functions.invoke(name);
    setTimeout(load, 1500);
  }

  const kpis = [
    { label: "Na fila", value: ov?.queued ?? 0, icon: Database, color: "text-blue-500" },
    { label: "Em execução", value: (ov?.leased ?? 0) + (ov?.running ?? 0), icon: Cpu, color: "text-amber-500" },
    { label: "Sucesso (1h)", value: ov?.succeeded_last_hour ?? 0, icon: Zap, color: "text-emerald-500" },
    { label: "Dead-letter", value: ov?.dead ?? 0, icon: AlertTriangle, color: "text-red-500" },
    { label: "Workers ativos", value: ov?.active_workers ?? 0, icon: Activity, color: "text-violet-500" },
    { label: "Alertas abertos", value: ov?.open_alerts ?? 0, icon: AlertTriangle, color: "text-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Operations Console</h1>
          <p className="text-sm text-muted-foreground">Filas, workers, providers e alertas em tempo real</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => trigger("queue-scheduler")}>Trigger Scheduler</Button>
          <Button size="sm" variant="secondary" onClick={() => trigger("sentiment-worker")}>Run Worker</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{k.label}</span>
                <k.icon className={`h-4 w-4 ${k.color}`} />
              </div>
              <div className="text-2xl font-bold mt-2">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Providers IA (circuit breaker)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {providers.map((p) => (
              <div key={p.provider} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div>
                  <div className="font-medium capitalize">{p.provider}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.total_calls} chamadas · {p.total_failures} falhas · {Math.round(p.avg_latency_ms)}ms
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.state === "open" ? "destructive" : p.state === "half_open" ? "secondary" : "default"}>
                    {p.state}
                  </Badge>
                  <span className="text-sm font-mono">{p.health_score}</span>
                </div>
              </div>
            ))}
            {providers.length === 0 && <p className="text-sm text-muted-foreground">Sem dados ainda.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Workers ativos (últimos 5min)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {workers.map((w) => (
              <div key={w.worker_id} className="flex items-center justify-between border-b pb-2 last:border-0 text-sm">
                <div>
                  <div className="font-mono text-xs">{w.worker_id}</div>
                  <div className="text-xs text-muted-foreground">{w.worker_type} · {w.jobs_processed} ok / {w.jobs_failed} fail</div>
                </div>
                <Badge variant="outline">{new Date(w.last_heartbeat_at).toLocaleTimeString()}</Badge>
              </div>
            ))}
            {workers.length === 0 && <p className="text-sm text-muted-foreground">Nenhum worker ativo.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Alertas abertos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="border-l-2 pl-3 py-1" style={{ borderColor: a.severity === "critical" || a.severity === "error" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}>
                <div className="flex items-center gap-2">
                  <Badge variant={a.severity === "error" || a.severity === "critical" ? "destructive" : "secondary"}>{a.severity}</Badge>
                  <span className="text-sm font-medium">{a.title}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{a.message}</p>
              </div>
            ))}
            {alerts.length === 0 && <p className="text-sm text-muted-foreground">Sem alertas abertos. ✅</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Jobs travados (lease expirado)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {stuck.map((j) => (
              <div key={j.id} className="text-xs border-b pb-2 last:border-0">
                <div className="font-mono">{j.id.slice(0, 8)} · {j.job_type} · {j.attempts}x</div>
                <div className="text-muted-foreground truncate">{j.last_error || "(sem erro)"}</div>
              </div>
            ))}
            {stuck.length === 0 && <p className="text-sm text-muted-foreground">Nenhum job travado.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
