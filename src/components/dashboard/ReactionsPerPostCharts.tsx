import { useMemo, memo } from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import type { PostRow } from "./ReactionsPerPost";

interface Props {
  posts: PostRow[];
  positive: number;
  negative: number;
  neutral: number;
}

const SENT_COLORS = { positive: "hsl(var(--success))", negative: "hsl(var(--destructive))", neutral: "hsl(var(--warning))" } as const;

function normSent(label: string | null): "positive" | "negative" | "neutral" | null {
  const v = (label || "").trim().toLowerCase();
  if (["positivo", "positive", "pos"].includes(v)) return "positive";
  if (["negativo", "negative", "neg"].includes(v)) return "negative";
  if (["neutro", "neutral", "neu"].includes(v)) return "neutral";
  return null;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function ReactionsPerPostChartsImpl({ posts, positive, negative, neutral }: Props) {
  // 1) Pizza sentimento — usa contagens agregadas reais (não amostra de posts)
  const pieData = useMemo(() => [
    { name: "Positivo", value: positive, key: "positive" },
    { name: "Neutro", value: neutral, key: "neutral" },
    { name: "Negativo", value: negative, key: "negative" },
  ].filter(d => d.value > 0), [positive, negative, neutral]);

  // 2) Evolução temporal — engajamento por dia (a partir dos posts amostrados)
  const timeline = useMemo(() => {
    const buckets: Record<string, { date: string; engajamento: number; posts: number }> = {};
    for (const p of posts) {
      if (!p.collected_at) continue;
      const d = p.collected_at.slice(0, 10);
      const eng = (p.likes_count || 0) + (p.replies_count || 0) + (p.shares_count || 0);
      const b = buckets[d] || { date: d, engajamento: 0, posts: 0 };
      b.engajamento += eng;
      b.posts += 1;
      buckets[d] = b;
    }
    return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  }, [posts]);

  // 3) Engajamento por rede + 5) Sentimento por rede (stacked)
  const byNetwork = useMemo(() => {
    const map: Record<string, { rede: string; engajamento: number; positivo: number; negativo: number; neutro: number }> = {};
    for (const p of posts) {
      const net = p.social_network || "outro";
      const m = map[net] || { rede: net, engajamento: 0, positivo: 0, negativo: 0, neutro: 0 };
      m.engajamento += (p.likes_count || 0) + (p.replies_count || 0) + (p.shares_count || 0);
      const s = normSent(p.sentiment_label);
      if (s === "positive") m.positivo++;
      else if (s === "negative") m.negativo++;
      else if (s === "neutral") m.neutro++;
      map[net] = m;
    }
    return Object.values(map).sort((a, b) => b.engajamento - a.engajamento).slice(0, 10);
  }, [posts]);

  // 4) Heatmap dia da semana × hora
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const p of posts) {
      if (!p.collected_at) continue;
      const d = new Date(p.collected_at);
      grid[d.getDay()][d.getHours()] += 1;
    }
    const max = Math.max(1, ...grid.flat());
    return { grid, max };
  }, [posts]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Pizza */}
      <div className="rounded-lg border p-4 bg-card">
        <h4 className="text-sm font-semibold mb-2">Distribuição de sentimento</h4>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} label>
                {pieData.map((d) => <Cell key={d.key} fill={SENT_COLORS[d.key as keyof typeof SENT_COLORS]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Linha — evolução */}
      <div className="rounded-lg border p-4 bg-card">
        <h4 className="text-sm font-semibold mb-2">Evolução temporal (engajamento)</h4>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="engajamento" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bar — engajamento por rede */}
      <div className="rounded-lg border p-4 bg-card">
        <h4 className="text-sm font-semibold mb-2">Engajamento por rede</h4>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byNetwork}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="rede" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="engajamento" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stacked — sentimento por rede */}
      <div className="rounded-lg border p-4 bg-card">
        <h4 className="text-sm font-semibold mb-2">Sentimento por rede</h4>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byNetwork}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="rede" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="positivo" stackId="s" fill={SENT_COLORS.positive} />
              <Bar dataKey="neutro" stackId="s" fill={SENT_COLORS.neutral} />
              <Bar dataKey="negativo" stackId="s" fill={SENT_COLORS.negative} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heatmap — dia da semana × hora */}
      <div className="rounded-lg border p-4 bg-card lg:col-span-2">
        <h4 className="text-sm font-semibold mb-2">Atividade por dia da semana e hora</h4>
        <div className="overflow-x-auto">
          <div className="inline-block">
            <div className="flex">
              <div className="w-10" />
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="w-6 text-center text-[9px] text-muted-foreground">{h}</div>
              ))}
            </div>
            {heatmap.grid.map((row, day) => (
              <div key={day} className="flex items-center">
                <div className="w-10 text-[10px] text-muted-foreground">{WEEKDAYS[day]}</div>
                {row.map((v, h) => {
                  const alpha = v / heatmap.max;
                  return (
                    <div
                      key={h}
                      title={`${WEEKDAYS[day]} ${h}h — ${v} post(s)`}
                      className="w-6 h-6 m-[1px] rounded-sm border border-border/50"
                      style={{ backgroundColor: `hsl(var(--primary) / ${alpha.toFixed(3)})` }}
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
