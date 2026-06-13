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
import {
  Loader2, ExternalLink, RefreshCw, Radio, CalendarIcon, Search, Sparkles, Download, FileJson, FileSpreadsheet,
} from "lucide-react";
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
  { id: "today", label: "Hoje", days: 1 },
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "90d", label: "3 meses", days: 90 },
  { id: "180d", label: "6 meses", days: 180 },
  { id: "365d", label: "1 ano", days: 365 },
  { id: "custom", label: "Personalizado", days: 0 },
];

const nfBR = new Intl.NumberFormat("pt-BR");

function importanceBand(value: number): { label: string; tone: string } {
  if (value > 75) return { label: "Grande", tone: "bg-foreground text-background" };
  if (value >= 45) return { label: "Médio", tone: "bg-muted text-foreground border" };
  return { label: "Pequeno", tone: "bg-background text-muted-foreground border" };
}

function sentimentTone(s: RadarEvent["sentiment"]) {
  if (s === "positivo") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
  if (s === "negativo") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  return "bg-muted text-muted-foreground border";
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function pct(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function toCSV(rows: RadarEvent[]) {
  const head = ["data","titulo","categoria","sentimento","importancia","social","fontes","artigos","tags","resumo"];
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.event_date,
      r.title,
      r.category,
      r.sentiment,
      Math.round(r.importance),
      Math.round(r.social_score),
      r.source_count,
      r.cluster_size,
      (r.ai_tags || []).join("|"),
      (r.summary || "").replace(/\s+/g, " ").slice(0, 500),
    ].map(esc).join(","),
  );
  return head.join(",") + "\n" + lines.join("\n");
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function RadarPolitico() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("all");
  const [preset, setPreset] = useState<string>("90d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [category, setCategory] = useState<string>("all");
  const [sentiment, setSentiment] = useState<string>("all");
  const [importanceFilter, setImportanceFilter] = useState<string>("all");
  const [onlyInstitutional, setOnlyInstitutional] = useState(false);
  const [onlyHighRelevance, setOnlyHighRelevance] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RadarEvent | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // AI side-panel
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");

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

  const filteredEvents = useMemo(() => {
    let ev = events ?? [];
    if (sentiment !== "all") ev = ev.filter((e) => e.sentiment === sentiment);
    if (onlyInstitutional) ev = ev.filter((e) => e.sources_json?.some((s) => s.type === "institutional"));
    if (onlyHighRelevance) ev = ev.filter((e) => e.importance >= 70);
    if (importanceFilter === "grande") ev = ev.filter((e) => e.importance >= 70);
    else if (importanceFilter === "medio") ev = ev.filter((e) => e.importance >= 40 && e.importance < 70);
    else if (importanceFilter === "pequeno") ev = ev.filter((e) => e.importance >= 20 && e.importance < 40);
    return ev;
  }, [events, sentiment, importanceFilter, onlyInstitutional, onlyHighRelevance]);

  const { data: health } = useQuery({
    queryKey: ["radar-health", user?.id, candidateId],
    enabled: !!user?.id,
    queryFn: async () => {
      let q = supabase
        .from("radar_pipeline_health" as any)
        .select("candidate_id,year,events_found,expected_min,status")
        .eq("user_id", user!.id)
        .eq("year", new Date().getFullYear());
      if (candidateId !== "all") q = q.eq("candidate_id", candidateId);
      const { data } = await q;
      return ((data ?? []) as unknown) as Array<{ candidate_id: string; events_found: number; expected_min: number; status: string }>;
    },
  });

  const healthSummary = useMemo(() => {
    const rows = health ?? [];
    if (rows.length === 0) return null;
    const order = { FAIL: 0, WARNING: 1, OK: 2 } as Record<string, number>;
    const worst = rows.slice().sort((a, b) => order[a.status] - order[b.status])[0];
    const totalFound = rows.reduce((s, r) => s + (r.events_found || 0), 0);
    const totalMin = rows.reduce((s, r) => s + (r.expected_min || 0), 0);
    return { status: worst.status, found: totalFound, min: totalMin };
  }, [health]);

  const kpis = useMemo(() => {
    const ev = filteredEvents;
    const total = ev.length;
    return {
      total,
      grandes: ev.filter((e) => e.importance >= 70).length,
      institucional: ev.filter((e) => e.sources_json?.some((s) => s.type === "institutional")).length,
      altaRepercussao: ev.filter((e) => e.social_score >= 60).length,
    };
  }, [filteredEvents]);

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

  // 10k goal (ano corrente)
  const yearlyGoal = 10000;
  const yearlyFound = useMemo(() => {
    const y = new Date().getFullYear();
    return (events ?? []).filter((e) => new Date(e.event_date).getFullYear() === y).length;
  }, [events]);
  const goalPct = Math.min(100, Math.round((yearlyFound / yearlyGoal) * 100));
  const goalTone = goalPct >= 80 ? "bg-emerald-500" : goalPct >= 30 ? "bg-amber-500" : "bg-red-500";

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
      toast.success("Pipeline iniciado em segundo plano");
      setTimeout(() => refetch(), 4000);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar");
    } finally {
      setRefreshing(false);
    }
  }

  async function runAiAnalysis() {
    setAiOpen(true);
    setAiLoading(true);
    setAiAnalysis("");
    try {
      const slim = filteredEvents.slice(0, 50).map((e) => ({
        title: e.title,
        date: e.event_date,
        category: e.category,
        importance: e.importance,
        social: e.social_score,
      }));
      const candName =
        candidateId === "all"
          ? "todos os candidatos"
          : candidates?.find((c) => c.id === candidateId)?.full_name ?? "candidato";
      const { data, error } = await supabase.functions.invoke("analyze-radar-events", {
        body: {
          events: slim,
          start_date: from?.toISOString().slice(0, 10),
          end_date: to?.toISOString().slice(0, 10),
          candidate_name: candName,
        },
      });
      if (error) throw error;
      setAiAnalysis((data as any)?.analysis ?? "Sem resposta.");
    } catch (e: any) {
      const msg = e?.message ?? "Erro na análise";
      if (msg.includes("429")) toast.error("Limite de uso atingido. Tente novamente em instantes.");
      else if (msg.includes("402")) toast.error("Créditos de IA esgotados.");
      else toast.error(msg);
      setAiAnalysis(`**Erro:** ${msg}`);
    } finally {
      setAiLoading(false);
    }
  }

  function exportCSV() {
    download(`radar-politico-${Date.now()}.csv`, toCSV(filteredEvents), "text/csv;charset=utf-8");
    toast.success("CSV exportado");
  }
  function exportJSON() {
    download(`radar-politico-${Date.now()}.json`, JSON.stringify(filteredEvents, null, 2), "application/json");
    toast.success("JSON exportado");
  }
  function exportAnalysis() {
    if (!aiAnalysis) return;
    download(`analise-radar-${Date.now()}.txt`, aiAnalysis, "text/plain;charset=utf-8");
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={runAiAnalysis}>
              <Sparkles className="h-4 w-4 mr-2" /> Análise IA
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={filteredEvents.length === 0}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportJSON} disabled={filteredEvents.length === 0}>
              <FileJson className="h-4 w-4 mr-2" /> JSON
            </Button>
            <Button variant="default" size="sm" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Atualizar</span>
            </Button>
          </div>
        </div>

        {/* Atalhos de período */}
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
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os candidatos</SelectItem>
              {candidates?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>))}
            </SelectContent>
          </Select>

          {preset === "custom" && (
            <>
              <DateField date={customFrom} onChange={setCustomFrom} placeholder="Data início" />
              <DateField date={customTo} onChange={setCustomTo} placeholder="Data fim" />
            </>
          )}

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
            </SelectContent>
          </Select>

          <Select value={sentiment} onValueChange={setSentiment}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Sentimento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos sentimentos</SelectItem>
              <SelectItem value="positivo">Positivo</SelectItem>
              <SelectItem value="negativo">Negativo</SelectItem>
              <SelectItem value="neutro">Neutro</SelectItem>
            </SelectContent>
          </Select>

          <Select value={importanceFilter} onValueChange={setImportanceFilter}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Importância" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda importância</SelectItem>
              <SelectItem value="grande">Grandes</SelectItem>
              <SelectItem value="medio">Médios</SelectItem>
              <SelectItem value="pequeno">Pequenos</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={onlyHighRelevance ? "default" : "outline"}
            size="sm" className="h-9 text-xs"
            onClick={() => setOnlyHighRelevance((v) => !v)}
          >
            Só alta relevância
          </Button>
          <Button
            variant={onlyInstitutional ? "default" : "outline"}
            size="sm" className="h-9 text-xs"
            onClick={() => setOnlyInstitutional((v) => !v)}
          >
            Só institucional
          </Button>

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

      {/* Pipeline status + meta anual */}
      <div className="border rounded-md p-3 bg-card space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            {healthSummary && (
              <span
                className={`px-2 py-0.5 rounded font-medium ${
                  healthSummary.status === "OK"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : healthSummary.status === "WARNING"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-red-500/15 text-red-700 dark:text-red-400"
                }`}
              >
                Pipeline {healthSummary.status}
              </span>
            )}
            <span className="text-muted-foreground">
              Meta anual: <strong className="text-foreground">{nfBR.format(yearlyFound)}</strong> / {nfBR.format(yearlyGoal)} eventos
            </span>
          </div>
          <span className="text-muted-foreground font-mono">{goalPct}%</span>
        </div>
        <div className="h-2 w-full bg-muted rounded overflow-hidden">
          <div className={`h-full ${goalTone} transition-all`} style={{ width: `${goalPct}%` }} />
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Eventos" value={kpis.total} hint={`${pct(kpis.total, kpis.total)} do filtro`} />
        <KpiCard label="Alta relevância" value={kpis.grandes} hint={`${pct(kpis.grandes, kpis.total)} · ≥70`} />
        <KpiCard label="Institucional" value={kpis.institucional} hint={`${pct(kpis.institucional, kpis.total)} · STF · TSE · PF`} />
        <KpiCard label="Alta repercussão" value={kpis.altaRepercussao} hint={`${pct(kpis.altaRepercussao, kpis.total)} · social ≥ 60`} />
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
                      title={`${nfBR.format(count)} eventos`}
                    />
                    <span className="text-[10px] text-muted-foreground">{MONTHS_PT[Number(m) - 1]}/{y.slice(2)}</span>
                    <span className="text-[10px] font-mono text-foreground/70">{nfBR.format(count)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
          {isLoading ? "Carregando..." : `${nfBR.format(filteredEvents.length)} eventos`}
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento. Clique em "Atualizar" para rodar o pipeline.
            </CardContent>
          </Card>
        ) : (
          <div className="divide-y border rounded-md bg-card max-h-[70vh] overflow-y-auto">
            {filteredEvents.map((e) => {
              const band = importanceBand(e.importance);
              return (
                <button
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className="w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1 flex-wrap">
                        <span className="font-mono">{formatDate(e.event_date)}</span>
                        <span>·</span>
                        <span className="font-medium text-foreground/80">{e.category}</span>
                        <span>·</span>
                        <span>{nfBR.format(e.source_count)} fontes</span>
                        {e.cluster_size > 1 && (
                          <>
                            <span>·</span>
                            <span>{nfBR.format(e.cluster_size)} artigos</span>
                          </>
                        )}
                        <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] border ${sentimentTone(e.sentiment)}`}>
                          {e.sentiment}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium leading-snug truncate">{e.title}</h3>
                      {e.summary && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{e.summary}</p>
                      )}
                      {e.ai_tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {e.ai_tags.slice(0, 5).map((t, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {t}
                            </span>
                          ))}
                        </div>
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
                <SheetDescription className="flex items-center gap-2 text-xs flex-wrap">
                  <span>{formatDate(selected.event_date)}</span>
                  <span>·</span>
                  <Badge variant="outline" className="text-[10px]">{selected.category}</Badge>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${sentimentTone(selected.sentiment)}`}>
                    {selected.sentiment}
                  </span>
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
                {selected.ai_tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selected.ai_tags.map((t, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted">{t}</span>
                    ))}
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

      {/* Painel de Análise IA */}
      <Sheet open={aiOpen} onOpenChange={setAiOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Análise IA do Radar
            </SheetTitle>
            <SheetDescription>
              {filteredEvents.length === 0
                ? "Sem eventos filtrados."
                : `Baseada em ${Math.min(50, filteredEvents.length)} eventos do filtro atual.`}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {aiLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Gerando análise...
              </div>
            ) : aiAnalysis ? (
              <>
                <article className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
                  {aiAnalysis}
                </article>
                <Button variant="outline" size="sm" onClick={exportAnalysis}>
                  <Download className="h-4 w-4 mr-2" /> Exportar análise (.txt)
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sem análise.</p>
            )}
            <Button variant="ghost" size="sm" onClick={runAiAnalysis} disabled={aiLoading}>
              <RefreshCw className="h-3.5 w-3.5 mr-2" /> Regenerar
            </Button>
          </div>
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
        <div className="text-2xl font-semibold mt-1 tabular-nums">{nfBR.format(value)}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{nfBR.format(value)}</div>
    </div>
  );
}
