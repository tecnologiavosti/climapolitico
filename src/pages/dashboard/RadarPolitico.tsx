import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Radar, RefreshCw, Search, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRadarEvents, RadarEvent, RadarEventSize } from "@/hooks/useRadarEvents";
import { RadarEventSheet } from "@/components/radar/RadarEventSheet";

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const SIZES: { id: RadarEventSize | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "grande", label: "Grandes" },
  { id: "medio", label: "Médios" },
  { id: "pequeno", label: "Pequenos" },
];

const SIZE_BADGE: Record<RadarEventSize, string> = {
  grande: "border-foreground text-foreground",
  medio: "border-muted-foreground/60 text-foreground/80",
  pequeno: "border-muted-foreground/30 text-muted-foreground",
};

export default function RadarPolitico() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [size, setSize] = useState<RadarEventSize | "todos">("todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RadarEvent | null>(null);

  const { data: candidates } = useQuery({
    queryKey: ["radar-candidates", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id, full_name")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (!candidateId && candidates && candidates.length) setCandidateId(candidates[0].id);
  }, [candidates, candidateId]);

  const { data: events, isLoading, refetch } = useRadarEvents(candidateId, year);

  const pipelineMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-event-pipeline", {
        body: { candidate_ids: candidateId ? [candidateId] : null, max_age_hours: 72 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Pipeline disparado", description: "Coletando notícias e fontes institucionais." });
      setTimeout(() => refetch(), 5000);
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message || "Falha ao disparar pipeline", variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const list = events || [];
    const q = query.trim().toLowerCase();
    return list.filter((e) => {
      if (size !== "todos" && e.size !== size) return false;
      if (q && !(e.title?.toLowerCase().includes(q) || e.summary?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [events, size, query]);

  const kpis = useMemo(() => {
    const list = events || [];
    return {
      total: list.length,
      grande: list.filter((e) => e.size === "grande").length,
      medio: list.filter((e) => e.size === "medio").length,
      pequeno: list.filter((e) => e.size === "pequeno").length,
    };
  }, [events]);

  const monthly = useMemo(() => {
    const buckets = new Array(12).fill(0);
    (events || []).forEach((e) => {
      const m = new Date(e.event_date).getMonth();
      if (m >= 0 && m < 12) buckets[m] += 1;
    });
    const max = Math.max(1, ...buckets);
    return buckets.map((c, i) => ({ month: MONTHS_PT[i], count: c, pct: (c / max) * 100 }));
  }, [events]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now, now - 1, now - 2, now - 3];
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Radar Político</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Eventos políticos coletados de fontes institucionais (STF, TSE, PF, Senado, Câmara) e da grande imprensa.
          A repercussão social é calculada como métrica derivada — nenhum evento nasce de redes sociais.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Selecionar candidato" /></SelectTrigger>
            <SelectContent>
              {(candidates || []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1 ml-auto">
            {SIZES.map((s) => (
              <Button
                key={s.id}
                variant={size === s.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSize(s.id)}
              >
                {s.label}
              </Button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar evento…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => pipelineMutation.mutate()}
            disabled={pipelineMutation.isPending || !candidateId}
          >
            {pipelineMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
            Coletar agora
          </Button>
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Eventos" value={kpis.total} />
        <KpiCard label="Grandes" value={kpis.grande} />
        <KpiCard label="Médios" value={kpis.medio} />
        <KpiCard label="Pequenos" value={kpis.pequeno} />
      </section>

      {/* TIMELINE MENSAL */}
      <section>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linha do tempo · {year}</h2>
              <span className="text-[10px] text-muted-foreground">{kpis.total} eventos no ano</span>
            </div>
            <div className="grid grid-cols-12 gap-1.5 items-end h-32">
              {monthly.map((m) => (
                <div key={m.month} className="flex flex-col items-center gap-1.5">
                  <div className="flex-1 w-full flex items-end">
                    <div
                      className="w-full bg-foreground/80 hover:bg-foreground transition-colors rounded-sm"
                      style={{ height: `${Math.max(2, m.pct)}%` }}
                      title={`${m.month}: ${m.count} eventos`}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium">{m.month}</div>
                  <div className="text-[10px] font-mono">{m.count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* LISTA DE CARDS COMPACTOS */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Eventos {size !== "todos" ? `· ${SIZES.find((s) => s.id === size)?.label.toLowerCase()}` : ""}
          </h2>
          <span className="text-[10px] text-muted-foreground">{filtered.length} de {kpis.total}</span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Nenhum evento encontrado.
              {!events?.length && <> Clique em <span className="font-semibold">Coletar agora</span> para iniciar a coleta.</>}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setSelected(e)}
                  className="w-full text-left rounded border bg-card hover:bg-muted/40 transition-colors p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center w-12 shrink-0 pt-0.5">
                      <span className="text-[10px] uppercase text-muted-foreground font-mono">
                        {MONTHS_PT[new Date(e.event_date).getMonth()]}
                      </span>
                      <span className="text-lg font-bold leading-none font-mono">
                        {String(new Date(e.event_date).getDate()).padStart(2, "0")}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold leading-snug line-clamp-2 flex-1 min-w-0">{e.title}</h3>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${SIZE_BADGE[e.size]}`}>
                          {e.size === "grande" ? "Grande" : e.size === "medio" ? "Médio" : "Pequeno"}
                        </Badge>
                      </div>
                      {e.summary && <p className="text-xs text-muted-foreground line-clamp-2">{e.summary}</p>}
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono pt-0.5">
                        {e.category && <span className="uppercase">{e.category}</span>}
                        <span>{e.source_count} fonte{e.source_count !== 1 ? "s" : ""}</span>
                        <span>repercussão {Math.round(e.social_score)}</span>
                        <span className="ml-auto">imp. {Math.round(e.importance)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RadarEventSheet
        open={!!selected}
        onOpenChange={(v) => !v && setSelected(null)}
        event={selected}
      />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className="text-3xl font-bold mt-1 tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
