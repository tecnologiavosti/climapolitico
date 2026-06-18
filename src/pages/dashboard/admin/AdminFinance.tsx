import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, DollarSign } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const PRICE: Record<string, number> = { free: 0, starter: 19, pro: 49, enterprise: 199, lifetime: 0, basic: 0 };

function Inner() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    user_id: "", amount: 0, status: "paid", method: "manual",
    description: "", tier: "pro", external_reference: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-finance"],
    queryFn: async () => {
      const [subsR, billR, profR] = await Promise.all([
        supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
        supabase.from("billing_history").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("profiles").select("id, full_name, organization"),
      ]);
      if (subsR.error) throw subsR.error;
      const subs = subsR.data ?? [];
      const bills = billR.data ?? [];
      const profiles = profR.data ?? [];
      const profileMap = new Map(profiles.map((p: any) => [p.id, p]));
      const active = subs.filter((s: any) => s.status === "active");
      const mrr = active.reduce((a, s) => a + (PRICE[s.tier] ?? 0), 0);
      const arr = mrr * 12;
      const paid = bills.filter((b: any) => b.status === "paid");
      const revenueTotal = paid.reduce((a, b) => a + Number(b.amount ?? 0), 0);
      const refunded = bills.filter((b: any) => b.status === "refunded").reduce((a, b) => a + Number(b.amount ?? 0), 0);
      const pendingCount = bills.filter((b: any) => b.status === "pending").length;
      const churn = subs.length ? (subs.filter((s: any) => s.status === "cancelled").length / subs.length) * 100 : 0;
      const ltv = active.length ? (revenueTotal / active.length) : 0;
      return { subs, bills, profileMap, mrr, arr, active: active.length, revenueTotal, refunded, pendingCount, churn, ltv };
    },
  });

  const addBill = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("billing_history").insert({
        user_id: form.user_id,
        amount: Number(form.amount),
        status: form.status,
        method: form.method,
        description: form.description,
        tier: form.tier,
        external_reference: form.external_reference || null,
        paid_at: form.status === "paid" ? new Date().toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-finance"] });
      toast({ title: "Registro adicionado" });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "paid") patch.paid_at = new Date().toISOString();
      const { error } = await supabase.from("billing_history").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-finance"] });
      toast({ title: "Status atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="p-6"><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Financeiro</h1>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Registrar pagamento</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat title="MRR" value={`R$ ${data.mrr.toLocaleString("pt-BR")}`} />
        <Stat title="ARR" value={`R$ ${data.arr.toLocaleString("pt-BR")}`} />
        <Stat title="Receita total" value={`R$ ${data.revenueTotal.toLocaleString("pt-BR")}`} />
        <Stat title="Reembolsado" value={`R$ ${data.refunded.toLocaleString("pt-BR")}`} />
        <Stat title="Churn" value={`${data.churn.toFixed(1)}%`} />
        <Stat title="LTV" value={`R$ ${data.ltv.toFixed(2)}`} />
        <Stat title="Assinantes" value={String(data.active)} />
        <Stat title="Inadimplentes" value={String(data.pendingCount)} />
      </div>

      <Card>
        <CardHeader><CardTitle>Histórico de cobranças</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.bills.map((b: any) => {
                const p: any = data.profileMap.get(b.user_id);
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{p?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{b.user_id.slice(0, 8)}…</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{b.tier ?? "—"}</Badge></TableCell>
                    <TableCell>R$ {Number(b.amount).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === "paid" ? "default" : b.status === "refunded" ? "secondary" : b.status === "failed" ? "destructive" : "outline"}>
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{b.method ?? "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(b.paid_at ?? b.created_at).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {b.status !== "paid" && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: b.id, status: "paid" })}>Marcar pago</Button>
                      )}
                      {b.status === "paid" && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: b.id, status: "refunded" })}>Reembolsar</Button>
                      )}
                      {b.status !== "cancelled" && (
                        <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: b.id, status: "cancelled" })}>Cancelar</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {data.bills.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma cobrança registrada ainda.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Assinaturas</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Usuário</TableHead><TableHead>Plano</TableHead><TableHead>Status</TableHead><TableHead>Início</TableHead><TableHead>Fim</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.subs.slice(0, 200).map((s: any) => {
                const p: any = data.profileMap.get(s.user_id);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="text-sm">{p?.full_name ?? "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{s.user_id.slice(0, 8)}…</div>
                    </TableCell>
                    <TableCell><Badge>{s.tier}</Badge></TableCell>
                    <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                    <TableCell className="text-xs">{s.current_period_start ? new Date(s.current_period_start).toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-xs">{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("pt-BR") : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar pagamento manual</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>User ID</Label><Input value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })} placeholder="uuid do usuário" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valor (R$)</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div>
                <Label>Plano</Label>
                <Select value={form.tier} onValueChange={v => setForm({ ...form, tier: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                    <SelectItem value="lifetime">Vitalício</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Pago</SelectItem>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="failed">Falhou</SelectItem>
                    <SelectItem value="refunded">Reembolsado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Método</Label><Input value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} placeholder="pix, boleto, cartão..." /></div>
            </div>
            <div><Label>Referência externa</Label><Input value={form.external_reference} onChange={e => setForm({ ...form, external_reference: e.target.value })} placeholder="ID gateway / nota" /></div>
            <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => addBill.mutate()} disabled={addBill.isPending || !form.user_id || !form.amount}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-1"><DollarSign className="h-3 w-3" /> {title}</CardTitle></CardHeader>
      <CardContent><div className="text-xl font-bold">{value}</div></CardContent>
    </Card>
  );
}

export default function AdminFinance() { return <AdminRoute><Inner /></AdminRoute>; }
