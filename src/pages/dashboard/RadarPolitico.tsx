import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2, ExternalLink, Search, Radio, CalendarIcon, Sparkles, ArrowUpDown, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface RadarEvent {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  content?: string;
  category: string;
  event_date: string;
  source_count: number;
  institutional_sources: number;
  social_score: number;
  importance: number;
  sources: Array<{ name: string; url: string; type?: string }>;
}

const CATEGORIES = [
  "Todos","Eleições","STF","TSE","PF","CPI","Congresso","Executivo","Economia",
  "Escândalos","Prisões","Julgamentos","Internacional","Outros",
];

const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "90d", label: "90 dias", days: 90 },
  { id: "1y", label: "1 ano", days: 365 },
  { id: "4y", label: "4 anos", days: 365 * 4 },
  { id: "8y", label: "8 anos", days: 365 * 8 },
  { id: "custom", label: "Personalizado", days: 0 },
];

const nfBR = new Intl.NumberFormat("pt-BR");

function sanitizeRadarText(input: unknown): string {
  if (input == null) return "";
  let s = String(input);
  s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
  const map: Record<string, string> = {
    "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'",
    "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"',
    "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-",
    "\u2022": "-", "\u2023": "-", "\u25E6": "-", "\u2043": "-",
    "\u00A0": " ", "\u202F": " ", "\u2009": " ", "\u200A": " ",
    "\u2026": "...",
  };
  s = s.replace(/[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2013\u2014\u2015\u2212\u2022\u2023\u25E6\u2043\u00A0\u202F\u2009\u200A\u2026]/g, (c) => map[c] ?? c);
  return s.replace(/\s+/g, " ").trim();
}

function band(value: number) {
  if (value >= 80) return { label: "Crítico", tone: "bg-destructive text-destructive-foreground" };
  if (value >= 60) return { label: "Grande", tone: "bg-foreground text-background" };
  if (value >= 30) return { label: "Médio", tone: "bg-muted text-foreground border" };
  return { label: "Pequeno", tone: "bg-background text-muted-foreground border" };
}

function fmtDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function RadarPolitico() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("all");
  const [preset, setPreset] = useState<string>("90d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [category, setCategory] = useState<string>("Todos");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "importance" | "social">("date");
  const [selected, setSelected] = useState<RadarEvent | null>(null);
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<{ message: string; stack: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

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

  const candidateName = useMemo(() => {
    if (candidateId === "all") return "todos os candidatos monitorados";
    return candidates?.find((c) => c.id === candidateId)?.full_name ?? "candidato";
  }, [candidateId, candidates]);

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    const days = PRESETS.find((p) => p.id === preset)?.days ?? 90;
    const t = new Date();
    const f = new Date();
    f.setDate(f.getDate() - days);
    return { from: f, to: t };
  }, [preset, customFrom, customTo]);

  // Polling do job em background
  const { data: jobStatus } = useQuery({
    queryKey: ["radar-job", jobId],
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.status;
      return s === "completed" || s === "failed" ? false : 3000;
    },
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("radar-job-status", {
        body: { job_id: jobId },
      });
      if (error) throw error;
      return data as {
        id: string;
        status: "queued" | "running" | "completed" | "failed";
        progress: number;
        total_chunks: number;
        processed_chunks: number;
        events_count: number;
        events: RadarEvent[] | null;
        error: string | null;
      };
    },
  });

  const isJobRunning = jobStatus?.status === "queued" || jobStatus?.status === "running";

  // Quando job conclui, popular events
  useEffect(() => {
    if (!jobStatus) return;
    if (jobStatus.status === "completed" && jobStatus.events) {
      const clean = (jobStatus.events ?? []).map((e) => ({
        ...e,
        title: sanitizeRadarText(e.title),
        summary: sanitizeRadarText(e.summary ?? e.description ?? e.content ?? ""),
        description: sanitizeRadarText(e.description ?? ""),
        content: sanitizeRadarText(e.content ?? ""),
        category: sanitizeRadarText(e.category),
        sources: (e.sources ?? []).map((s) => ({ ...s, name: sanitizeRadarText(s.name) })),
      }));
      setEvents(clean);
      setLastFetchedAt(new Date());
      setLastError(null);
      toast.success(`${clean.length} eventos coletados pela IA`);
    } else if (jobStatus.status === "failed") {
      setLastError({ message: jobStatus.error ?? "Job falhou", stack: "" });
      toast.error(jobStatus.error ?? "Job falhou");
    }
  }, [jobStatus?.status, jobStatus?.events_count]);

  const searchMutation = useMutation({
    mutationFn: async (_force: boolean = false) => {
      if (candidateId === "all") throw new Error("Selecione um candidato.");
      if (!from || !to) throw new Error("Defina o período (datas inicial e final).");
      setEvents([]);
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("radar-job-create", {
        body: {
          candidate_id: candidateId,
          candidate_name: candidateName,
          start_date: from.toISOString().slice(0, 10),
          end_date: to.toISOString().slice(0, 10),
          categories: category === "Todos" ? [] : [category],
        },
      });
      if (error) {
        const ctx = (error as any)?.context;
        const errorBody = ctx?.clone ? await ctx.clone().json().catch(() => null) : null;
        throw new Error(errorBody?.error ?? error.message);
      }
      return data as { job_id: string; status: string };
    },
    onSuccess: (data) => {
      setJobId(data.job_id);
      toast.info("Coleta iniciada em background. O resultado aparecerá em alguns minutos.");
    },
    onError: (e: any) => {
      setLastError({ message: e?.message ?? "Falha ao iniciar job", stack: "" });
      toast.error(e?.message ?? "Falha ao iniciar job");
    },
  });

  // Filtros locais
  const filtered = useMemo(() => {
    let list = events;
    if (category !== "Todos") list = list.filter((e) => e.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.title.toLowerCase().includes(q) || (e.summary ?? "").toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      if (sortBy === "importance") return b.importance - a.importance;
      if (sortBy === "social") return b.social_score - a.social_score;
      return new Date(b.event_date).getTime() - new Date(a.event_date).getTime();
    });
    return list;
  }, [events, category, search, sortBy]);

  const kpis = useMemo(() => ({
    total: filtered.length,
    grandes: filtered.filter((e) => e.importance >= 60).length,
    institucionais: filtered.filter((e) =>
      e.institutional_sources > 0 || e.sources?.some((s) => /\b(STF|TSE|PF|Senado|Câmara|Camara|Planalto|STJ|TCU|CGU|AGU|CNJ)\b/i.test(s.name)),
    ).length,
    altaRepercussao: filtered.filter((e) => e.social_score >= 60).length,
  }), [filtered]);

  const timeline = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      if (!e.event_date) return;
      const d = new Date(e.event_date);
      if (isNaN(d.getTime())) return;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    if (!from || !to) return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    const months: Array<[string, number]> = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cursor <= end && months.length < 120) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      months.push([k, map.get(k) ?? 0]);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [filtered, from, to]);
  const maxMonth = Math.max(1, ...timeline.map(([, v]) => v));

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Radio className="h-5 w-5 text-muted-foreground" /> Radar Político
        </h1>
        <p className="text-sm text-muted-foreground">
          Eventos políticos detectados por IA em fontes externas.
        </p>
      </header>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger className="w-[220px] h-9"><SelectValue placeholder="Candidato" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Selecione um candidato</SelectItem>
                {candidates?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>))}
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="w-[170px] h-9">
                <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Mais recente</SelectItem>
                <SelectItem value="importance">Maior importância</SelectItem>
                <SelectItem value="social">Maior repercussão</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar evento..."
                className="pl-8 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Button
              size="sm"
              onClick={() => searchMutation.mutate(false)}
              disabled={searchMutation.isPending || isJobRunning || candidateId === "all"}
              className="h-9"
            >
              {searchMutation.isPending || isJobRunning ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {isJobRunning ? "Coletando..." : "Buscar com IA"}
            </Button>
          </div>

          {/* Chips de período */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                variant={preset === p.id ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </Button>
            ))}
            {preset === "custom" && (
              <>
                <DateField date={customFrom} onChange={setCustomFrom} placeholder="Início" />
                <DateField date={customTo} onChange={setCustomTo} placeholder="Fim" />
              </>
            )}
            {lastFetchedAt && (
              <span className="text-[11px] text-muted-foreground self-center ml-auto">
                IA · {lastFetchedAt.toLocaleTimeString("pt-BR")}
                {" · "}
                <button
                  className="underline hover:no-underline"
                  onClick={() => searchMutation.mutate(true)}
                  disabled={searchMutation.isPending || isJobRunning}
                >
                  Atualizar
                </button>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Progresso do job em background */}
      {isJobRunning && jobStatus && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Coletando eventos em background ({jobStatus.processed_chunks}/{jobStatus.total_chunks || "?"} períodos)
              </span>
              <span className="text-muted-foreground tabular-nums">
                {nfBR.format(jobStatus.events_count)} eventos · {jobStatus.progress}%
              </span>
            </div>
            <Progress value={jobStatus.progress} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground">
              A janela pode ser fechada — o job continua no servidor. Volte mais tarde.
            </p>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Eventos" value={kpis.total} />
        <Kpi label="Grandes" value={kpis.grandes} hint="importância ≥ 60" />
        <Kpi label="Institucionais" value={kpis.institucionais} hint="STF · TSE · PF · TCU" />
        <Kpi label="Alta repercussão" value={kpis.altaRepercussao} hint="social ≥ 60" />
      </section>

      {/* Timeline */}
      {timeline.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Distribuição mensal
            </div>
            <div className="overflow-x-auto pb-1">
            <div className="grid gap-2 items-end h-20 min-w-full" style={{ gridTemplateColumns: `repeat(${timeline.length}, minmax(18px, 1fr))` }}>
              {timeline.map(([k, count]) => {
                const [y, m] = k.split("-");
                return (
                  <div key={k} className="flex flex-col items-center gap-1 h-full justify-end">
                    <div
                      className="w-full bg-foreground/80 rounded-sm transition-all"
                      style={{ height: `${(count / maxMonth) * 100}%`, minHeight: 2 }}
                      title={`${count} eventos`}
                    />
                    <span className="text-[10px] text-muted-foreground">{MONTHS_PT[Number(m) - 1]}/{y.slice(2)}</span>
                  </div>
                );
              })}
            </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      <section className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
          {searchMutation.isPending
            ? "Buscando eventos via IA..."
            : `${nfBR.format(filtered.length)} eventos`}
        </h2>

        {lastError && !searchMutation.isPending && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Falha na busca do Radar
              </div>
              <p className="text-sm text-destructive/90">{lastError.message}</p>
              {lastError.stack && (
                <pre className="max-h-40 overflow-auto rounded border border-destructive/20 bg-background/80 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                  {lastError.stack}
                </pre>
              )}
            </CardContent>
          </Card>
        )}

        {searchMutation.isPending ? (
          <div className="border rounded-md bg-card p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando eventos via IA...
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground">
              {["Consultando IA", "Processando eventos", "Atualizando cache"].map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", i === 0 ? "bg-foreground animate-pulse" : "bg-muted-foreground/40")} />
                  {step}
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="border rounded-md p-4 bg-background animate-pulse h-20" />
              ))}
            </div>
          </div>
        ) : events.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center space-y-2">
              <Sparkles className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Selecione um candidato e período, depois clique em <strong>Buscar com IA</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                A IA consulta fontes externas (STF, TSE, PF, grande imprensa) em tempo real.
              </p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento corresponde aos filtros.
            </CardContent>
          </Card>
        ) : (
          <div className="divide-y border rounded-md bg-card max-h-[70vh] overflow-y-auto">
            {filtered.map((e) => {
              const b = band(e.importance);
              return (
                <button
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className="w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1 flex-wrap">
                        <span className="font-mono">{fmtDate(e.event_date)}</span>
                        <span>·</span>
                        <span className="font-medium text-foreground/80">{e.category}</span>
                        <span>·</span>
                        <span>{nfBR.format(e.source_count)} fontes</span>
                        {e.institutional_sources > 0 && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-blue-500/40 text-blue-600 dark:text-blue-400">
                            Institucional
                          </Badge>
                        )}
                      </div>
                      <h3 className="text-sm font-medium leading-snug break-words [overflow-wrap:anywhere]">{e.title}</h3>
                      {e.summary && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words [overflow-wrap:anywhere]">{e.summary}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${b.tone}`}>
                        {b.label} · {e.importance}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        social {e.social_score}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Detail modal */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base leading-snug break-words [overflow-wrap:anywhere]">{selected.title}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-xs flex-wrap">
                  <span>{fmtDate(selected.event_date)}</span>
                  <span>·</span>
                  <Badge variant="outline" className="text-[10px]">{selected.category}</Badge>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Importância" value={selected.importance} />
                  <Stat label="Fontes" value={selected.source_count} />
                  <Stat label="Social" value={selected.social_score} />
                </div>
                {(() => {
                  const description =
                    (selected.summary && selected.summary.trim()) ||
                    (selected.description && selected.description.trim()) ||
                    (selected.content && selected.content.trim()) ||
                    "Descrição não disponível";
                  return (
                    <div>
                      <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Resumo</h4>
                      <p className="text-sm leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{description}</p>
                    </div>
                  );
                })()}
                {selected.sources?.length > 0 && (
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                      Fontes ({selected.sources.length})
                    </h4>
                    <ul className="space-y-1.5">
                      {selected.sources.map((s, i) => (
                        <li key={i}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm hover:underline flex items-center gap-1.5"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{s.name}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DateField({ date, onChange, placeholder }: { date?: Date; onChange: (d?: Date) => void; placeholder: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-7 text-xs justify-start font-normal", !date && "text-muted-foreground")}>
          <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
          {date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={onChange} initialFocus className={cn("p-3 pointer-events-auto")} />
      </PopoverContent>
    </Popover>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">{nfBR.format(value)}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{nfBR.format(value)}</div>
    </div>
  );
}
