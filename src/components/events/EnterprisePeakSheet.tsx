import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, BarChart3, CheckCircle2, ExternalLink, Gauge, Network, Newspaper,
  ShieldCheck, Signal, Sparkles, TrendingUp,
} from "lucide-react";

export interface EnterprisePeakEvent {
  name: string;
  start_date: string;
  end_date?: string;
  category?: string;
  status?: "confirmed" | "probable" | "weak" | "indeterminate";
  // Signals & scoring
  signals?: Array<"z" | "ewma" | "momentum" | "burst" | "anomaly">;
  relevance_score?: number;
  relevance_band?: "baixa" | "media" | "alta" | "critica";
  confidence_score?: number;
  political_relevance?: number;
  peak_score?: number;
  external_score?: number;
  ssot_z_score?: number | null;
  ssot_baseline_volume?: number | null;
  ssot_peak_volume?: number | null;
  // Sources
  publications_count?: number;
  distinct_outlets?: number;
  strong_sources?: number;
  weak_sources?: number;
  strong_outlets?: number;
  trusted_sources_count?: number;
  independent_strong_sources?: number;
  tier_breakdown?: Record<string, number>;
  outlet_names?: string[];
  // Internal
  internal_mentions?: number;
  internal_authors?: number;
  internal_engagement?: number;
  internal_by_network?: Record<string, number>;
  // Coverage
  coverage_days?: number;
  coverage_quality?: string;
  peak_type?: string;
  detected_by?: string;
  has_strong_external?: boolean;
  has_external_evidence?: boolean;
  has_internal_evidence?: boolean;
}

const SIGNAL_LABEL: Record<string, string> = {
  z: "Z-score", ewma: "EWMA", momentum: "Momentum", burst: "Burst", anomaly: "Anomaly",
};

const STATUS_COLORS: Record<string, { label: string; cls: string; emoji: string }> = {
  confirmed:     { label: "Confirmado",     emoji: "🟢", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" },
  probable:      { label: "Provável",       emoji: "🟡", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300" },
  weak:          { label: "Fraco",          emoji: "🟠", cls: "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300" },
  indeterminate: { label: "Indeterminado",  emoji: "🔴", cls: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300" },
};

function fmt(n?: number | null): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function ScoreGauge({ label, value, max = 100, icon }: { label: string; value: number; max?: number; icon?: React.ReactNode }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-rose-600";
  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">{icon}{label}</span>
        <span className={`font-mono text-sm font-bold tabular-nums ${color}`}>{Math.round(value)}<span className="text-muted-foreground text-[10px]">/{max}</span></span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export function EnterprisePeakSheet({
  open, onOpenChange, event,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: EnterprisePeakEvent | null;
}) {
  if (!event) return null;
  const status = STATUS_COLORS[event.status || "indeterminate"];
  const confidencePct = Math.round((event.confidence_score ?? 0) * 10);
  const relevance = event.relevance_score ?? event.political_relevance ?? 0;
  const tiers = event.tier_breakdown || {};

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-hidden p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${status.cls}`}>{status.emoji} {status.label}</Badge>
            {event.category ? <Badge variant="outline" className="text-[10px] capitalize">{event.category}</Badge> : null}
            {event.peak_type ? <Badge variant="outline" className="text-[10px]">{event.peak_type}</Badge> : null}
          </div>
          <SheetTitle className="text-lg leading-snug text-left">{event.name}</SheetTitle>
          <SheetDescription className="text-left">
            {event.start_date}{event.end_date && event.end_date !== event.start_date ? ` → ${event.end_date}` : ""}
            {event.coverage_days ? ` · ${event.coverage_days}d de cobertura` : ""}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Score gauges */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" /> Métricas de scoring</h3>
              <div className="grid grid-cols-2 gap-2">
                <ScoreGauge label="Relevância política" value={relevance} icon={<TrendingUp className="h-3 w-3" />} />
                <ScoreGauge label="Confiança" value={confidencePct} icon={<ShieldCheck className="h-3 w-3" />} />
                {typeof event.peak_score === "number" ? (
                  <ScoreGauge label="Peak score" value={Math.min(100, event.peak_score / 10)} icon={<Activity className="h-3 w-3" />} />
                ) : null}
                {typeof event.external_score === "number" ? (
                  <ScoreGauge label="Score externo" value={event.external_score} icon={<Newspaper className="h-3 w-3" />} />
                ) : null}
              </div>
            </section>

            <Separator />

            {/* Detection signals */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Signal className="h-4 w-4 text-primary" /> Sinais de detecção</h3>
              {Array.isArray(event.signals) && event.signals.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {event.signals.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">
                      {SIGNAL_LABEL[s] || s}
                    </Badge>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground italic">Nenhum sinal estatístico registrado.</p>}

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border bg-muted/30 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Z-score</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.ssot_z_score)}</div>
                </div>
                <div className="rounded-md border bg-muted/30 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Baseline</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.ssot_baseline_volume)}</div>
                </div>
                <div className="rounded-md border bg-muted/30 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Pico</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.ssot_peak_volume)}</div>
                </div>
              </div>
            </section>

            <Separator />

            {/* Validation */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> Validação externa</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Fontes fortes</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.strong_sources)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Fontes fracas</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.weak_sources)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Veículos distintos</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.distinct_outlets)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Fontes confiáveis</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.trusted_sources_count)}</div>
                </div>
              </div>

              {Object.keys(tiers).length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase">Tiers de fontes</p>
                  {Object.entries(tiers).sort((a, b) => Number(b[1]) - Number(a[1])).map(([tier, n]) => (
                    <div key={tier} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground capitalize">{tier.replace(/_/g, " ")}</span>
                      <span className="font-mono font-semibold">{fmt(Number(n))}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {event.outlet_names && event.outlet_names.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Veículos ({event.outlet_names.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {event.outlet_names.slice(0, 20).map((o, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] font-normal">{o}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <Separator />

            {/* Internal repercussion */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Network className="h-4 w-4 text-primary" /> Repercussão nas redes (SSOT)</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Menções</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.internal_mentions)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Autores</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.internal_authors)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Engajamento</div>
                  <div className="font-mono text-sm font-bold">{fmt(event.internal_engagement)}</div>
                </div>
              </div>
              {event.internal_by_network && Object.keys(event.internal_by_network).length > 0 ? (
                <div className="space-y-1">
                  {Object.entries(event.internal_by_network).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8).map(([n, v]) => {
                    const total = Math.max(1, event.internal_mentions ?? 1);
                    const pct = Math.round((Number(v) / total) * 100);
                    return (
                      <div key={n} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 text-muted-foreground capitalize">{n}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                        </div>
                        <span className="w-16 text-right font-mono text-foreground">{fmt(Number(v))}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <Separator />

            {/* Detection metadata */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Metadata</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Meta k="Detected by" v={event.detected_by} />
                <Meta k="Peak type" v={event.peak_type} />
                <Meta k="Cobertura" v={event.coverage_quality} />
                <Meta k="Banda" v={event.relevance_band} />
                <Meta k="Ext. evidence" v={event.has_external_evidence ? "Sim" : "Não"} />
                <Meta k="Strong ext." v={event.has_strong_external ? "Sim" : "Não"} />
              </div>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Meta({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="rounded-md border bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
      <div className="font-medium truncate">{v || "—"}</div>
    </div>
  );
}
