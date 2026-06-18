import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAdminAudit } from "@/hooks/useAdminAudit";

function Inner() {
  const qc = useQueryClient();
  const audit = useAdminAudit();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-subscriptions", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("subscriptions")
        .select("id, user_id, tier, status, current_period_start, current_period_end, cancelled_at, max_candidates, max_updates_per_month")
        .order("current_period_end", { ascending: false })
        .limit(500);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data: subs, error } = await q;
      if (error) throw error;

      const ids = (subs ?? []).map((s) => s.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      return (subs ?? []).map((s) => ({ ...s, profile: pmap.get(s.user_id) }));
    },
  });

  const filtered = (data ?? []).filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.profile?.email?.toLowerCase().includes(q) ||
      s.profile?.full_name?.toLowerCase().includes(q) ||
      s.tier?.toLowerCase().includes(q)
    );
  });

  async function updateSub(id: string, patch: any, action: string) {
    const { error } = await supabase.from("subscriptions").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Assinatura atualizada");
    await audit(action, { subscription_id: id, ...patch });
    qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
  }

  async function extend(s: any, months: number) {
    const base = new Date(s.current_period_end ?? Date.now());
    base.setMonth(base.getMonth() + months);
    await updateSub(s.id, { current_period_end: base.toISOString(), status: "active", cancelled_at: null }, "subscription_extended");
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-3xl font-bold">Assinaturas</h1>
        <p className="text-muted-foreground">Gerencie todas as assinaturas da plataforma.</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input placeholder="Buscar por email, nome ou plano…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="active">Ativas</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="cancelled">Canceladas</SelectItem>
            <SelectItem value="expired">Vencidas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle>{filtered.length} assinaturas</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-64" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.profile?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{s.profile?.email ?? s.user_id.slice(0, 8)}</div>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{s.tier}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : s.status === "cancelled" ? "destructive" : "outline"}>
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => extend(s, 1)}>+1 mês</Button>
                      <Button size="sm" variant="outline" onClick={() => extend(s, 12)}>+1 ano</Button>
                      {s.status !== "cancelled" ? (
                        <Button size="sm" variant="destructive" onClick={() => updateSub(s.id, { status: "cancelled", cancelled_at: new Date().toISOString() }, "subscription_cancelled")}>
                          Cancelar
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => updateSub(s.id, { status: "active", cancelled_at: null }, "subscription_reactivated")}>
                          Reativar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma assinatura encontrada.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSubscriptions() { return <AdminRoute><Inner /></AdminRoute>; }
