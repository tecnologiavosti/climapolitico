import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, XAxis, YAxis, Tooltip, CartesianGrid,
  Scatter, Cell, ReferenceLine,
} from "recharts";

export type PeakStatus = "confirmed" | "probable" | "weak" | "indeterminate";

export interface AnnualPeakDatum {
  date: string;            // YYYY-MM-DD
  title: string;
  category?: string;
  status?: PeakStatus;
  score?: number;          // 0..100 confidence
  mentions?: number;       // for Y axis
}

interface Props {
  events: AnnualPeakDatum[];
  year?: number;           // when omitted, derive from data range
  onPointClick?: (date: string) => void;
}

const STATUS_COLOR: Record<PeakStatus, string> = {
  confirmed:     "hsl(142, 76%, 42%)",    // green
  probable:      "hsl(217, 91%, 60%)",    // blue
  weak:          "hsl(48, 96%, 53%)",     // yellow
  indeterminate: "hsl(220, 9%, 55%)",     // gray
};

const STATUS_LABEL: Record<PeakStatus, string> = {
  confirmed: "Confirmado", probable: "Provável", weak: "Fraco", indeterminate: "Indeterminado",
};

const MONTH_TICKS = [
  "01-01","02-01","03-01","04-01","05-01","06-01",
  "07-01","08-01","09-01","10-01","11-01","12-01",
];

function dayOfYear(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

function monthTickLabel(d: number): string {
  const date = new Date(Date.UTC(2024, 0, d));
  return date.toLocaleDateString("pt-BR", { month: "short" });
}

export function AnnualPeaksTimeline({ events, year, onPointClick }: Props) {
  const { rows, displayYear, maxMentions } = useMemo(() => {
    const validEvents = (events || []).filter((e) => e.date);
    if (validEvents.length === 0) return { rows: [], displayYear: year ?? new Date().getUTCFullYear(), maxMentions: 0 };
    const targetYear = year ?? Number(validEvents[validEvents.length - 1].date.slice(0, 4)) || new Date().getUTCFullYear();
    const yearEvents = validEvents.filter((e) => e.date.startsWith(String(targetYear)));
    const data = yearEvents.map((e) => ({
      day: dayOfYear(e.date),
      mentions: Math.max(1, Number(e.mentions || e.score || 1)),
      score: e.score ?? 0,
      status: (e.status || "indeterminate") as PeakStatus,
      title: e.title,
      category: e.category || "outros",
      date: e.date,
    }));
    const m = data.reduce((acc, d) => Math.max(acc, d.mentions), 0);
    return { rows: data, displayYear: targetYear, maxMentions: m };
  }, [events, year]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        Sem picos detectados para o ano selecionado.
      </div>
    );
  }

  const monthTickDays = MONTH_TICKS.map((md) => dayOfYear(`${displayYear}-${md}`));

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Timeline anual — {displayYear}</h3>
          <p className="text-xs text-muted-foreground">{rows.length} picos detectados ao longo do ano</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {(Object.keys(STATUS_COLOR) as PeakStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              <span className="text-muted-foreground">{STATUS_LABEL[s]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis
              type="number"
              dataKey="day"
              domain={[1, 366]}
              ticks={monthTickDays}
              tickFormatter={monthTickLabel}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
            />
            <YAxis
              dataKey="mentions"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              domain={[0, Math.max(10, maxMentions * 1.1)]}
            />
            <ReferenceLine y={maxMentions * 0.3} stroke="hsl(var(--border))" strokeDasharray="2 4" label={{ value: "baseline", position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              labelFormatter={() => ""}
              formatter={(_v, _n, item: any) => {
                const p = item?.payload;
                if (!p) return null;
                return [
                  `${p.title || "(sem título)"}\n${p.date} · ${STATUS_LABEL[p.status as PeakStatus]} · score ${p.score}`,
                  p.category,
                ];
              }}
            />
            <Scatter
              data={rows}
              shape="circle"
              onClick={(d: any) => onPointClick?.(d.date)}
              cursor={onPointClick ? "pointer" : "default"}
            >
              {rows.map((d, i) => (
                <Cell key={i} fill={STATUS_COLOR[d.status]} stroke="hsl(var(--background))" strokeWidth={1.5} />
              ))}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
