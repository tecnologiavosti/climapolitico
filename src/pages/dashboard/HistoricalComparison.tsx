import { useEffect, useMemo, useState } from "react";
import { format, subDays, subMonths, subYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, GitCompareArrows, Loader2, Sparkles, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { DateRange } from "react-day-picker";
import {
  BarChart, Bar, LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
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

interface Candidate { id: string; full_name: string; }
interface PeriodResult {
  start: string; end: string;
  totalMentions?: number; totalEngagement?: number;
  sentimentPositive?: number; sentimentNegative?: number; sentimentNeutral?: number;
  dominantThemes?: { theme: string; mentions: number }[];
  regions?: { region: string; mentions: number }[];
  platforms?: { platform: string; mentions: number }[];
  daily?: { date: string; mentions: number }[];
  realtimeRecords?: number;
  historicalRecords?: number;
  completeness?: "full" | "partial" | "insufficient";
}
interface ComparisonResponse {
  candidate: { id: string; name: string; createdAt: string };
  periodA: PeriodResult;
  periodB: PeriodResult;
  deltas: { mentionsPct: number; mentionsAbs: number };
  aiAnalysis: { summary?: string; insights?: string[]; themeShift?: string; regionalShift?: string; sentimentShift?: string; alerts?: string[]; error?: string };
}

type Shortcut = "7d" | "30d" | "90d" | "6m" | "1y" | "same_period_last_year" | "total";

function toISO(d: Date | undefined): string {
  return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString() : "";
}
function toISOEnd(d: Date | undefined): string {
  return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)).toISOString() : "";
}

function shortcutRange(s: Shortcut): { from: Date; to: Date } {
  const to = new Date();
  switch (s) {
    case "7d": return { from: subDays(to, 7), to };
    case "30d": return { from: subDays(to, 30), to };
    case "90d": return { from: subDays(to, 90), to };
    case "6m": return { from: subMonths(to, 6), to };
    case "1y": return { from: subYears(to, 1), to };
    case "same_period_last_year": {
      const from = subYears(subDays(to, 30), 1);
      const t = subYears(to, 1);
      return { from, to: t };
    }
    case "total": return { from: new Date(2022, 0, 1), to };
  }
}

