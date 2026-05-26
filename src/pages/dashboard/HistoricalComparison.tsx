// Análise Histórica Narrativa IA — período atual vs equivalente anterior.
import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon, GitCompareArrows, Loader2, Sparkles, TrendingUp, TrendingDown,
  AlertTriangle, Megaphone, Users, CalendarDays, MessageSquareQuote, Zap, ArrowRight,
  Activity, Quote,
} from "lucide-react";
import { DateRange } from "react-day-picker";

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

interface ThemeEvolution {
  theme: string;
  mentionsCurrent: number;
  mentionsPrevious: number;
  deltaPct: number;
  sentNegPct: number;
  sentPosPct: number;
  sentNeuPct: number;
}

interface AnalysisResponse {
  candidate?: { id: string; name: string; party?: string };
  summary?: {
    candidate: string;
    currentPeriod: { start: string; end: string; days: number; label: string };
    previousPeriod: { start: string; end: string; days: number; label: string };
    kpi: {
      currentMentions: number;
      previousMentions: number;
      mentionsDeltaPct: number;
      climateLevel: string;
      climateEmoji: string;
      sentPosPct: number;
      sentNegPct: number;
      sentNeuPct: number;
      currentSentimentScore: number;
      previousSentimentScore: number;
    };
    themesEvolution: ThemeEvolution[];
    voicesOfThePeople: { phrases: { phrase: string; count: number }[]; words: { word: string; count: number }[]; totalAnalyzed: number };
    groups: { group: string; mentions: number; theme: string; sentiment: number }[];
    eventsImpact: {
      name: string; date: string; type: string; description?: string | null;
      mentionsBefore: number; mentionsAfter: number; mentionsDelta: number;
      sentimentBefore: number; sentimentAfter: number; sentimentDelta: number;
    }[];
    smartTimeline: { date: string; type: string; label: string; description?: string | null; mentions?: number }[];
  };
  analysis: {
    popularClimate?: { level: string; narrative: string };
    perceptionShift?: { from: string; to: string; explanation: string };
    groupsNarrative?: { group: string; narrative: string }[];
    eventsNarrative?: { event: string; impact: string }[];
    timelineNarrative?: { date: string; title: string; narrative: string }[];
    aiFinal?: string;
    dataNote?: string;
  } | null;
  aiNotice?: { errorType: string; userMessage: string } | null;
  aiError?: { errorType: string; userMessage: string } | null;
  provider?: string;
  fromCache?: boolean;
}

function toISOStart(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
}
function toISOEnd(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)).toISOString();
}

const CLIMATE_COLOR: Record<string, string> = {
  "Muito favorável": "bg-emerald-500/15 text-emerald-700 border-emerald-500/40",
  "Favorável": "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  "Neutro": "bg-muted text-muted-foreground border-border",
  "Desfavorável": "bg-rose-500/10 text-rose-600 border-rose-500/30",
  "Muito desfavorável": "bg-rose-500/15 text-rose-700 border-rose-500/40",
};

