import { useEffect, useState } from "react";
import { format, subDays, subMonths, subYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon, GitCompareArrows, Loader2, Sparkles, TrendingUp, TrendingDown,
  AlertTriangle, Megaphone, Users, CalendarDays, Tags, ArrowRight,
  MapPinned, Heart, Activity,
} from "lucide-react";
import { DateRange } from "react-day-picker";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Candidate { id: string; full_name: string }

interface DetectedChange { type: string; title: string; description: string }
interface NarrativeBlock { label: string; evidence?: string }
interface PerceptionShift { group: string; shift: string }
interface AssociatedEvent { name: string; date?: string; type?: string; impact?: string }
interface TimelineInsight { date?: string; title: string; description?: string }
interface RegionalInsight { region: string; movement: string; explanation?: string }
interface DemographicInsight { group: string; trend: string }
interface EmotionalInsight { emotion: string; movement: string; explanation?: string }
interface NarrativeShift { from: string; to: string; explanation?: string }

interface AdvancedAgg {
  sentimentTimeline?: { week: string; pos: number; neg: number; neu: number }[];
  regionalShift?: { region: string; mentionsEarly: number; mentionsLate: number; mentionsDelta: number; sentimentDelta: number; direction: string }[];
  emotionalShift?: { emotion: string; early: number; late: number; delta: number }[];
  eventTimeline?: { date: string; type: string; label: string; description?: string | null; location?: string | null; mentions?: number }[];
}

interface AnalysisResponse {
  candidate?: { id: string; name: string; createdAt: string; party?: string; region?: string };
  period?: { start: string; end: string; mid: string };
  summary?: { advanced?: AdvancedAgg; [k: string]: any };
  hasMinimumData?: boolean;
  analysis: {
    summary?: string;
    narrativeShift?: NarrativeShift;
    detectedChanges?: DetectedChange[];
    narratives?: { early?: NarrativeBlock; late?: NarrativeBlock };
    perceptionShifts?: PerceptionShift[];
    associatedEvents?: AssociatedEvent[];
    timelineInsights?: TimelineInsight[];
    regionalInsights?: RegionalInsight[];
    demographicInsights?: DemographicInsight[];
    emotionalInsights?: EmotionalInsight[];
    dominantThemesByPeriod?: { early?: string[]; late?: string[] };
    dataNote?: string;
  } | null;
  aiError?: { errorType: string; message: string; provider: string; userMessage: string } | null;
  aiNotice?: { errorType: string; message: string; provider: string; userMessage: string } | null;
  provider?: string;
  fromCache?: boolean;
}

type Shortcut = "7d" | "30d" | "90d" | "6m" | "1y" | "same_year_ago" | "total";

function toISOStart(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
}
function toISOEnd(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)).toISOString();
}

function shortcutRange(s: Shortcut): { from: Date; to: Date } {
  const to = new Date();
  switch (s) {
    case "7d": return { from: subDays(to, 7), to };
    case "30d": return { from: subDays(to, 30), to };
    case "90d": return { from: subDays(to, 90), to };
    case "6m": return { from: subMonths(to, 6), to };
    case "1y": return { from: subYears(to, 1), to };
    case "same_year_ago": return { from: subYears(subDays(to, 30), 1), to: subYears(to, 1) };
    case "total": return { from: new Date(2022, 0, 1), to };
  }
}

const CHANGE_ICON: Record<string, { color: string; label: string }> = {
  growth_support: { color: "text-emerald-600", label: "Crescimento de apoio" },
  rejection_increase: { color: "text-rose-600", label: "Aumento de rejeição" },
  polarization: { color: "text-amber-600", label: "Polarização" },
  regional_shift: { color: "text-indigo-600", label: "Mudança regional" },
  thematic_shift: { color: "text-violet-600", label: "Mudança temática" },
  narrative_shift: { color: "text-cyan-600", label: "Mudança narrativa" },
  event_impact: { color: "text-orange-600", label: "Evento marcante" },
};

