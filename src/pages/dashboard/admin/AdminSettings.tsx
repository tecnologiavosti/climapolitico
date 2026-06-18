import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAdminAudit } from "@/hooks/useAdminAudit";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, RefreshCw, Trash2, Mail, Database, Bell, Shield, Activity } from "lucide-react";

type SettingsMap = Record<string, any>;

function Inner() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { log: audit } = useAdminAudit();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings-page"],
    queryFn: async () => {
      const { data } = await supabase.from("system_settings").select("*");
      const map: SettingsMap = {};
      (data ?? []).forEach((r: any) => (map[r.key] = r.value));
      return map;
    },
  });

  const [local, setLocal] = useState<SettingsMap>({});
  const merged: SettingsMap = { ...(settings ?? {}), ...local };
  const admin = merged.admin_prefs ?? {};
  const security = merged.security_prefs ?? {};
  const notify = merged.admin_notify ?? {};

  async function saveKey(key: string, value: any) {
    setBusy(key);
    const { error } = await supabase
      .from("system_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Salvo");
    await audit("admin_settings_updated", "settings", key, { value });
    qc.invalidateQueries({ queryKey: ["admin-settings-page"] });
    qc.invalidateQueries({ queryKey: ["admin-system-settings"] });
    setLocal((p) => ({ ...p, [key]: undefined }));
  }

  async function runAction(label: string, fn: () => Promise<void>, key = label) {
    setBusy(key);
    try {
      await fn();
      toast.success(`${label} concluído`);
      await audit("admin_action_executed", "maintenance", key, {});
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao executar");
    } finally {
      setBusy(null);
    }
  }

  async function purgeAnalysisCache() {
    const { error } = await supabase.from("analysis_cache").delete().not("id", "is", null);
    if (error) throw error;
  }
  async function purgeRadarCache() {
    const { error } = await supabase.from("radar_cache").delete().not("id", "is", null);
    if (error) throw error;
  }
  async function purgeMetricsCache() {
    const { error } = await supabase.from("candidate_metrics_cache").delete().not("id", "is", null);
    if (error) throw error;
  }
  async function purgeOldAuditLogs() {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const { error } = await supabase.from("admin_audit_logs").delete().lt("created_at", cutoff);
    if (error) throw error;
  }
  async function purgeOldLoginAttempts() {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { error } = await supabase.from("login_attempts").delete().lt("created_at", cutoff);
    if (error) throw error;
  }
  async function sendTestNotification() {
    if (!user) throw new Error("Sem sessão");
    const { error } = await supabase.from("notifications").insert({
      user_id: user.id,
      title: "🔔 Teste do painel ADM",
      message: "Esta é uma notificação de teste enviada pelo painel administrativo.",
      type: "info",
    });
    if (error) throw error;
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto pb-24 md:pb-6">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold">Configurações ADM</h1>
          <Badge variant="outline" className="text-xs">Super Admin</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Preferências do painel, automação, retenção e ações de manutenção.
        </p>
      </div>

      {/* Admin preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Shield className="h-4 w-4 text-primary" /> Preferências do Painel
          </CardTitle>
          <CardDescription>Comportamento padrão das telas administrativas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <Label className="font-medium">Confirmação dupla em ações destrutivas</Label>
              <p className="text-xs text-muted-foreground">Banir, deletar e impersonar exigem confirmação extra.</p>
            </div>
            <Switch
              checked={admin.confirm_destructive ?? true}
              onCheckedChange={(v) =>
                setLocal((p) => ({ ...p, admin_prefs: { ...admin, confirm_destructive: v } }))
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <Label className="font-medium">Auditar todas as leituras sensíveis</Label>
              <p className="text-xs text-muted-foreground">Registra também visualizações de dados de usuários.</p>
            </div>
            <Switch
              checked={admin.audit_reads ?? false}
              onCheckedChange={(v) =>
                setLocal((p) => ({ ...p, admin_prefs: { ...admin, audit_reads: v } }))
              }
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Tamanho padrão de página (tabelas)</Label>
              <Input
                type="number"
                min={10}
                max={500}
                value={admin.page_size ?? 50}
                onChange={(e) =>
                  setLocal((p) => ({ ...p, admin_prefs: { ...admin, page_size: Number(e.target.value) } }))
                }
              />
            </div>
            <div>
              <Label>Timeout de sessão admin (min)</Label>
              <Input
                type="number"
                min={5}
                max={480}
                value={admin.session_timeout ?? 60}
                onChange={(e) =>
                  setLocal((p) => ({ ...p, admin_prefs: { ...admin, session_timeout: Number(e.target.value) } }))
                }
              />
            </div>
          </div>
          <Button
            onClick={() => saveKey("admin_prefs", merged.admin_prefs)}
            disabled={busy === "admin_prefs"}
            className="w-full sm:w-auto"
          >
            Salvar preferências
          </Button>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Activity className="h-4 w-4 text-primary" /> Segurança & Retenção
          </CardTitle>
          <CardDescription>Políticas globais aplicadas aos jobs de limpeza.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Logs de auditoria (dias)</Label>
              <Input
                type="number"
                min={7}
                value={security.audit_retention_days ?? 90}
                onChange={(e) =>
                  setLocal((p) => ({ ...p, security_prefs: { ...security, audit_retention_days: Number(e.target.value) } }))
                }
              />
            </div>
            <div>
              <Label>Tentativas de login (dias)</Label>
              <Input
                type="number"
                min={1}
                value={security.login_retention_days ?? 30}
                onChange={(e) =>
                  setLocal((p) => ({ ...p, security_prefs: { ...security, login_retention_days: Number(e.target.value) } }))
                }
              />
            </div>
            <div>
              <Label>Máx. tentativas antes de bloqueio</Label>
              <Input
                type="number"
                min={3}
                value={security.max_login_attempts ?? 5}
                onChange={(e) =>
                  setLocal((p) => ({ ...p, security_prefs: { ...security, max_login_attempts: Number(e.target.value) } }))
                }
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="min-w-0">
              <Label className="font-medium">Bloquear auto-cadastro</Label>
              <p className="text-xs text-muted-foreground">Apenas admins poderão criar novas contas.</p>
            </div>
            <Switch
              checked={security.disable_signup ?? false}
              onCheckedChange={(v) =>
                setLocal((p) => ({ ...p, security_prefs: { ...security, disable_signup: v } }))
              }
            />
          </div>
          <Button
            onClick={() => saveKey("security_prefs", merged.security_prefs)}
            disabled={busy === "security_prefs"}
            className="w-full sm:w-auto"
          >
            Salvar políticas
          </Button>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Bell className="h-4 w-4 text-primary" /> Alertas para Admins
          </CardTitle>
          <CardDescription>O que envia notificação para a equipe administrativa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            ["new_signup", "Novo cadastro"],
            ["new_payment", "Novo pagamento registrado"],
            ["failed_login_spike", "Pico de logins falhos"],
            ["plan_cancelled", "Cancelamento de plano"],
            ["pipeline_error", "Erro em pipeline / coletor"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between border-b pb-2 gap-3">
              <Label className="font-medium">{label}</Label>
              <Switch
                checked={notify[k] ?? true}
                onCheckedChange={(v) =>
                  setLocal((p) => ({ ...p, admin_notify: { ...notify, [k]: v } }))
                }
              />
            </div>
          ))}
          <Button
            onClick={() => saveKey("admin_notify", merged.admin_notify)}
            disabled={busy === "admin_notify"}
            className="w-full sm:w-auto"
          >
            Salvar alertas
          </Button>
          <Separator />
          <Button
            variant="outline"
            onClick={() => runAction("Notificação de teste", sendTestNotification, "test_notif")}
            disabled={busy === "test_notif"}
            className="w-full sm:w-auto"
          >
            <Mail className="h-4 w-4 mr-2" />
            Enviar notificação de teste
          </Button>
        </CardContent>
      </Card>

      {/* Maintenance */}
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <RefreshCw className="h-4 w-4 text-amber-500" /> Manutenção & Caches
          </CardTitle>
          <CardDescription>Operações reversíveis sobre dados derivados.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => runAction("Cache de análises", purgeAnalysisCache, "p1")} disabled={busy === "p1"} className="justify-start">
            <Database className="h-4 w-4 mr-2" /> Limpar cache de análises
          </Button>
          <Button variant="outline" onClick={() => runAction("Cache do Radar", purgeRadarCache, "p2")} disabled={busy === "p2"} className="justify-start">
            <Database className="h-4 w-4 mr-2" /> Limpar cache do Radar
          </Button>
          <Button variant="outline" onClick={() => runAction("Cache de métricas", purgeMetricsCache, "p3")} disabled={busy === "p3"} className="justify-start">
            <Database className="h-4 w-4 mr-2" /> Limpar cache de métricas
          </Button>
          <Button variant="outline" onClick={() => runAction("Logins antigos (>30d)", purgeOldLoginAttempts, "p4")} disabled={busy === "p4"} className="justify-start">
            <Trash2 className="h-4 w-4 mr-2" /> Purgar tentativas de login antigas
          </Button>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg text-destructive">
            <AlertTriangle className="h-4 w-4" /> Zona de Perigo
          </CardTitle>
          <CardDescription>Ações permanentes — exigem confirmação.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={busy === "p5"}
            onClick={() => {
              if (!confirm("Apagar TODOS os logs de auditoria com mais de 90 dias?")) return;
              runAction("Auditoria antiga", purgeOldAuditLogs, "p5");
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Purgar auditoria antiga (&gt;90d)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSettings() {
  return (
    <AdminRoute>
      <Inner />
    </AdminRoute>
  );
}
