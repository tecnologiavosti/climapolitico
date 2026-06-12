import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRadarEvents, type RadarEvent } from "@/hooks/useRadarEvents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Loader2, ExternalLink, RefreshCw, Radio, CalendarIcon, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CATEGORIES = [
  "Eleições","STF","TSE","PF","CPI","Congresso","Executivo","Economia",
  "Escândalo","Prisão","Julgamento","Internacional","Outros",
];
const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "90d", label: "90 dias", days: 90 },
  { id: "365d", label: "1 ano", days: 365 },
  { id: "custom", label: "Personalizado", days: 0 },
];

function importanceBand(value: number): { label: string; tone: string } {
  if (value > 75) return { label: "Grande", tone: "bg-foreground text-background" };
  if (value >= 45) return { label: "Médio", tone: "bg-muted text-foreground border" };
  return { label: "Pequeno", tone: "bg-background text-muted-foreground border" };
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function RadarPolitico() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("all");
  const [preset, setPreset] = useState<string>("90d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [category, setCategory] = useState<string>("all");
  const [importanceFilter, setImportanceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RadarEvent | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: candidates } = useQuery({
    queryKey: ["candidates-min", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates").select("id,full_name").eq("user_id", user!.id).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    const days = PRESETS.find((p) => p.id === preset)?.days ?? 90;
    const t = new Date();
    const f = new Date();
    f.setDate(f.getDate() - days);
    return { from: f, to: t };
  }, [preset, customFrom, customTo]);

  const { data: events, isLoading, refetch } = useRadarEvents({
    candidateId: candidateId === "all" ? undefined : candidateId,
    from, to, category, search,
  });

  const kpis = useMemo(() => {
    const ev = events ?? [];
    return {
      total: ev.length,
      grandes: ev.filter((e) => e.importance > 75).length,
      institucional: ev.filter((e) => e.sources_json?.some((s) => s.type === "institutional")).length,
      altaRepercussao: ev.filter((e) => e.social_score >= 60).length,
    };
  }, [events]);

  const timeline = useMemo(() => {
    const map = new Map<string, number>();
    (events ?? []).forEach((e) => {
      const d = new Date(e.event_date);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [events]);
  const maxMonth = Math.max(1, ...timeline.map(([, v]) => v));

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const days =
        preset === "custom" && from && to
          ? Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000))
          : (PRESETS.find((p) => p.id === preset)?.days ?? 30);
      const { error } = await supabase.functions.invoke("run-radar-pipeline", {
        body: {
          candidate_id: candidateId === "all" ? undefined : candidateId,
          lookback_days: Math.min(365, days),
        },
      });
      if (error) throw error;
      toast.success("Radar atualizado");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Radio className="h-5 w-5 text-muted-foreground" /> Radar Político
            </h1>
            <p className="text-sm text-muted-foreground">
              Eventos políticos reais detectados via fontes externas.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os candidatos</SelectItem>
              {candidates?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>))}
            </SelectContent>
          </Select>

          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
            </SelectContent>
          </Select>

          {preset === "custom" && (
            <>
              <DateField date={customFrom} onChange={setCustomFrom} placeholder="De" />
              <DateField date={customTo} onChange={setCustomTo} placeholder="Até" />
            </>
          )}

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar evento..."
              className="pl-8 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Eventos" value={kpis.total} />
        <KpiCard label="Alta relevância" value={kpis.grandes} hint=">75 importância" />
        <KpiCard label="Institucional" value={kpis.institucional} hint="STF · TSE · PF" />
        <KpiCard label="Alta repercussão" value={kpis.altaRepercussao} hint="social ≥ 60" />
      </section>

      {timeline.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Distribuição mensal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 items-end h-24" style={{ gridTemplateColumns: `repeat(${timeline.length}, minmax(0, 1fr))` }}>
              {timeline.map(([k, count]) => {
                const [y, m] = k.split("-");
                return (
                  <div key={k} className="flex flex-col items-center gap-1 h-full justify-end">
                    <div
                      className="w-full bg-foreground/80 rounded-sm"
                      style={{ height: `${(count / maxMonth) * 100}%`, minHeight: 2 }}
                      title={`${count} eventos`}
                    />
                    <span className="text-[10px] text-muted-foreground">{MONTHS_PT[Number(m) - 1]}/{y.slice(2)}</span>
                    <span className="text-[10px] font-mono text-foreground/70">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
          {isLoading ? "Carregando..." : `${events?.length ?? 0} eventos`}
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (events?.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento. Clique em "Atualizar" para rodar o pipeline.
            </CardContent>
          </Card>
        ) : (
          <div className="divide-y border rounded-md bg-card">
            {events!.map((e) => {
              const band = importanceBand(e.importance);
              return (
                <button
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className="w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                        <span className="font-mono">{formatDate(e.event_date)}</span>
                        <span>·</span>
                        <span className="font-medium text-foreground/80">{e.category}</span>
                        <span>·</span>
                        <span>{e.source_count} fontes</span>
                      </div>
                      <h3 className="text-sm font-medium leading-snug truncate">{e.title}</h3>
                      {e.summary && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{e.summary}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${band.tone}`}>
                        {band.label} · {Math.round(e.importance)}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        social {Math.round(e.social_score)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base leading-snug">{selected.title}</SheetTitle>
                <SheetDescription className="flex items-center gap-2 text-xs">
                  <span>{formatDate(selected.event_date)}</span>
                  <span>·</span>
                  <Badge variant="outline" className="text-[10px]">{selected.category}</Badge>
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Importância" value={Math.round(selected.importance)} />
                  <Stat label="Fontes" value={selected.source_count} />
                  <Stat label="Social" value={Math.round(selected.social_score)} />
                </div>
                {selected.summary && (
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Resumo</h4>
                    <p className="text-sm">{selected.summary}</p>
                  </div>
                )}
                {selected.sources_json?.length > 0 && (
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Fontes</h4>
                    <ul className="space-y-1.5">
                      {selected.sources_json.map((s, i) => (
                        <li key={i}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm hover:underline flex items-center gap-1.5"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{s.source_name}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DateField({ date, onChange, placeholder }: { date?: Date; onChange: (d?: Date) => void; placeholder: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-9 justify-start font-normal", !date && "text-muted-foreground")}>
          <CalendarIcon className="h-4 w-4 mr-2" />
          {date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={onChange} initialFocus className={cn("p-3 pointer-events-auto")} />
      </PopoverContent>
    </Popover>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
