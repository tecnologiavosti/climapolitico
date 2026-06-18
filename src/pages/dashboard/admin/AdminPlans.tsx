import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Trash2, Plus, Save } from "lucide-react";
import { useAdminAudit } from "@/hooks/useAdminAudit";

type Plan = {
  id: string;
  tier: string;
  display_name: string;
  price_monthly: number;
  price_yearly: number;
  max_candidates: number;
  max_updates_per_month: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
};

function PlanCard({ plan, onSave, onDelete }: { plan: Plan; onSave: (p: Plan) => void; onDelete: (id: string) => void }) {
  const [draft, setDraft] = useState<Plan>(plan);
  const update = (patch: Partial<Plan>) => setDraft(d => ({ ...d, ...patch }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="capitalize">{draft.tier}</span>
          <Badge variant={draft.is_active ? "default" : "secondary"}>{draft.is_active ? "Ativo" : "Inativo"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Tier (slug)</Label><Input value={draft.tier} onChange={e => update({ tier: e.target.value })} /></div>
          <div><Label>Nome exibido</Label><Input value={draft.display_name} onChange={e => update({ display_name: e.target.value })} /></div>
          <div><Label>Preço/mês (R$)</Label><Input type="number" value={draft.price_monthly} onChange={e => update({ price_monthly: Number(e.target.value) })} /></div>
          <div><Label>Preço/ano (R$)</Label><Input type="number" value={draft.price_yearly} onChange={e => update({ price_yearly: Number(e.target.value) })} /></div>
          <div><Label>Máx. candidatos</Label><Input type="number" value={draft.max_candidates} onChange={e => update({ max_candidates: Number(e.target.value) })} /></div>
          <div><Label>Updates/mês</Label><Input type="number" value={draft.max_updates_per_month} onChange={e => update({ max_updates_per_month: Number(e.target.value) })} /></div>
        </div>
        <div>
          <Label>Recursos (um por linha)</Label>
          <Textarea
            rows={4}
            value={(draft.features ?? []).join("\n")}
            onChange={e => update({ features: e.target.value.split("\n").filter(Boolean) })}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch checked={draft.is_active} onCheckedChange={v => update({ is_active: v })} />
            <span className="text-sm">Plano ativo</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onDelete(plan.id)}><Trash2 className="h-3 w-3" /></Button>
            <Button size="sm" onClick={() => onSave(draft)}><Save className="h-3 w-3 mr-1" /> Salvar</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Inner() {
  const qc = useQueryClient();
  const { log } = useAdminAudit();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("*").order("sort_order");
      if (error) throw error;
      return data as Plan[];
    },
  });

  const save = useMutation({
    mutationFn: async (p: Plan) => {
      const { error } = await supabase.from("subscription_plans").update({
        tier: p.tier, display_name: p.display_name, price_monthly: p.price_monthly,
        price_yearly: p.price_yearly, max_candidates: p.max_candidates,
        max_updates_per_month: p.max_updates_per_month, features: p.features, is_active: p.is_active,
      }).eq("id", p.id);
      if (error) throw error;
      await log("plan_updated", "subscription_plan", p.id, { tier: p.tier });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); toast({ title: "Plano salvo" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("subscription_plans").delete().eq("id", id);
      if (error) throw error;
      await log("plan_deleted", "subscription_plan", id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); toast({ title: "Plano removido" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("subscription_plans").insert({
        tier: `novo-${Date.now()}`, display_name: "Novo plano",
        price_monthly: 0, price_yearly: 0, max_candidates: 1, max_updates_per_month: 10,
        features: [], is_active: false, sort_order: (data?.length ?? 0) + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); toast({ title: "Plano criado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Planos</h1>
        <Button onClick={() => create.mutate()}><Plus className="h-4 w-4 mr-1" /> Novo plano</Button>
      </div>
      {isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.map(p => <PlanCard key={p.id} plan={p} onSave={save.mutate} onDelete={del.mutate} />)}
        </div>
      )}
    </div>
  );
}

export default function AdminPlans() { return <AdminRoute><Inner /></AdminRoute>; }
