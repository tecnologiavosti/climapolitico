import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/utils/formatters";

type Collector = {
  collector_name: string;
  daily_calls: number;
  daily_errors: number;
  daily_items_collected: number;
  max_daily_calls: number;
  last_call_at: string | null;
  paused_until: string | null;
  notes: string | null;
  success_rate: number | null;
  quota_used_pct: number | null;
  seconds_since_last_call: number | null;
};

type VolumeRow = {
  network: string;
  v_1h: number; v_24h: number; v_7d: number; v_30d: number; v_30d_prev: number;
  last_ingest_at: string | null;
};

type Snapshot = {
  generated_at: string;
  collectors: Collector[];
  volume_by_network: VolumeRow[];
  hourly_by_network: Record<string, { hour: string; count: number }[]>;
  totals: {
    collected_24h: number; collected_7d: number; collected_30d: number;
    collected_30d_prev: number; recovery_pct: number | null;
  };
};

const fmtAgo = (sec: number | null) => {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${Math.round(sec / 86400)} d`;
};

const statusOf = (c: Collector): { label: string; tone: "ok" | "warn" | "fail" | "idle" } => {
  if (c.paused_until && new Date(c.paused_until) > new Date()) return { label: "Pausado", tone: "warn" };
  if (c.daily_calls === 0) return { label: "Sem chamadas", tone: "idle" };
  const errRate = c.daily_errors / Math.max(1, c.daily_calls);
  if (errRate >= 0.5) return { label: "Falhando", tone: "fail" };
  if (errRate >= 0.2) return { label: "Instável", tone: "warn" };
  return { label: "OK", tone: "ok" };
};

export default function CollectorHealth() {
  const { isAdmin } = useAdminCheck();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["collector-health-snapshot"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("collector_health_snapshot");
      if (error) throw error;
      return data as Snapshot;
    },
    enabled: isAdmin,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!isAdmin) {
    return <Card className="p-6 text-sm text-muted-foreground">Acesso restrito a administradores.</Card>;
  }

  const collectors = data?.collectors ?? [];
  const volumes = data?.volume_by_network ?? [];
  const totals = data?.totals;

  const failing = collectors.filter((c) => statusOf(c).tone === "fail").length;
  const unstable = collectors.filter((c) => statusOf(c).tone === "warn").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-8 w-8 text-primary" />
            Saúde dos Coletores
          </h1>
          <p className="text-muted-foreground mt-1">
            Status em tempo real de cada fonte. Atualiza a cada 60 s.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Coletado 24h" value={totals ? formatNumber(totals.collected_24h) : "—"} loading={isLoading} icon={<Zap className="h-4 w-4" />} />
        <KpiCard label="Coletado 7d" value={totals ? formatNumber(totals.collected_7d) : "—"} loading={isLoading} />
        <KpiCard label="Coletado 30d" value={totals ? formatNumber(totals.collected_30d) : "—"} loading={isLoading} />
        <KpiCard
          label="Recuperação vs 30d anteriores"
          value={totals?.recovery_pct != null ? `${totals.recovery_pct}%` : "—"}
          tone={(totals?.recovery_pct ?? 100) < 80 ? "fail" : "ok"}
          loading={isLoading}
        />
        <KpiCard
          label="Coletores com falha"
          value={`${failing} falhando · ${unstable} instáveis`}
          tone={failing > 0 ? "fail" : unstable > 0 ? "warn" : "ok"}
          loading={isLoading}
        />
      </div>

      {/* Collectors table */}
      <Card className="p-5">
        <h3 className="font-bold mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" /> Estado por coletor
        </h3>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 font-medium">Coletor</th>
                  <th className="text-left py-2 pr-3 font-medium">Status</th>
                  <th className="text-right py-2 pr-3 font-medium">Última</th>
                  <th className="text-right py-2 pr-3 font-medium">Chamadas (24h)</th>
                  <th className="text-right py-2 pr-3 font-medium">Erros</th>
                  <th className="text-right py-2 pr-3 font-medium">% Sucesso</th>
                  <th className="text-right py-2 pr-3 font-medium">Itens (24h)</th>
                  <th className="text-right py-2 pr-3 font-medium">Cota</th>
                  <th className="text-left py-2 pr-3 font-medium">Notas</th>
                </tr>
              </thead>
              <tbody>
                {collectors.map((c) => {
                  const s = statusOf(c);
                  return (
                    <tr key={c.collector_name} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-mono text-xs">{c.collector_name}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge tone={s.tone} label={s.label} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {fmtAgo(c.seconds_since_last_call)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(c.daily_calls)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${c.daily_errors > 0 ? "text-red-500" : ""}`}>
                        {formatNumber(c.daily_errors)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {c.success_rate != null ? `${c.success_rate}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">
                        {formatNumber(c.daily_items_collected)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {c.quota_used_pct != null ? `${c.quota_used_pct}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground truncate max-w-[260px]">{c.notes ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Volume by network */}
      <Card className="p-5">
        <h3 className="font-bold mb-3">Volume coletado por rede</h3>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 font-medium">Rede</th>
                  <th className="text-right py-2 pr-3 font-medium">1h</th>
                  <th className="text-right py-2 pr-3 font-medium">24h</th>
                  <th className="text-right py-2 pr-3 font-medium">7d</th>
                  <th className="text-right py-2 pr-3 font-medium">30d</th>
                  <th className="text-right py-2 pr-3 font-medium">30d anteriores</th>
                  <th className="text-right py-2 pr-3 font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {volumes.map((v) => {
                  const delta = v.v_30d_prev > 0 ? ((v.v_30d - v.v_30d_prev) / v.v_30d_prev) * 100 : null;
                  const tone =
                    delta == null ? "text-muted-foreground" :
                    delta <= -30 ? "text-red-500" :
                    delta <= -10 ? "text-amber-500" :
                    "text-emerald-500";
                  return (
                    <tr key={v.network} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{v.network}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(v.v_1h)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(v.v_24h)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(v.v_7d)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">{formatNumber(v.v_30d)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatNumber(v.v_30d_prev)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${tone}`}>
                        {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5 bg-amber-500/5 border-amber-500/30">
        <h3 className="font-bold mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Ações que exigem intervenção fora do código
        </h3>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
          <li><b>YouTube Data API:</b> rotacionar/adicionar chaves em <code>youtube_api_keys</code> ou ampliar quota do projeto Google Cloud.</li>
          <li><b>Apify (Meta/Instagram/LinkedIn):</b> renovar plano ou aumentar limite mensal — "Monthly usage hard limit exceeded".</li>
          <li><b>Reddit Pullpush 429:</b> trocar para Reddit OAuth oficial.</li>
          <li><b>Twitter/Nitter:</b> instâncias caíram; considerar snscrape ou X API oficial.</li>
          <li><b>Brand24 RSS:</b> validar URL/credenciais.</li>
        </ul>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, loading, tone = "ok", icon }: { label: string; value: string; loading?: boolean; tone?: "ok" | "warn" | "fail"; icon?: React.ReactNode }) {
  const toneClass = tone === "fail" ? "text-red-500" : tone === "warn" ? "text-amber-500" : "text-foreground";
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
      {loading ? <Skeleton className="h-7 w-24 mt-2" /> : <div className={`text-xl font-bold mt-1 ${toneClass}`}>{value}</div>}
    </Card>
  );
}

function StatusBadge({ tone, label }: { tone: "ok" | "warn" | "fail" | "idle"; label: string }) {
  const cls =
    tone === "ok" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" :
    tone === "warn" ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
    tone === "fail" ? "bg-red-500/15 text-red-600 border-red-500/30" :
    "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{label}</Badge>;
}
