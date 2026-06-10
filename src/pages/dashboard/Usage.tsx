import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Activity } from "lucide-react";

interface Row { event_type: string; total_quantity: number; total_cost: number; last_event: string | null; }

const labels: Record<string, string> = {
  ai_analysis: "Análises com IA",
  export: "Exportações",
  api_request: "Requisições API",
  collection_run: "Coletas de redes",
  speech_analysis: "Análises de fala",
};

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_user_usage_summary" as any, { _days: days });
    if (!error) setRows((data as any) || []);
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const total = rows.reduce((s, r) => s + Number(r.total_quantity || 0), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.total_cost || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6" />Meu Consumo</h1>
          <p className="text-muted-foreground text-sm">Eventos consumidos na plataforma nos últimos {days} dias.</p>
        </div>
        <select
          className="bg-background border rounded-md px-3 py-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-sm">Total de eventos</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{Number(total ?? 0).toLocaleString("pt-BR")}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Custo total (unidades)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold">{totalCost.toFixed(2)}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Por tipo de evento</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="animate-spin" /> : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum consumo registrado no período.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.event_type} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <div className="font-medium">{labels[r.event_type] ?? r.event_type}</div>
                    <div className="text-xs text-muted-foreground">
                      Último: {r.last_event ? new Date(r.last_event).toLocaleString("pt-BR") : "-"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-semibold">{Number(r.total_quantity).toLocaleString("pt-BR")}</div>
                    <div className="text-xs text-muted-foreground">custo: {Number(r.total_cost).toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
