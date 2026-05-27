import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import type { EventRepercussionData } from "@/hooks/useEventRepercussion";
import { format } from "date-fns";

export function RepercussionTimeline({ data }: { data: EventRepercussionData }) {
  const eventDay = String(data.event.date).slice(0, 10);
  const timeline = data.externalRepercussion.timeline || [];
  const chartData = timeline.map((d) => ({
    date: d.date,
    label: format(new Date(d.date), "dd/MM"),
    Publicações: d.count,
    phase: d.phase,
  }));

  return (
    <Card className="bg-card/40 border-border/40 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Linha temporal da cobertura externa</CardTitle>
        <p className="text-xs text-muted-foreground">Publicações por dia — antes, durante e depois do evento</p>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
            Sem datas de publicação suficientes para timeline.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="ext" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(190,80%,55%)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="hsl(190,80%,55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <ReferenceLine x={format(new Date(eventDay), "dd/MM")} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ value: "Evento", fill: "hsl(var(--primary))", fontSize: 11, position: "top" }} />
              <Area type="monotone" dataKey="Publicações" stroke="hsl(190,80%,55%)" fill="url(#ext)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