export default function HistoricalComparison() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState<string>("");
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 30), to: new Date() });
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

  const handleAnalyze = async () => {
    if (!candidateId) { toast.error("Selecione um candidato"); return; }
    if (!range?.from || !range?.to) { toast.error("Selecione o período"); return; }
    setLoading(true);
    setProgressMessage("Carregando interações e eventos do período...");
    setResult(null);
    const t1 = window.setTimeout(() => setProgressMessage("Agregando temas, grupos e eventos..."), 2000);
    const t2 = window.setTimeout(() => setProgressMessage("Gerando análise narrativa com IA..."), 5000);
    try {
      const { data, error } = await supabase.functions.invoke("historical-comparison", {
        body: { candidateId, startDate: toISOStart(range.from), endDate: toISOEnd(range.to) },
      });
      if (error) throw error;
      setResult(data as AnalysisResponse);
    } catch (e: any) {
      toast.error("Falha na análise: " + (e?.message || e));
    } finally {
      window.clearTimeout(t1); window.clearTimeout(t2);
      setProgressMessage(""); setLoading(false);
    }
  };

  const summary = result?.summary;
  const analysis = result?.analysis;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Análise Histórica Narrativa IA</h1>
        </div>
        <p className="text-muted-foreground mt-1">Entenda como a percepção pública evoluiu ao longo do tempo.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>O sistema compara automaticamente o período selecionado com o equivalente do ano anterior (ou imediatamente anterior, se não houver dados).</CardDescription>
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
                  {range?.from ? (range.to
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

          <div className="md:col-span-3">
            <Button onClick={handleAnalyze} disabled={loading} className="w-full md:w-auto">
              {loading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando narrativa histórica…</>
                : <><Sparkles className="mr-2 h-4 w-4" />Gerar análise narrativa</>}
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
                <p className="font-medium">{progressMessage || "Analisando..."}</p>
                <p className="text-sm text-muted-foreground">Os dados são agregados no servidor antes da IA.</p>
              </div>
            </CardContent>
          </Card>
          <Skeleton className="h-40" /><Skeleton className="h-56" /><Skeleton className="h-56" />
        </div>
      )}

      {result && summary && (
        <>
          {/* Aviso IA */}
          {result.aiError && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />Falha na análise de IA
                </CardTitle>
                <CardDescription>{result.aiError.userMessage}</CardDescription>
              </CardHeader>
            </Card>
          )}
          {result.aiNotice && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-primary" />
                <p className="text-sm">{result.aiNotice.userMessage}</p>
              </CardContent>
            </Card>
          )}

          {/* Períodos comparados */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" />Períodos comparados</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-center">
              <div className="rounded-lg border p-4 bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">{summary.previousPeriod.label}</p>
                <p className="font-semibold">{format(new Date(summary.previousPeriod.start), "dd/MM/yyyy")} → {format(new Date(summary.previousPeriod.end), "dd/MM/yyyy")}</p>
                <p className="text-sm text-muted-foreground mt-2">{summary.kpi.previousMentions.toLocaleString("pt-BR")} menções</p>
              </div>
              <ArrowRight className="h-6 w-6 text-muted-foreground hidden md:block mx-auto" />
              <div className="rounded-lg border p-4 bg-primary/5">
                <p className="text-xs text-muted-foreground mb-1">{summary.currentPeriod.label}</p>
                <p className="font-semibold">{format(new Date(summary.currentPeriod.start), "dd/MM/yyyy")} → {format(new Date(summary.currentPeriod.end), "dd/MM/yyyy")}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {summary.kpi.currentMentions.toLocaleString("pt-BR")} menções
                  <span className={cn("ml-2 font-semibold", summary.kpi.mentionsDeltaPct >= 0 ? "text-emerald-600" : "text-rose-600")}>
                    {summary.kpi.mentionsDeltaPct >= 0 ? "+" : ""}{summary.kpi.mentionsDeltaPct}%
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Clima Popular */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Clima popular</CardTitle>
              <CardDescription>Como o povo falava do candidato no período selecionado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{summary.kpi.climateEmoji}</span>
                <Badge className={cn("text-sm px-3 py-1 border", CLIMATE_COLOR[summary.kpi.climateLevel] || CLIMATE_COLOR["Neutro"])}>
                  {analysis?.popularClimate?.level || summary.kpi.climateLevel}
                </Badge>
                <div className="flex gap-3 text-xs ml-auto">
                  <span className="text-emerald-600">{summary.kpi.sentPosPct}% positivo</span>
                  <span className="text-muted-foreground">{summary.kpi.sentNeuPct}% neutro</span>
                  <span className="text-rose-600">{summary.kpi.sentNegPct}% negativo</span>
                </div>
              </div>
              {analysis?.popularClimate?.narrative && (
                <p className="leading-relaxed text-sm md:text-base">{analysis.popularClimate.narrative}</p>
              )}
            </CardContent>
          </Card>

          {/* Mudança de Percepção */}
          {analysis?.perceptionShift && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" />Mudança de percepção</CardTitle>
                <CardDescription>O que mudou entre os dois períodos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-center">
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">Antes</p>
                    <p className="font-semibold">{analysis.perceptionShift.from}</p>
                  </div>
                  <ArrowRight className="h-6 w-6 text-muted-foreground hidden md:block mx-auto" />
                  <div className="rounded-lg border p-4 bg-primary/5">
                    <p className="text-xs text-muted-foreground mb-1">Agora</p>
                    <p className="font-semibold">{analysis.perceptionShift.to}</p>
                  </div>
                </div>
                <p className="text-sm">{analysis.perceptionShift.explanation}</p>
              </CardContent>
            </Card>
          )}

          {/* Evolução das Narrativas (Temas) */}
          {summary.themesEvolution?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" />Evolução das narrativas</CardTitle>
                <CardDescription>Temas dominantes com variação em relação ao período anterior.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.themesEvolution.map((t) => (
                  <div key={t.theme} className="grid grid-cols-12 items-center gap-2 py-2 border-b last:border-0">
                    <div className="col-span-12 md:col-span-3 font-medium text-sm">{t.theme}</div>
                    <div className="col-span-4 md:col-span-2 text-sm">{t.mentionsCurrent.toLocaleString("pt-BR")}</div>
                    <div className={cn("col-span-4 md:col-span-2 text-sm font-semibold flex items-center gap-1",
                      t.deltaPct > 0 ? "text-emerald-600" : t.deltaPct < 0 ? "text-rose-600" : "text-muted-foreground")}>
                      {t.deltaPct > 0 ? <TrendingUp className="h-3 w-3" /> : t.deltaPct < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                      {t.deltaPct >= 0 ? "+" : ""}{t.deltaPct}%
                    </div>
                    <div className="col-span-4 md:col-span-5">
                      <div className="flex h-2 rounded overflow-hidden bg-muted">
                        <div className="bg-emerald-500" style={{ width: `${t.sentPosPct}%` }} />
                        <div className="bg-muted-foreground/40" style={{ width: `${t.sentNeuPct}%` }} />
                        <div className="bg-rose-500" style={{ width: `${t.sentNegPct}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t.sentPosPct}% pos · {t.sentNeuPct}% neu · {t.sentNegPct}% neg
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Como o povo falava */}
          {(summary.voicesOfThePeople?.phrases?.length > 0 || summary.voicesOfThePeople?.words?.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Quote className="h-5 w-5 text-primary" />Como o povo falava</CardTitle>
                <CardDescription>Expressões e palavras mais frequentes em posts, comentários e respostas ({summary.voicesOfThePeople.totalAnalyzed.toLocaleString("pt-BR")} textos analisados).</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Expressões recorrentes</p>
                  <div className="space-y-2">
                    {summary.voicesOfThePeople.phrases.slice(0, 12).map((p, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-sm">
                        <span className="italic">"{p.phrase}"</span>
                        <Badge variant="outline" className="text-xs">{p.count}</Badge>
                      </div>
                    ))}
                    {summary.voicesOfThePeople.phrases.length === 0 && <p className="text-sm text-muted-foreground">Sem expressões recorrentes detectadas.</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Palavras frequentes</p>
                  <div className="flex flex-wrap gap-2">
                    {summary.voicesOfThePeople.words.slice(0, 24).map((w, i) => {
                      const size = Math.min(24, 12 + Math.log2(w.count) * 2);
                      return <span key={i} className="text-foreground" style={{ fontSize: `${size}px` }}>{w.word}</span>;
                    })}
                    {summary.voicesOfThePeople.words.length === 0 && <p className="text-sm text-muted-foreground">Sem palavras suficientes.</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bolhas e Grupos */}
          {summary.groups?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Users className="h-5 w-5 text-primary" />Bolhas e grupos</CardTitle>
                <CardDescription>Grupos discutindo o candidato, tema dominante e sentimento.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {summary.groups.map((g, i) => {
                  const aiG = analysis?.groupsNarrative?.find(x => x.group === g.group);
                  const sentColor = g.sentiment > 0.2 ? "text-emerald-600" : g.sentiment < -0.2 ? "text-rose-600" : "text-muted-foreground";
                  const sentLabel = g.sentiment > 0.2 ? "Positivo" : g.sentiment < -0.2 ? "Negativo" : "Neutro";
                  return (
                    <div key={i} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="secondary">{g.group}</Badge>
                        <Badge variant="outline" className={cn("text-xs", sentColor)}>{sentLabel}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{g.mentions.toLocaleString("pt-BR")} menções · tema: <span className="font-medium text-foreground">{g.theme}</span></p>
                      {aiG?.narrative && <p className="text-sm">{aiG.narrative}</p>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Eventos que Impactaram */}
          {summary.eventsImpact?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />Eventos que impactaram</CardTitle>
                <CardDescription>Eventos detectados e seu efeito nas menções e sentimento (janela ±7 dias).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.eventsImpact.map((e, i) => {
                  const aiE = analysis?.eventsNarrative?.find(x => x.event === e.name);
                  return (
                    <div key={i} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <p className="font-semibold text-sm">{e.name}</p>
                        <Badge variant="outline" className="text-xs">{e.type}</Badge>
                        <span className="text-xs text-muted-foreground">{e.date}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                        <div>
                          <span className="text-muted-foreground">Menções: </span>
                          <span className="font-medium">{e.mentionsBefore} → {e.mentionsAfter}</span>
                          <span className={cn("ml-1 font-semibold", e.mentionsDelta >= 0 ? "text-emerald-600" : "text-rose-600")}>
                            ({e.mentionsDelta >= 0 ? "+" : ""}{e.mentionsDelta})
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Sentimento: </span>
                          <span className="font-medium">{e.sentimentBefore} → {e.sentimentAfter}</span>
                          <span className={cn("ml-1 font-semibold", e.sentimentDelta >= 0 ? "text-emerald-600" : "text-rose-600")}>
                            ({e.sentimentDelta >= 0 ? "+" : ""}{e.sentimentDelta}pp)
                          </span>
                        </div>
                      </div>
                      {aiE?.impact && <p className="text-sm">{aiE.impact}</p>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Linha do Tempo Inteligente */}
          {summary.smartTimeline?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" />Linha do tempo inteligente</CardTitle>
                <CardDescription>Eventos detectados e picos de menções com mudanças narrativas.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="relative border-l-2 border-border ml-3 space-y-4">
                  {summary.smartTimeline.map((t, i) => {
                    const aiT = analysis?.timelineNarrative?.find(x => x.date === t.date);
                    return (
                      <li key={i} className="ml-4">
                        <div className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-primary" />
                        <p className="text-xs text-muted-foreground">{t.date}</p>
                        <p className="font-semibold text-sm">{t.label}</p>
                        {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                        {aiT?.narrative && <p className="text-sm mt-1 italic text-primary/80">↪ {aiT.narrative}</p>}
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* Análise IA Final */}
          {analysis?.aiFinal && (
            <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />Análise IA final</CardTitle>
                <CardDescription>Síntese narrativa profunda gerada por IA.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="leading-relaxed text-sm md:text-base whitespace-pre-line">{analysis.aiFinal}</p>
                {analysis.dataNote && (
                  <p className="text-xs text-muted-foreground italic mt-3">{analysis.dataNote}</p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
