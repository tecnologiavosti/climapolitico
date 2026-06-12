import { useMemo } from "react";

export interface HeatmapEvent {
  date: string;     // YYYY-MM-DD
  status?: "confirmed" | "probable" | "weak" | "indeterminate";
  score?: number;
}

interface Props {
  events: HeatmapEvent[];
  year?: number;
  onCellClick?: (date: string) => void;
}

const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function daysInMonth(year: number, monthIdx0: number): number {
  return new Date(year, monthIdx0 + 1, 0).getDate();
}

export function MonthlyPeaksHeatmap({ events, year, onCellClick }: Props) {
  const { byCell, displayYear, maxCount } = useMemo(() => {
    const valid = (events || []).filter((e) => !!e.date);
    if (valid.length === 0) {
      return { byCell: new Map<string, number>(), displayYear: year ?? new Date().getUTCFullYear(), maxCount: 0 };
    }
    const target = year ?? (Number(valid[valid.length - 1].date.slice(0, 4)) || new Date().getUTCFullYear());
    const map = new Map<string, number>();
    let max = 0;
    for (const e of valid) {
      if (!e.date.startsWith(String(target))) continue;
      const key = e.date.slice(0, 10);
      const next = (map.get(key) || 0) + 1;
      map.set(key, next);
      if (next > max) max = next;
    }
    return { byCell: map, displayYear: target, maxCount: max };
  }, [events, year]);

  if (byCell.size === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        Sem picos no ano selecionado para gerar o heatmap.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 overflow-x-auto">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Heatmap mensal — {displayYear}</h3>
          <p className="text-xs text-muted-foreground">Intensidade = número de picos por dia (máx. {maxCount})</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>menos</span>
          {[0.15, 0.35, 0.55, 0.75, 1].map((op) => (
            <span key={op} className="inline-block h-3 w-3 rounded-sm" style={{ background: `hsl(var(--primary) / ${op})` }} />
          ))}
          <span>mais</span>
        </div>
      </div>
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[28px_repeat(31,_minmax(14px,_1fr))] gap-[2px] text-[10px]">
          <div />
          {Array.from({ length: 31 }, (_, i) => (
            <div key={`d${i}`} className="text-center text-muted-foreground tabular-nums">{i + 1}</div>
          ))}
          {MONTHS_PT.map((m, mi) => {
            const days = daysInMonth(displayYear, mi);
            const cells = [
              <div key={`m${mi}`} className="flex items-center text-muted-foreground font-medium">{m}</div>,
              ...Array.from({ length: 31 }, (_, di) => {
                if (di >= days) return <div key={`m${mi}d${di}`} />;
                const key = `${displayYear}-${String(mi + 1).padStart(2, "0")}-${String(di + 1).padStart(2, "0")}`;
                const count = byCell.get(key) || 0;
                const intensity = count === 0 ? 0 : Math.max(0.15, Math.min(1, count / Math.max(1, maxCount)));
                return (
                  <button
                    key={key}
                    title={`${key} · ${count} pico${count === 1 ? "" : "s"}`}
                    onClick={() => count > 0 && onCellClick?.(key)}
                    disabled={count === 0}
                    className="aspect-square rounded-sm border border-border/40 disabled:cursor-default"
                    style={{ background: intensity > 0 ? `hsl(var(--primary) / ${intensity})` : "hsl(var(--muted) / 0.3)" }}
                  />
                );
              }),
            ];
            return cells;
          })}
        </div>
      </div>
    </div>
  );
}
