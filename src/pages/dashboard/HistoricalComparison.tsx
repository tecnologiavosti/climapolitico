// IA de Pesquisa Histórica Externa — não usa dados internos.
// Pesquisa GDELT + Google News + Wikipedia e gera análise narrativa com IA.
import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon, GitCompareArrows, Loader2, Sparkles, AlertTriangle,
  Megaphone, CalendarDays, Quote, Zap, Activity, ArrowRight, Globe2, BookOpen, ExternalLink,
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

interface ExternalDoc {
  title: string;
  url: string;
  date: string;
  source: string;
  domain?: string;
  snippet?: string;
}

interface AnalysisResponse {
  candidate?: { id: string; name: string; party?: string };
  period?: { start: string; end: string };
  sources?: { gdelt: number; googleNews: number; wikipedia: boolean; total: number };
  wikipedia?: { extract: string; url: string } | null;
  documents?: ExternalDoc[];
  analysis: {
    popularClimate?: string;
    topThemes?: { theme: string; description: string }[];
    voicesOfThePeople?: string[];
    eventsImpact?: { name: string; date: string; description: string; impact: string }[];
    perceptionShift?: { from: string; to: string; explanation: string };
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

  const handleAnalyze = async () => {
    if (!candidateId) { toast.error("Selecione um candidato"); return; }
    if (!range?.from || !range?.to) { toast.error("Selecione o período"); return; }
    setLoading(true);
    setProgressMessage("Pesquisando GDELT, Google News e Wikipedia...");
    setResult(null);
    const t1 = window.setTimeout(() => setProgressMessage("Consolidando fontes externas..."), 3000);
    const t2 = window.setTimeout(() => setProgressMessage("Gerando análise narrativa histórica com IA..."), 7000);
    try {
      const { data, error } = await supabase.functions.invoke("historical-comparison", {
        body: { candidateId, startDate: toISOStart(range.from), endDate: toISOEnd(range.to) },
      });
      if (error) throw error;
      setResult(data as AnalysisResponse);
    } catch (e: any) {
      toast.error("Falha na pesquisa: " + (e?.message || e));
    } finally {
      window.clearTimeout(t1); window.clearTimeout(t2);
      setProgressMessage(""); setLoading(false);
    }
  };

  const analysis = result?.analysis;
  const sources = result?.sources;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">IA de Pesquisa Histórica</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Pesquisa automática em fontes externas (GDELT, Google News, Wikipedia) e síntese narrativa com IA — independente das coletas internas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pesquisa externa</CardTitle>
          <CardDescription>Selecione o candidato e o período histórico. A IA buscará notícias e contexto público do período.</CardDescription>
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
            <p className="text-sm font-medium">Período histórico (data inicial → data final)</p>
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
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Pesquisando…</>
                : <><Sparkles className="mr-2 h-4 w-4" />Pesquisar e gerar análise</>}
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
                <p className="font-medium">{progressMessage || "Pesquisando..."}</p>
                <p className="text-sm text-muted-foreground">Buscando em múltiplas fontes públicas, sem usar a base interna.</p>
              </div>
            </CardContent>
          </Card>
          <Skeleton className="h-40" /><Skeleton className="h-56" /><Skeleton className="h-56" />
        </div>
      )}

      {result && (
        <>
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

          {/* Fontes externas */}
          {sources && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Globe2 className="h-5 w-5 text-primary" />Fontes externas pesquisadas</CardTitle>
                <CardDescription>Esta análise NÃO utiliza coletas internas. Todos os dados vêm de fontes públicas externas.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">GDELT (notícias históricas)</p>
                  <p className="text-2xl font-bold">{sources.gdelt}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Google News</p>
                  <p className="text-2xl font-bold">{sources.googleNews}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Wikipedia</p>
                  <p className="text-2xl font-bold">{sources.wikipedia ? "✓" : "—"}</p>
                </div>
                <div className="rounded-lg border p-3 bg-primary/5">
                  <p className="text-xs text-muted-foreground">Total de documentos</p>
                  <p className="text-2xl font-bold">{sources.total}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Contexto Wikipedia */}
          {result.wikipedia && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" />Contexto biográfico (Wikipedia)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{result.wikipedia.extract}</p>
                <a href={result.wikipedia.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                  Ver na Wikipedia <ExternalLink className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>
          )}

          {/* Clima Popular */}
          {analysis?.popularClimate && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Clima popular da época</CardTitle>
                <CardDescription>Como o povo falava do candidato no período.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="leading-relaxed text-sm md:text-base">{analysis.popularClimate}</p>
              </CardContent>
            </Card>
          )}

          {/* Temas mais discutidos */}
          {analysis?.topThemes && analysis.topThemes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" />Temas mais discutidos</CardTitle>
                <CardDescription>Tópicos que dominavam o debate público no período.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {analysis.topThemes.map((t, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <p className="font-semibold text-sm mb-1">{t.theme}</p>
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Como o povo falava */}
          {analysis?.voicesOfThePeople && analysis.voicesOfThePeople.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Quote className="h-5 w-5 text-primary" />Como o povo falava</CardTitle>
                <CardDescription>Expressões e frases recorrentes da época.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {analysis.voicesOfThePeople.map((v, i) => (
                  <Badge key={i} variant="outline" className="text-sm italic px-3 py-1">"{v}"</Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Eventos que impactaram */}
          {analysis?.eventsImpact && analysis.eventsImpact.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />Eventos que impactaram</CardTitle>
                <CardDescription>Acontecimentos detectados nas fontes externas e seu impacto na percepção.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {analysis.eventsImpact.map((e, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-semibold text-sm">{e.name}</p>
                      <span className="text-xs text-muted-foreground">{e.date}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{e.description}</p>
                    <p className="text-sm"><span className="font-medium text-primary">Impacto:</span> {e.impact}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Mudança de Narrativa */}
          {analysis?.perceptionShift && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" />Mudança de narrativa</CardTitle>
                <CardDescription>Como o debate evoluiu ao longo do período.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-center">
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-1">Antes</p>
                    <p className="font-semibold text-sm">{analysis.perceptionShift.from}</p>
                  </div>
                  <ArrowRight className="h-6 w-6 text-muted-foreground hidden md:block mx-auto" />
                  <div className="rounded-lg border p-4 bg-primary/5">
                    <p className="text-xs text-muted-foreground mb-1">Depois</p>
                    <p className="font-semibold text-sm">{analysis.perceptionShift.to}</p>
                  </div>
                </div>
                <p className="text-sm">{analysis.perceptionShift.explanation}</p>
              </CardContent>
            </Card>
          )}

          {/* Análise IA Final */}
          {analysis?.aiFinal && (
            <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />Análise histórica final</CardTitle>
                <CardDescription>Síntese narrativa profunda gerada pela IA a partir das fontes externas.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="leading-relaxed text-sm md:text-base whitespace-pre-line">{analysis.aiFinal}</p>
                {analysis.dataNote && (
                  <p className="text-xs text-muted-foreground italic mt-3">{analysis.dataNote}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Documentos consultados */}
          {result.documents && result.documents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" />Documentos consultados</CardTitle>
                <CardDescription>Amostra das fontes externas usadas pela IA (ordenadas por data).</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto divide-y">
                  {result.documents.map((d, i) => (
                    <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" className="block py-2 hover:bg-muted/30 px-2 rounded transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium line-clamp-2 flex-1">{d.title}</p>
                        <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-1" />
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] py-0">{d.source}</Badge>
                        {d.domain && <span>{d.domain}</span>}
                        <span>·</span>
                        <span>{d.date.slice(0, 10)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
