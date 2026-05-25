import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Sparkles, X, RefreshCw, Lightbulb, Shield, Target } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function NarrativeAlerts() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["narrative-alerts", user?.id, showDismissed],
    queryFn: async () => {
      if (!user) return [];
      let q = supabase
        .from("narrative_alerts")
        .select("*, candidates:candidate_id(full_name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!showDismissed) q = q.eq("is_dismissed", false);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleScan = async () => {
    setScanning(true);
    const t = toast.loading("IA varrendo picos de menções nas últimas 24h...");
    try {
      const { data, error } = await supabase.functions.invoke("detect-narrative-spikes", { body: {} });
      if (error) throw error;
      toast.dismiss(t);
      toast.success(`Varredura concluída: ${data?.alerts_created || 0} novo(s) alerta(s)`);
      qc.invalidateQueries({ queryKey: ["narrative-alerts"] });
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(`Falha: ${e.message || e}`);
    } finally {
      setScanning(false);
    }
  };

  const handleDismiss = async (id: string) => {
    const { error } = await supabase.from("narrative_alerts").update({ is_dismissed: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["narrative-alerts"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" /> IA Narrativa de Picos
          </h1>
          <p className="text-muted-foreground">Quando o volume de menções dispara, a IA detecta a bolha, o tema e sugere narrativa contra-resposta.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Ocultar dispensados" : "Mostrar dispensados"}
          </Button>
          <Button onClick={handleScan} disabled={scanning}>
            <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Analisando..." : "Varrer agora"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}</div>
      ) : !alerts || alerts.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Nenhum alerta de narrativa. Clique em "Varrer agora" para a IA buscar picos das últimas 24h.
        </Card>
      ) : (
        <div className="space-y-4">
          {alerts.map((a: any) => (
            <Card key={a.id} className={`p-5 ${a.is_dismissed ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Pico
                    </Badge>
                    {a.candidates?.full_name && <Badge variant="secondary">{a.candidates.full_name}</Badge>}
                    {a.dominant_sentiment && (
                      <Badge className={
                        a.dominant_sentiment === "Positivo" ? "bg-emerald-500/15 text-emerald-700" :
                        a.dominant_sentiment === "Negativo" ? "bg-rose-500/15 text-rose-700" : "bg-muted text-muted-foreground"
                      }>{a.dominant_sentiment}</Badge>
                    )}
                    {typeof a.confidence === "number" && (
                      <span className="text-xs text-muted-foreground">Confiança: {Math.round(a.confidence * 100)}%</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">{format(new Date(a.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                  </div>
                  <h3 className="font-semibold text-lg">{a.trigger_reason}</h3>
                  <div className="text-sm text-muted-foreground mt-1">
                    {a.spike_volume} menções no pico
                    {a.detected_bubble && <> • Bolha: <span className="text-foreground font-medium">{a.detected_bubble}</span></>}
                    {a.dominant_theme && <> • Tema: <span className="text-foreground font-medium">{a.dominant_theme}</span></>}
                  </div>
                </div>
                {!a.is_dismissed && (
                  <Button variant="ghost" size="icon" onClick={() => handleDismiss(a.id)}><X className="h-4 w-4" /></Button>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-3 mt-3">
                {a.suggested_action && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-1"><Target className="h-4 w-4 text-primary" /> Ação sugerida</div>
                    <p className="text-sm">{a.suggested_action}</p>
                  </div>
                )}
                {a.alternative_narrative && (
                  <div className="p-3 rounded-lg bg-accent/30 border">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-1"><Lightbulb className="h-4 w-4 text-amber-500" /> Narrativa alternativa</div>
                    <p className="text-sm">{a.alternative_narrative}</p>
                  </div>
                )}
                {Array.isArray(a.risks) && a.risks.length > 0 && (
                  <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-1 text-rose-700"><Shield className="h-4 w-4" /> Riscos</div>
                    <ul className="text-sm list-disc list-inside space-y-0.5">{a.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                {Array.isArray(a.opportunities) && a.opportunities.length > 0 && (
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-1 text-emerald-700"><Sparkles className="h-4 w-4" /> Oportunidades</div>
                    <ul className="text-sm list-disc list-inside space-y-0.5">{a.opportunities.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
              </div>

              {Array.isArray(a.affected_groups) && a.affected_groups.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">Grupos afetados:</span>
                  {a.affected_groups.map((g: string, i: number) => <Badge key={i} variant="outline" className="text-xs">{g}</Badge>)}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