function RangeField({ label, value, onChange }: { label: string; value: DateRange | undefined; onChange: (r: DateRange | undefined) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value?.from ? (
              value.to ? `${format(value.from, "dd/MM/yyyy", { locale: ptBR })} → ${format(value.to, "dd/MM/yyyy", { locale: ptBR })}` : format(value.from, "dd/MM/yyyy", { locale: ptBR })
            ) : "Selecione um período"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="range" selected={value} onSelect={onChange} numberOfMonths={2} initialFocus className={cn("p-3 pointer-events-auto")} locale={ptBR} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CompletenessBadge({ c }: { c?: "full" | "partial" | "insufficient" }) {
  if (!c) return null;
  const label = c === "full" ? "Dados completos" : c === "partial" ? "Dados parciais" : "Insuficiente";
  const variant: "default" | "secondary" | "destructive" = c === "full" ? "default" : c === "partial" ? "secondary" : "destructive";
  return <Badge variant={variant}>{label}</Badge>;
}

function StatCard({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PeriodSummary({ label, p }: { label: string; p: PeriodResult }) {
  const total = p.totalMentions || 0;
  const pos = p.sentimentPositive || 0;
  const neg = p.sentimentNegative || 0;
  const neu = p.sentimentNeutral || 0;
  const classified = pos + neg + neu;
  const pct = (n: number) => classified > 0 ? Math.round((n / classified) * 100) : 0;
  const topTheme = p.dominantThemes?.[0]?.theme || "—";
  const topRegion = p.regions?.[0]?.region || "—";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">{label}</CardTitle>
          <CardDescription>{p.start?.slice(0,10)} → {p.end?.slice(0,10)}</CardDescription>
        </div>
        <CompletenessBadge c={p.completeness} />
      </CardHeader>
      <CardContent className="grid gap-3 grid-cols-2 md:grid-cols-3">
        <StatCard title="Menções" value={total.toLocaleString("pt-BR")} hint={`${p.realtimeRecords || 0} tempo real • ${p.historicalRecords || 0} históricos`} />
        <StatCard title="Engajamento" value={(p.totalEngagement || 0).toLocaleString("pt-BR")} />
        <StatCard title="Sentimento +" value={`${pct(pos)}%`} hint={`${pos.toLocaleString("pt-BR")} positivos`} />
        <StatCard title="Sentimento −" value={`${pct(neg)}%`} hint={`${neg.toLocaleString("pt-BR")} negativos`} />
        <StatCard title="Tema dominante" value={topTheme} />
        <StatCard title="Região líder" value={topRegion} />
      </CardContent>
    </Card>
  );
}

export default function HistoricalComparison() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState<string>("");
  const [rangeA, setRangeA] = useState<DateRange | undefined>({ from: subDays(new Date(), 60), to: subDays(new Date(), 30) });
  const [rangeB, setRangeB] = useState<DateRange | undefined>({ from: subDays(new Date(), 30), to: new Date() });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResponse | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("candidates").select("id, full_name").eq("status", "active").order("full_name");
      setCandidates(data || []);
      if (data && data.length > 0 && !candidateId) setCandidateId(data[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyShortcut = (target: "A" | "B", s: Shortcut) => {
    const r = shortcutRange(s);
    if (target === "A") setRangeA({ from: r.from, to: r.to });
    else setRangeB({ from: r.from, to: r.to });
  };

  const handleCompare = async () => {
    if (!candidateId) { toast.error("Selecione um candidato"); return; }
    if (!rangeA?.from || !rangeA?.to || !rangeB?.from || !rangeB?.to) { toast.error("Selecione os dois períodos"); return; }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("historical-comparison", {
        body: {
          candidateId,
          periodA: { start: toISO(rangeA.from), end: toISOEnd(rangeA.to) },
          periodB: { start: toISO(rangeB.from), end: toISOEnd(rangeB.to) },
        },
      });
      if (error) throw error;
      setResult(data as ComparisonResponse);
    } catch (e: any) {
      toast.error("Falha na comparação: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const dailyChart = useMemo(() => {
    if (!result) return [];
    const a = (result.periodA.daily || []).map((d, i) => ({ idx: i, dateA: d.date, mentionsA: d.mentions }));
    const b = (result.periodB.daily || []).map((d, i) => ({ idx: i, dateB: d.date, mentionsB: d.mentions }));
    const len = Math.max(a.length, b.length);
    return Array.from({ length: len }, (_, i) => ({ idx: i, ...a[i], ...b[i] }));
  }, [result]);

  const barChart = useMemo(() => {
    if (!result) return [];
    const pa = result.periodA, pb = result.periodB;
    return [
      { metric: "Menções", A: pa.totalMentions || 0, B: pb.totalMentions || 0 },
      { metric: "Engajamento", A: pa.totalEngagement || 0, B: pb.totalEngagement || 0 },
      { metric: "Positivo", A: pa.sentimentPositive || 0, B: pb.sentimentPositive || 0 },
      { metric: "Negativo", A: pa.sentimentNegative || 0, B: pb.sentimentNegative || 0 },
    ];
  }, [result]);

  const radarChart = useMemo(() => {
    if (!result) return [];
    const themes = new Set<string>();
    (result.periodA.dominantThemes || []).forEach(t => themes.add(t.theme));
    (result.periodB.dominantThemes || []).forEach(t => themes.add(t.theme));
    return Array.from(themes).map(theme => ({
      theme,
      A: result.periodA.dominantThemes?.find(t => t.theme === theme)?.mentions || 0,
      B: result.periodB.dominantThemes?.find(t => t.theme === theme)?.mentions || 0,
    }));
  }, [result]);

  const regionChart = useMemo(() => {
    if (!result) return [];
    const regs = new Set<string>();
    (result.periodA.regions || []).forEach(r => regs.add(r.region));
    (result.periodB.regions || []).forEach(r => regs.add(r.region));
    return Array.from(regs).map(region => ({
      region,
      A: result.periodA.regions?.find(r => r.region === region)?.mentions || 0,
      B: result.periodB.regions?.find(r => r.region === region)?.mentions || 0,
    }));
  }, [result]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Comparação Histórica IA</h1>
        </div>
        <p className="text-muted-foreground mt-1">Compare dois períodos arbitrários — inclusive anteriores ao cadastro do candidato. Quando necessário, dados históricos são coletados automaticamente de fontes públicas (GDELT/notícias).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>Escolha candidato e os dois períodos a comparar.</CardDescription>
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
          <RangeField label="Período A" value={rangeA} onChange={setRangeA} />
          <RangeField label="Período B" value={rangeB} onChange={setRangeB} />

          <div className="md:col-span-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">Atalhos B:</span>
            {(["7d","30d","90d","6m","1y","same_period_last_year","total"] as Shortcut[]).map(s => (
              <Button key={s} type="button" size="sm" variant="outline" onClick={() => applyShortcut("B", s)}>
                {s === "7d" ? "7 dias" : s === "30d" ? "30 dias" : s === "90d" ? "90 dias" : s === "6m" ? "6 meses" : s === "1y" ? "1 ano" : s === "same_period_last_year" ? "Mesmo período ano anterior" : "Total"}
              </Button>
            ))}
          </div>
          <div className="md:col-span-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">Atalhos A:</span>
            {(["7d","30d","90d","6m","1y","same_period_last_year","total"] as Shortcut[]).map(s => (
              <Button key={"a-"+s} type="button" size="sm" variant="ghost" onClick={() => applyShortcut("A", s)}>
                {s === "7d" ? "7 dias" : s === "30d" ? "30 dias" : s === "90d" ? "90 dias" : s === "6m" ? "6 meses" : s === "1y" ? "1 ano" : s === "same_period_last_year" ? "Mesmo período ano anterior" : "Total"}
              </Button>
            ))}
          </div>

          <div className="md:col-span-3">
            <Button onClick={handleCompare} disabled={loading} className="w-full md:w-auto">
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Coletando e comparando…</> : <><GitCompareArrows className="mr-2 h-4 w-4" />Comparar períodos</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" /><Skeleton className="h-48" />
        </div>
      )}

      {result && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <PeriodSummary label="Período A" p={result.periodA} />
            <PeriodSummary label="Período B" p={result.periodB} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />Análise IA</CardTitle>
              <CardDescription>
                Variação de menções: <span className={cn("font-semibold", result.deltas.mentionsPct >= 0 ? "text-green-600" : "text-red-600")}>
                  {result.deltas.mentionsPct >= 0 ? <TrendingUp className="inline h-4 w-4" /> : <TrendingDown className="inline h-4 w-4" />} {result.deltas.mentionsPct}% ({result.deltas.mentionsAbs.toLocaleString("pt-BR")})
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.aiAnalysis?.error && (
                <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{result.aiAnalysis.error}</p>
              )}
              {result.aiAnalysis?.summary && <p className="leading-relaxed">{result.aiAnalysis.summary}</p>}
              {result.aiAnalysis?.insights && result.aiAnalysis.insights.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Insights</p>
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    {result.aiAnalysis.insights.map((i, idx) => <li key={idx}>{i}</li>)}
                  </ul>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-3 text-sm">
                {result.aiAnalysis?.themeShift && <div><p className="font-semibold">Temas</p><p className="text-muted-foreground">{result.aiAnalysis.themeShift}</p></div>}
                {result.aiAnalysis?.regionalShift && <div><p className="font-semibold">Regiões</p><p className="text-muted-foreground">{result.aiAnalysis.regionalShift}</p></div>}
                {result.aiAnalysis?.sentimentShift && <div><p className="font-semibold">Sentimento</p><p className="text-muted-foreground">{result.aiAnalysis.sentimentShift}</p></div>}
              </div>
              {result.aiAnalysis?.alerts && result.aiAnalysis.alerts.length > 0 && (
                <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-sm font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" />Alertas</p>
                  <ul className="list-disc pl-5 mt-1 text-sm">
                    {result.aiAnalysis.alerts.map((a, idx) => <li key={idx}>{a}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Evolução temporal</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="idx" label={{ value: "Dia do período", position: "insideBottom", offset: -5 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="mentionsA" name="Período A" stroke="hsl(var(--primary))" dot={false} />
                    <Line type="monotone" dataKey="mentionsB" name="Período B" stroke="hsl(var(--destructive))" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Comparativo geral</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="metric" /><YAxis /><Tooltip /><Legend />
                    <Bar dataKey="A" name="Período A" fill="hsl(var(--primary))" />
                    <Bar dataKey="B" name="Período B" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Temas dominantes</CardTitle></CardHeader>
              <CardContent className="h-72">
                {radarChart.length >= 3 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarChart}>
                      <PolarGrid /><PolarAngleAxis dataKey="theme" /><PolarRadiusAxis />
                      <Radar name="Período A" dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.35} />
                      <Radar name="Período B" dataKey="B" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.35} />
                      <Legend /><Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground">Temas insuficientes para radar.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Comparação regional</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regionChart} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" /><YAxis dataKey="region" type="category" width={90} /><Tooltip /><Legend />
                    <Bar dataKey="A" name="Período A" fill="hsl(var(--primary))" />
                    <Bar dataKey="B" name="Período B" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {!loading && !result && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Configure os filtros acima e clique em <strong>Comparar períodos</strong>.</CardContent></Card>
      )}
    </div>
  );
}
