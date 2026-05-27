import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import type { EventRepercussionData } from "@/hooks/useEventRepercussion";
import { format } from "date-fns";

export function RepercussionTimeline({ data }: { data: EventRepercussionData }) {
  const eventDay = data.event.date.slice(0, 10);
  const chartData = data.timeline.map((d) => ({
    date: d.date,
    label: format(new Date(d.date), "dd/MM"),
    Positivos: d.pos,
    Negativos: d.neg,
    Neutros: d.neu,
  }));

  return (
    <Card className="bg-card/40 border-border/40 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Timeline de Repercussão</CardTitle>
        <p className="text-xs text-muted-foreground">Comentários por dia (antes, durante e depois do evento)</p>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            Sem dados temporais.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="pos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(142,70%,45%)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="hsl(142,70%,45%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="neg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(0,75%,55%)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="hsl(0,75%,55%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="neu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(45,95%,55%)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="hsl(45,95%,55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <ReferenceLine x={format(new Date(eventDay), "dd/MM")} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ value: "Evento", fill: "hsl(var(--primary))", fontSize: 11, position: "top" }} />
              <Area type="monotone" dataKey="Positivos" stroke="hsl(142,70%,45%)" fill="url(#pos)" strokeWidth={2} />
              <Area type="monotone" dataKey="Neutros" stroke="hsl(45,95%,55%)" fill="url(#neu)" strokeWidth={2} />
              <Area type="monotone" dataKey="Negativos" stroke="hsl(0,75%,55%)" fill="url(#neg)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
