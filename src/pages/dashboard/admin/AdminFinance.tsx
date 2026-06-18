import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

const PRICE: Record<string, number> = { pro: 49, enterprise: 199, lifetime: 0, free: 0, trial: 0 };

function Inner() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-finance"],
    queryFn: async () => {
      const { data: subs, error } = await supabase
        .from("subscriptions")
        .select("id, user_id, tier, status, current_period_start, current_period_end, cancelled_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const active = (subs ?? []).filter(s => s.status === "active");
      const mrr = active.reduce((a, s) => a + (PRICE[s.tier] ?? 0), 0);
      const arr = mrr * 12;
      return { subs: subs ?? [], mrr, arr, active: active.length };
    },
  });

  if (isLoading || !data) return <div className="p-6"><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-3xl font-bold">Financeiro</h1>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Modo visualização</AlertTitle>
        <AlertDescription>
          Reembolsos e cancelamentos reais exigem integração com gateway (Stripe/Chargebee). Por ora, mostramos métricas baseadas em assinaturas internas.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">MRR</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">R$ {data.mrr.toLocaleString("pt-BR")}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">ARR</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">R$ {data.arr.toLocaleString("pt-BR")}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Assinantes ativos</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{data.active}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Ticket médio</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">R$ {data.active ? (data.mrr / data.active).toFixed(2) : "0"}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Assinaturas</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Usuário</TableHead><TableHead>Plano</TableHead><TableHead>Status</TableHead><TableHead>Início</TableHead><TableHead>Fim</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.subs.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.user_id.slice(0, 8)}…</TableCell>
                  <TableCell><Badge>{s.tier}</Badge></TableCell>
                  <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                  <TableCell className="text-xs">{s.current_period_start ? new Date(s.current_period_start).toLocaleDateString("pt-BR") : "—"}</TableCell>
                  <TableCell className="text-xs">{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("pt-BR") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminFinance() { return <AdminRoute><Inner /></AdminRoute>; }
