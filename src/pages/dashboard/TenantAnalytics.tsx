import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Loader2, Building2 } from "lucide-react";

interface Tenant {
  user_id: string;
  full_name: string | null;
  tier: string | null;
  total_events: number;
  total_cost: number;
  ai_analyses: number;
  exports: number;
  last_active: string | null;
}

export default function TenantAnalyticsPage() {
  const { isAdmin, isLoading: adminLoading } = useAdminCheck();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_tenant_analytics" as any, { _days: days, _limit: 100 });
    if (!error) setRows((data as any) || []);
    setLoading(false);
  }, [days]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (adminLoading) return <div className="p-6"><Loader2 className="animate-spin" /></div>;
  if (!isAdmin) return <div className="p-6 text-muted-foreground">Acesso restrito a administradores.</div>;

  const totalUsers = rows.length;
  const totalEvents = rows.reduce((s, r) => s + Number(r.total_events || 0), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.total_cost || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6" />Tenant Analytics</h1>
          <p className="text-muted-foreground text-sm">Consumo agregado por usuário nos últimos {days} dias.</p>
        </div>
        <select className="bg-background border rounded-md px-3 py-2 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-sm">Usuários ativos</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{totalUsers}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Total de eventos</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{totalEvents.toLocaleString("pt-BR")}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Custo total</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{totalCost.toFixed(2)}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top usuários por consumo</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="animate-spin" /> : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sem dados de consumo no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-4">Usuário</th>
                  <th className="py-2 pr-4">Plano</th>
                  <th className="py-2 pr-4 text-right">Eventos</th>
                  <th className="py-2 pr-4 text-right">Análises IA</th>
                  <th className="py-2 pr-4 text-right">Exportações</th>
                  <th className="py-2 pr-4 text-right">Custo</th>
                  <th className="py-2 pr-4">Última atividade</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id} className="border-b">
                      <td className="py-2 pr-4 truncate max-w-[200px]">{r.full_name || r.user_id.slice(0, 8)}</td>
                      <td className="py-2 pr-4"><Badge variant="secondary">{r.tier ?? "—"}</Badge></td>
                      <td className="py-2 pr-4 text-right font-mono">{Number(r.total_events).toLocaleString("pt-BR")}</td>
                      <td className="py-2 pr-4 text-right font-mono">{Number(r.ai_analyses).toLocaleString("pt-BR")}</td>
                      <td className="py-2 pr-4 text-right font-mono">{Number(r.exports).toLocaleString("pt-BR")}</td>
                      <td className="py-2 pr-4 text-right font-mono">{Number(r.total_cost).toFixed(2)}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {r.last_active ? new Date(r.last_active).toLocaleString("pt-BR") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