export default function HistoricalComparison() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState<string>("");
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 365), to: new Date() });
  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("candidates").select("id, full_name").eq("status", "active").order("full_name");
      setCandidates(data || []);
      if (data && data.length > 0) setCandidateId(data[0].id);
    })();
  }, []);

  const applyShortcut = (s: Shortcut) => {
    const r = shortcutRange(s);
    setRange({ from: r.from, to: r.to });
  };

  const handleAnalyze = async () => {
    if (!candidateId) { toast.error("Selecione um candidato"); return; }
    if (!range?.from || !range?.to) { toast.error("Selecione o período"); return; }
    setLoading(true);
    setProgressMessage("Analisando evolução histórica...");
    setResult(null);
    const progressTimer = window.setTimeout(() => setProgressMessage("Consolidando sentimentos, temas, regiões e eventos..."), 1800);
    const narrativeTimer = window.setTimeout(() => setProgressMessage("Gerando narrativa política a partir do resumo estruturado..."), 4200);
    try {
      const { data, error } = await supabase.functions.invoke("historical-comparison", {
        body: { candidateId, startDate: toISOStart(range.from), endDate: toISOEnd(range.to) },
      });
      if (error) throw error;
      setResult(data as AnalysisResponse);
    } catch (e: any) {
      toast.error("Falha na análise: " + (e?.message || e));
    } finally {
      window.clearTimeout(progressTimer);
      window.clearTimeout(narrativeTimer);
      setProgressMessage("");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Comparação Histórica IA</h1>
        </div>
        <p className="text-muted-foreground mt-1">Analise como a percepção pública evoluiu ao longo do tempo.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>Selecione o candidato e o intervalo de tempo a analisar — pode incluir períodos anteriores ao cadastro.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">Candidato</p>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {candidates.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <p className="text-sm font-medium">Período (data inicial → data final)</p>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !range && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {range?.from ? (
                    range.to
                      ? `${format(range.from, "dd/MM/yyyy", { locale: ptBR })} → ${format(range.to, "dd/MM/yyyy", { locale: ptBR })}`
                      : format(range.from, "dd/MM/yyyy", { locale: ptBR })
                  ) : "Selecione o período"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} initialFocus locale={ptBR} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>

          <div className="md:col-span-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">Atalhos:</span>
            {(["7d","30d","90d","6m","1y","same_year_ago","total"] as Shortcut[]).map(s => (
              <Button key={s} type="button" size="sm" variant="outline" onClick={() => applyShortcut(s)}>
                {s === "7d" ? "7 dias" : s === "30d" ? "30 dias" : s === "90d" ? "90 dias" : s === "6m" ? "6 meses" : s === "1y" ? "1 ano" : s === "same_year_ago" ? "Mesmo período ano anterior" : "Total"}
              </Button>
            ))}
          </div>

          <div className="md:col-span-3">
            <Button onClick={handleAnalyze} disabled={loading} className="w-full md:w-auto">
              {loading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando evolução com IA…</>
                : <><Sparkles className="mr-2 h-4 w-4" />Analisar evolução</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="grid gap-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-6 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-medium">{progressMessage || "Analisando evolução histórica..."}</p>
                <p className="text-sm text-muted-foreground">Os dados são pré-processados antes da IA para evitar envio de conteúdo bruto.</p>
              </div>
            </CardContent>
          </Card>
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      )}

      {result && (
        <>
          {/* Erro de IA — separado de "sem dados" */}
          {result.aiError && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />Falha na análise de IA
                </CardTitle>
                <CardDescription>{result.aiError.userMessage}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                <p>Tipo: <span className="font-mono">{result.aiError.errorType}</span> • Provedor: {result.aiError.provider}</p>
                <p className="mt-1">Os dados do período foram coletados normalmente — apenas a geração da narrativa falhou.</p>
              </CardContent>
            </Card>
          )}

          {result.aiNotice && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />Análise local aplicada
                </CardTitle>
                <CardDescription>{result.aiNotice.userMessage}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                <p>Tipo: <span className="font-mono">{result.aiNotice.errorType}</span> • Provedor original: {result.aiNotice.provider}</p>
              </CardContent>
            </Card>
          )}

          {/* Resumo narrativo */}
          {result.analysis && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />Análise narrativa</CardTitle>
                <CardDescription>
                  {result.candidate?.name} • {result.period && `${format(new Date(result.period.start), "dd/MM/yyyy")} → ${format(new Date(result.period.end), "dd/MM/yyyy")}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="leading-relaxed text-sm md:text-base whitespace-pre-line">
                  {result.analysis.summary}
                </p>
                {result.analysis.dataNote && (
                  <p className="text-xs text-muted-foreground italic">{result.analysis.dataNote}</p>
                )}
              </CardContent>
            </Card>
          )}


          {/* Mudanças detectadas */}
          {result.analysis?.detectedChanges && result.analysis.detectedChanges.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" />Mudanças detectadas</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {result.analysis.detectedChanges.map((c, i) => {
                  const meta = CHANGE_ICON[c.type] || { color: "text-muted-foreground", label: c.type };
                  return (
                    <div key={i} className="rounded-lg border p-3 bg-card">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingDown className={cn("h-4 w-4", meta.color)} />
                        <p className="text-sm font-semibold">{c.title}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{meta.label}</p>
                      <p className="text-sm">{c.description}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Narrativas identificadas */}
          {result.analysis?.narratives && (result.analysis.narratives.early || result.analysis.narratives.late) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" />Narrativas identificadas</CardTitle>
                <CardDescription>Como o discurso público em torno do candidato se transformou.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-stretch">
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">Início do período</p>
                    <p className="text-lg font-semibold">{result.analysis.narratives.early?.label || "—"}</p>
                    {result.analysis.narratives.early?.evidence && (
                      <p className="text-xs text-muted-foreground mt-2 italic">{result.analysis.narratives.early.evidence}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-center">
                    <ArrowRight className="h-6 w-6 text-muted-foreground hidden md:block" />
                  </div>
                  <div className="rounded-lg border p-4 bg-primary/5">
                    <p className="text-xs text-muted-foreground mb-1">Fim do período</p>
                    <p className="text-lg font-semibold">{result.analysis.narratives.late?.label || "—"}</p>
                    {result.analysis.narratives.late?.evidence && (
                      <p className="text-xs text-muted-foreground mt-2 italic">{result.analysis.narratives.late.evidence}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Mudanças de percepção */}
          {result.analysis?.perceptionShifts && result.analysis.perceptionShifts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Users className="h-5 w-5 text-primary" />Mudanças de percepção</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {result.analysis.perceptionShifts.map((p, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <Badge variant="secondary" className="mb-2">{p.group}</Badge>
                    <p className="text-sm">{p.shift}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Eventos associados */}
          {result.analysis?.associatedEvents && result.analysis.associatedEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" />Eventos associados</CardTitle>
                <CardDescription>Momentos que influenciaram a percepção pública.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {result.analysis.associatedEvents.map((e, i) => (
                    <li key={i} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-semibold text-sm">{e.name}</p>
                        {e.type && <Badge variant="outline" className="text-xs">{e.type}</Badge>}
                        {e.date && <span className="text-xs text-muted-foreground">{e.date}</span>}
                      </div>
                      {e.impact && <p className="text-sm text-muted-foreground">{e.impact}</p>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Temas dominantes por período */}
          {result.analysis?.dominantThemesByPeriod && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Tags className="h-5 w-5 text-primary" />Temas dominantes por período</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Início do período</p>
                  <div className="flex flex-wrap gap-2">
                    {(result.analysis.dominantThemesByPeriod.early || []).map((t, i) => (
                      <Badge key={i} variant="secondary">{t}</Badge>
                    ))}
                    {(!result.analysis.dominantThemesByPeriod.early || result.analysis.dominantThemesByPeriod.early.length === 0) && (
                      <span className="text-sm text-muted-foreground">Sem temas destacados.</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Fim do período</p>
                  <div className="flex flex-wrap gap-2">
                    {(result.analysis.dominantThemesByPeriod.late || []).map((t, i) => (
                      <Badge key={i}>{t}</Badge>
                    ))}
                    {(!result.analysis.dominantThemesByPeriod.late || result.analysis.dominantThemesByPeriod.late.length === 0) && (
                      <span className="text-sm text-muted-foreground">Sem temas destacados.</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
