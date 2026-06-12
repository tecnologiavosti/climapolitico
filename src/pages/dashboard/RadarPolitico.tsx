import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRadarEvents, type RadarEvent } from "@/hooks/useRadarEvents";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Loader2, ExternalLink, RefreshCw, Radio } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  "Eleições",
  "STF",
  "TSE",
  "PF",
  "CPI",
  "Congresso",
  "Economia",
  "Escândalo",
  "Prisão",
  "Julgamento",
  "Internacional",
  "Outros",
];

const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function importanceBand(value: number): { label: string; tone: string } {
  if (value > 75) return { label: "Grande", tone: "bg-foreground text-background" };
  if (value >= 45) return { label: "Médio", tone: "bg-muted text-foreground border" };
  return { label: "Pequeno", tone: "bg-background text-muted-foreground border" };
}

function formatDate(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function RadarPolitico() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("all");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<RadarEvent | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: candidates } = useQuery({
    queryKey: ["candidates-min", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id,full_name")
        .eq("user_id", user!.id)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: events,
    isLoading,
    refetch,
  } = useRadarEvents({
    candidateId: candidateId === "all" ? undefined : candidateId,
    year,
    category,
  });

  const kpis = useMemo(() => {
    const ev = events ?? [];
    const total = ev.length;
    const grandes = ev.filter((e) => e.importance > 75).length;
    const institucional = ev.filter((e) =>
      e.sources_json?.some((s) => s.type === "institutional")
    ).length;
    const altaRepercussao = ev.filter((e) => e.social_score >= 60).length;
    return { total, grandes, institucional, altaRepercussao };
  }, [events]);

  const timeline = useMemo(() => {
    const counts = Array(12).fill(0);
    (events ?? []).forEach((e) => {
      const m = new Date(e.event_date).getMonth();
      counts[m]++;
    });
    return counts;
  }, [events]);

  const maxMonth = Math.max(1, ...timeline);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("run-radar-pipeline", {
        body: {
          candidate_id: candidateId === "all" ? undefined : candidateId,
        },
      });
      if (error) throw error;
      toast.success("Radar atualizado");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar radar");
    } finally {
      setRefreshing(false);
    }
  }

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now, now - 1, now - 2, now - 3];
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Radio className="h-5 w-5 text-muted-foreground" />
            Radar Político
          </h1>
          <p className="text-sm text-muted-foreground">
            Eventos políticos reais detectados externamente, com repercussão social medida.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os candidatos</SelectItem>
              {candidates?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Eventos" value={kpis.total} />
        <KpiCard label="Alta relevância" value={kpis.grandes} hint=">75 importância" />
        <KpiCard label="Fontes institucionais" value={kpis.institucional} hint="STF, TSE, PF, CPI..." />
        <KpiCard label="Alta repercussão social" value={kpis.altaRepercussao} hint="social ≥60" />
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Linha do tempo · {year}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-12 gap-2 items-end h-32">
            {timeline.map((count, i) => (
              <div key={i} className="flex flex-col items-center gap-1 h-full justify-end">
                <div
                  className="w-full bg-foreground/80 rounded-sm transition-all"
                  style={{ height: `${(count / maxMonth) * 100}%`, minHeight: count > 0 ? 2 : 0 }}
                  title={`${count} eventos`}
                />
                <span className="text-[10px] text-muted-foreground">{MONTHS_PT[i]}</span>
                <span className="text-[10px] font-mono text-foreground/70">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground px-1">
          {isLoading ? "Carregando..." : `${events?.length ?? 0} eventos`}
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (events?.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento detectado para os filtros atuais. Clique em "Atualizar" para rodar o pipeline.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {events!.map((e) => {
              const band = importanceBand(e.importance);
              return (
                <button
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className="w-full text-left bg-card border rounded-md px-4 py-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <span>{formatDate(e.event_date)}</span>
                        <span>·</span>
                        <span className="font-medium text-foreground/80">{e.category}</span>
                        <span>·</span>
                        <span>{e.source_count} fontes</span>
                      </div>
                      <h3 className="text-sm font-medium leading-snug truncate">{e.title}</h3>
                      {e.summary && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.summary}</p>
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
                            className="text-sm text-foreground hover:underline flex items-center gap-1.5"
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
