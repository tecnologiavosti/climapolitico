import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: any;
}

export function UserEditDialog({ open, onOpenChange, user }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (user) {
      setForm({
        full_name: user.full_name ?? "",
        organization: user.organization ?? "",
        phone: user.phone ?? "",
        role_title: user.role_title ?? "",
        admin_notes: user.admin_notes ?? "",
        party: user.party ?? "",
        tier: user.subscription?.tier ?? "free",
        status: user.subscription?.status ?? "active",
        max_candidates: user.subscription?.max_candidates ?? 1,
        max_updates_per_month: user.subscription?.max_updates_per_month ?? 10,
        current_period_end: user.subscription?.current_period_end?.slice(0, 10) ?? "",
        notes: user.subscription?.notes ?? "",
      });
    }
  }, [user]);

  const save = useMutation({
    mutationFn: async () => {
      const calls = [
        supabase.functions.invoke("admin-user-actions", {
          body: {
            action: "update_profile", target_user_id: user.id,
            full_name: form.full_name, organization: form.organization,
            phone: form.phone, role_title: form.role_title,
            admin_notes: form.admin_notes, party: form.party,
          },
        }),
        supabase.functions.invoke("admin-user-actions", {
          body: {
            action: "change_plan", target_user_id: user.id, tier: form.tier,
          },
        }),
        supabase.functions.invoke("admin-user-actions", {
          body: {
            action: "update_subscription", target_user_id: user.id,
            max_candidates: form.max_candidates,
            max_updates_per_month: form.max_updates_per_month,
            current_period_end: form.current_period_end || undefined,
            status: form.status, notes: form.notes,
          },
        }),
      ];
      for (const c of calls) {
        const { data, error } = await c;
        if (error || (data as any)?.error) throw new Error(error?.message || (data as any)?.error);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Usuário atualizado" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nome completo</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label>Organização</Label><Input value={form.organization} onChange={e => setForm({ ...form, organization: e.target.value })} /></div>
          <div><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>Cargo</Label><Input value={form.role_title} onChange={e => setForm({ ...form, role_title: e.target.value })} /></div>
          <div><Label>Partido</Label><Input value={form.party} onChange={e => setForm({ ...form, party: e.target.value })} /></div>
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
                <SelectItem value="vip">👑 VIP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status assinatura</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativa</SelectItem>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="cancelled">Cancelada</SelectItem>
                <SelectItem value="expired">Expirada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Limite candidatos</Label><Input type="number" value={form.max_candidates} onChange={e => setForm({ ...form, max_candidates: Number(e.target.value) })} /></div>
          <div><Label>Limite análises/mês</Label><Input type="number" value={form.max_updates_per_month} onChange={e => setForm({ ...form, max_updates_per_month: Number(e.target.value) })} /></div>
          <div><Label>Expiração do plano</Label><Input type="date" value={form.current_period_end} onChange={e => setForm({ ...form, current_period_end: e.target.value })} /></div>
          <div className="col-span-2"><Label>Anotações internas ADM</Label><Textarea rows={3} value={form.admin_notes} onChange={e => setForm({ ...form, admin_notes: e.target.value })} /></div>
          <div className="col-span-2"><Label>Notas da assinatura</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
