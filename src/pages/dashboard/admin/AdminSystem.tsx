import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAdminAudit } from "@/hooks/useAdminAudit";

type SettingsMap = Record<string, any>;

function Inner() {
  const qc = useQueryClient();
  const { log: audit } = useAdminAudit();
  const [local, setLocal] = useState<SettingsMap>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-system-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("system_settings").select("*");
      if (error) throw error;
      const map: SettingsMap = {};
      (data ?? []).forEach((r: any) => (map[r.key] = r.value));
      return map;
    },
  });

  useEffect(() => { if (data) setLocal(data); }, [data]);

  async function save(key: string, value: any) {
    const { error } = await supabase.from("system_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    if (error) return toast.error(error.message);
    toast.success(`${key} salvo`);
    await audit("system_settings_updated", "settings", key, { value });
    qc.invalidateQueries({ queryKey: ["admin-system-settings"] });
  }

  if (isLoading) return <div className="p-6"><Skeleton className="h-96" /></div>;

  const platform = local.platform ?? {};
  const maintenance = local.maintenance ?? {};
  const banner = local.banner ?? {};
  const features = local.features ?? {};

  return (
    <div className="space-y-4 p-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Sistema</h1>
        <p className="text-muted-foreground">Configurações globais da plataforma.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Plataforma</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Nome</Label><Input value={platform.name ?? ""} onChange={(e) => setLocal({ ...local, platform: { ...platform, name: e.target.value } })} /></div>
          <div><Label>URL do logo</Label><Input value={platform.logo_url ?? ""} onChange={(e) => setLocal({ ...local, platform: { ...platform, logo_url: e.target.value } })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Cor principal</Label><Input type="color" value={platform.primary_color ?? "#0EA5E9"} onChange={(e) => setLocal({ ...local, platform: { ...platform, primary_color: e.target.value } })} /></div>
            <div><Label>Email suporte</Label><Input value={platform.support_email ?? ""} onChange={(e) => setLocal({ ...local, platform: { ...platform, support_email: e.target.value } })} /></div>
          </div>
          <Button onClick={() => save("platform", local.platform)}>Salvar plataforma</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modo Manutenção</CardTitle>
          <CardDescription>Quando ativo, todos os usuários (exceto admins) verão a mensagem.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={!!maintenance.enabled} onCheckedChange={(v) => setLocal({ ...local, maintenance: { ...maintenance, enabled: v } })} />
            <Label>Ativar manutenção</Label>
          </div>
          <div><Label>Mensagem</Label><Textarea value={maintenance.message ?? ""} onChange={(e) => setLocal({ ...local, maintenance: { ...maintenance, message: e.target.value } })} /></div>
          <Button onClick={() => save("maintenance", local.maintenance)}>Salvar manutenção</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Banner Global</CardTitle>
          <CardDescription>Aviso exibido no topo da plataforma.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch checked={!!banner.enabled} onCheckedChange={(v) => setLocal({ ...local, banner: { ...banner, enabled: v } })} />
            <Label>Exibir banner</Label>
          </div>
          <div><Label>Mensagem</Label><Input value={banner.message ?? ""} onChange={(e) => setLocal({ ...local, banner: { ...banner, message: e.target.value } })} /></div>
          <Button onClick={() => save("banner", local.banner)}>Salvar banner</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Feature Flags</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {[
            ["ai_enabled", "Habilitar IA"],
            ["payments_enabled", "Habilitar pagamentos"],
            ["radar_enabled", "Habilitar Radar Político"],
            ["network_view_enabled", "Habilitar Network View"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between border-b pb-2">
              <Label>{label}</Label>
              <Switch checked={!!features[k]} onCheckedChange={(v) => setLocal({ ...local, features: { ...features, [k]: v } })} />
            </div>
          ))}
          <Button onClick={() => save("features", local.features)}>Salvar feature flags</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSystem() { return <AdminRoute><Inner /></AdminRoute>; }
