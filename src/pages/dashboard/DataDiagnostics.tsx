import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, AlertTriangle, CheckCircle2 } from "lucide-react";

const fmt = (n: number) => Number(n || 0).toLocaleString("pt-BR");

export default function DataDiagnostics() {
  const { isAdmin } = useAdminCheck();
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["data-consistency-diagnostics", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("data_consistency_diagnostics", { p_days: days, p_candidate_id: null });
      if (error) throw error;
      return data as any;
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });

  if (!isAdmin) {
    return <Card className="p-6 text-sm text-muted-foreground">Acesso restrito a administradores.</Card>;
  }

  const totals = data?.totals ?? {};
  const comparison = data?.comparison ?? {};
  const diff = Number(comparison.daily_vs_raw_mentions_diff_pct ?? 0);
  const ok = diff <= 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Database className="h-8 w-8 text-primary" /> Diagnóstico de Dados</h1>
          <p className="text-muted-foreground mt-1">Auditoria interna de consistência entre dashboards.</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">24 horas</SelectItem>
            <SelectItem value="7">7 dias</SelectItem>
            <SelectItem value="30">30 dias</SelectItem>
            <SelectItem value="90">90 dias</SelectItem>
            <SelectItem value="365">1 ano</SelectItem>
            <SelectItem value="3650">Total</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {ok ? <CheckCircle2 className="h-5 w-5 text-success" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
          <div>
            <div className="font-semibold">Validação de divergência</div>
            <div className="text-sm text-muted-foreground">Diferença agregados × registros: {diff.toFixed(2)}%</div>
          </div>
        </div>
        <Badge variant={ok ? "default" : "destructive"}>{ok ? "Dentro de 1%" : "Divergente"}</Badge>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Total de registros" value={fmt(totals.total_records)} loading={isLoading} />
        <Metric label="Engajamento" value={fmt(totals.total_engagement)} loading={isLoading} />
        <Metric label="Classificados" value={fmt(totals.classified)} loading={isLoading} />
        <Metric label="Descartados" value={fmt(totals.discarded)} loading={isLoading} />
        <Metric label="Duplicados" value={fmt(totals.duplicated)} loading={isLoading} />
        <Metric label="Positivos" value={fmt(totals.positive)} loading={isLoading} />
        <Metric label="Neutros" value={fmt(totals.neutral)} loading={isLoading} />
        <Metric label="Negativos" value={fmt(totals.negative)} loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TableCard title="Registros por fonte" rows={data?.by_source ?? []} columns={["source", "records", "classified", "discarded", "engagement"]} loading={isLoading} />
        <TableCard title="Registros por período" rows={data?.by_period ?? []} columns={["day", "records", "classified", "engagement"]} loading={isLoading} />
        <TableCard title="Hashtags normalizadas" rows={data?.hashtags ?? []} columns={["tag", "records"]} loading={isLoading} />
        <TableCard title="Assuntos dominantes" rows={data?.topics ?? []} columns={["theme", "records"]} loading={isLoading} />
      </div>
    </div>
  );
}

function Metric({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return <Card className="p-4"><div className="text-xs text-muted-foreground">{label}</div>{loading ? <Skeleton className="h-7 w-20 mt-2" /> : <div className="text-2xl font-bold mt-1">{value}</div>}</Card>;
}

function TableCard({ title, rows, columns, loading }: { title: string; rows: any[]; columns: string[]; loading?: boolean }) {
  return (
    <Card className="p-5">
      <h3 className="font-bold mb-3">{title}</h3>
      {loading ? <Skeleton className="h-56 w-full" /> : (
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead><tr>{columns.map((c) => <th key={c} className="text-left py-2 pr-3 text-muted-foreground font-medium">{c}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i} className="border-t border-border">{columns.map((c) => <td key={c} className="py-2 pr-3">{typeof row[c] === "number" ? fmt(row[c]) : row[c]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}