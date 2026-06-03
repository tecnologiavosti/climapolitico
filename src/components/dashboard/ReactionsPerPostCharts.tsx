import { useMemo, memo } from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import type { ActivityHourWeek, EngagementByNetwork, SentimentByNetwork } from "./ReactionsPerPost";

interface Props {
  positive: number;
  negative: number;
  neutral: number;
  pending: number;
  engagementByNetwork: EngagementByNetwork[];
  sentimentByNetwork: SentimentByNetwork[];
  activityHourWeek: ActivityHourWeek[];
}

const SENT_COLORS = {
  positive: "hsl(var(--success))",
  negative: "hsl(var(--destructive))",
  neutral: "hsl(var(--warning))",
  pending: "hsl(var(--muted-foreground))",
} as const;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function ReactionsPerPostChartsImpl({
  positive,
  negative,
  neutral,
  pending,
  engagementByNetwork,
  sentimentByNetwork,
  activityHourWeek,
}: Props) {
  const pieData = useMemo(() => [
    { name: "Positivo", value: positive, key: "positive" },
    { name: "Neutro", value: neutral, key: "neutral" },
    { name: "Negativo", value: negative, key: "negative" },
    { name: "Sem classificação", value: pending, key: "pending" },
  ].filter(d => d.value > 0), [positive, negative, neutral, pending]);

  // 4) Heatmap dia da semana × hora
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const row of activityHourWeek) {
      const day = Number(row.dia_semana);
      const hour = Number(row.hora);
      if (day >= 0 && day < 7 && hour >= 0 && hour < 24) {
        grid[day][hour] += Number(row.registros || 0);
      }
    }
    const max = Math.max(1, ...grid.flat());
    return { grid, max };
  }, [activityHourWeek]);

  return (
    <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 w-full min-w-0">
      {/* Pizza */}
      <div className="rounded-lg border p-3 sm:p-4 bg-card min-w-0 overflow-hidden">
        <h4 className="text-sm font-semibold mb-2">Distribuição de sentimento</h4>
        <div className="h-72 sm:h-80 lg:h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                outerRadius="80%"
                label={(p: any) => `${Math.round((p.percent || 0) * 100)}%`}
                labelLine={false}
              >
                {pieData.map((d) => <Cell key={d.key} fill={SENT_COLORS[d.key as keyof typeof SENT_COLORS]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconSize={10}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bar — engajamento por rede */}
      <div className="rounded-lg border p-3 sm:p-4 bg-card min-w-0 overflow-hidden">
        <h4 className="text-sm font-semibold mb-2">Engajamento por rede</h4>
        <div className="h-72 sm:h-80 lg:h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={engagementByNetwork} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="rede" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
              <Bar dataKey="curtidas" stackId="e" fill="hsl(var(--primary))" />
              <Bar dataKey="comentarios_respostas" stackId="e" name="comentários/respostas" fill="hsl(var(--accent))" />
              <Bar dataKey="compartilhamentos" stackId="e" stackId="e" fill="hsl(var(--secondary-foreground))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>


      {/* Stacked — sentimento por rede */}
      <div className="rounded-lg border p-3 sm:p-4 bg-card min-w-0 overflow-hidden">
        <h4 className="text-sm font-semibold mb-2">Sentimento por rede</h4>
        <div className="h-56 sm:h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sentimentByNetwork} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="rede" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={42} />
              <YAxis tick={{ fontSize: 10 }} width={36} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="positivo" stackId="s" fill={SENT_COLORS.positive} />
              <Bar dataKey="neutro" stackId="s" fill={SENT_COLORS.neutral} />
              <Bar dataKey="negativo" stackId="s" fill={SENT_COLORS.negative} />
              <Bar dataKey="sem_classificacao" stackId="s" name="sem classificação" fill={SENT_COLORS.pending} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heatmap — dia da semana × hora */}
      <div className="rounded-lg border p-3 sm:p-4 bg-card lg:col-span-2 min-w-0">
        <h4 className="text-sm font-semibold mb-2">Atividade por dia da semana e hora</h4>
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="inline-block min-w-max">
            <div className="flex">
              <div className="w-10 shrink-0" />
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="w-6 text-center text-[9px] text-muted-foreground shrink-0">{h}</div>
              ))}
            </div>
            {heatmap.grid.map((row, day) => (
              <div key={day} className="flex items-center">
                <div className="w-10 text-[10px] text-muted-foreground shrink-0">{WEEKDAYS[day]}</div>
                {row.map((v, h) => {
                  const alpha = v / heatmap.max;
                  return (
                    <div
                      key={h}
                      title={`${WEEKDAYS[day]} ${h}h — ${v.toLocaleString("pt-BR")} registro(s)`}
                      className="w-6 h-6 m-[1px] rounded-sm border border-border/50 shrink-0"
                      style={{ backgroundColor: v > 0 ? `hsl(var(--primary) / ${alpha.toFixed(3)})` : "hsl(var(--muted))" }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const ReactionsPerPostCharts = memo(ReactionsPerPostChartsImpl);
export default ReactionsPerPostCharts;
