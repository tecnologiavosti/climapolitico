import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Bell, Mail, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type AlertItem = {
  type: "api" | "collector" | "youtube";
  severity: "critical" | "warning";
  name: string;
  message: string;
  usage_percent?: number;
};

type Response = {
  alerts: AlertItem[];
  total: number;
  critical: number;
  warning: number;
  email_sent: boolean;
  checked_at: string;
};

async function fetchAlerts(sendEmail = false, email?: string): Promise<Response> {
  const { data, error } = await supabase.functions.invoke("check-token-alerts", {
    body: { send_email: sendEmail, email, warn_threshold: 70, critical_threshold: 90 },
  });
  if (error) throw error;
  return data as Response;
}

export default function AdminTokenAlerts() {
  const [email, setEmail] = useState(() => localStorage.getItem("token_alerts_email") ?? "");
  const [sending, setSending] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["token-alerts"],
    queryFn: () => fetchAlerts(false),
    refetchInterval: 5 * 60 * 1000,
  });

  async function handleSendEmail() {
    if (!email || !email.includes("@")) {
      toast.error("Informe um e-mail válido");
      return;
    }
    localStorage.setItem("token_alerts_email", email);
    setSending(true);
    try {
      const res = await fetchAlerts(true, email);
      if (res.email_sent) {
        toast.success(`E-mail enviado para ${email} com ${res.total} alerta(s)`);
      } else if (res.total === 0) {
        toast.info("Nenhum alerta ativo — nada a enviar");
      } else {
        toast.warning("Alertas encontrados mas e-mail não foi enviado");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar e-mail");
    } finally {
      setSending(false);
    }
  }

  const alerts = data?.alerts ?? [];
  const critical = alerts.filter((a) => a.severity === "critical");
  const warning = alerts.filter((a) => a.severity === "warning");

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Bell className="h-7 w-7 text-primary" /> Alertas de Tokens
        </h1>
        <p className="text-muted-foreground">
          Monitora chaves de IA/APIs e quotas de coletores. Envia alerta por e-mail quando algo estiver prestes a esgotar.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Total de alertas</CardDescription></CardHeader>
          <CardContent><div className="text-3xl font-bold">{isLoading ? "…" : data?.total ?? 0}</div></CardContent>
        </Card>
        <Card className="border-destructive/40">
          <CardHeader className="pb-2"><CardDescription className="text-destructive">Críticos</CardDescription></CardHeader>
          <CardContent><div className="text-3xl font-bold text-destructive">{isLoading ? "…" : critical.length}</div></CardContent>
        </Card>
        <Card className="border-warning/40">
          <CardHeader className="pb-2"><CardDescription>Avisos</CardDescription></CardHeader>
          <CardContent><div className="text-3xl font-bold text-warning">{isLoading ? "…" : warning.length}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Notificação por e-mail</CardTitle>
          <CardDescription>
            Digite o e-mail que receberá o relatório de alertas. O envio funciona tanto em preview quanto em produção ({" "}
            <code>climapolitico.com.br</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <Label htmlFor="alert-email" className="sr-only">E-mail</Label>
              <Input
                id="alert-email"
                type="email"
                placeholder="admin@climapolitico.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button onClick={handleSendEmail} disabled={sending || !email}>
              {sending ? "Enviando…" : "Enviar alertas agora"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O e-mail é enviado via Resend (mesmo serviço do 2FA / reset de senha). Somente envia se houver alertas ativos.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Alertas ativos</CardTitle>
            <CardDescription>
              {data?.checked_at
                ? `Última verificação: ${new Date(data.checked_at).toLocaleString("pt-BR")}`
                : "Verificando…"}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : alerts.length === 0 ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription>
                Nenhum token ou coletor com problemas. Tudo dentro da quota.
              </AlertDescription>
            </Alert>
          ) : (
            alerts.map((a, idx) => (
              <div
                key={`${a.type}-${a.name}-${idx}`}
                className="flex items-start gap-3 p-3 rounded-lg border bg-card"
              >
                <AlertTriangle
                  className={`h-5 w-5 mt-0.5 shrink-0 ${
                    a.severity === "critical" ? "text-destructive" : "text-warning"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{a.name}</span>
                    <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>
                      {a.severity === "critical" ? "Crítico" : "Aviso"}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {a.type === "api" ? "API" : a.type === "collector" ? "Coletor" : "YouTube"}
                    </Badge>
                    {typeof a.usage_percent === "number" && (
                      <Badge variant="outline" className="text-xs">{a.usage_percent}%</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{a.message}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
