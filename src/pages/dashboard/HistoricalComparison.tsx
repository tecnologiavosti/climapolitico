// IA de Pesquisa Histórica — relatório de inteligência política factual.
// Combina conhecimento histórico da IA com referências externas (GDELT/Google News/Wikipedia).
// NÃO usa dados internos. NÃO mede sentimento popular.
import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon, GitCompareArrows, Loader2, Sparkles, AlertTriangle,
  CalendarDays, Landmark, Globe2, BookOpen, ExternalLink, Building2,
  Newspaper, Clock, Tags, Gavel, ScrollText, FileText,
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
  title: string; url: string; date: string; source: string; domain?: string; snippet?: string;
}

interface AnalysisResponse {
  candidate?: { id: string; name: string; party?: string };
  period?: { start: string; end: string };
  sources?: { gdelt: number; googleNews: number; wikipedia: boolean; total: number };
  wikipedia?: { extract: string; url: string } | null;
  documents?: ExternalDoc[];
  analysis: {
    historicalContext?: { role: string; relevance: string };
    politicalScene?: { federalGovernment: string; mainDebates: string[]; environment: string };
    timeline?: { date: string; title: string; description: string; relevance: string }[];
    associatedThemes?: { theme: string; description: string }[];
    politicalImpact?: { institutional: string; governmental: string; influence: string };
    historicalInterpretation?: string;
    executiveSummary?: string;
    dataNote?: string;
  } | null;
  aiError?: { errorType: string; userMessage: string } | null;
  provider?: string;
  fromCache?: boolean;
}

const toISOStart = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
const toISOEnd = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)).toISOString();

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
    setProgressMessage("Pesquisando contexto histórico...");
    setResult(null);
    const t1 = window.setTimeout(() => setProgressMessage("Consolidando referências externas..."), 3000);
    const t2 = window.setTimeout(() => setProgressMessage("Gerando relatório de inteligência política..."), 7000);
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
          Relatório de inteligência política factual. Contexto histórico, cenário institucional, eventos relevantes e interpretação consolidada — sem usar coletas internas nem inferir opiniões populares.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pesquisa histórica</CardTitle>
          <CardDescription>Selecione o político e o período. O sistema combinará conhecimento histórico consolidado com referências externas públicas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">Político</p>
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
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando relatório…</>
                : <><Sparkles className="mr-2 h-4 w-4" />Gerar relatório histórico</>}
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
                <p className="font-medium">{progressMessage || "Processando..."}</p>
                <p className="text-sm text-muted-foreground">Análise factual independente da base interna.</p>
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
                  <AlertTriangle className="h-5 w-5" />Falha na geração do relatório
                </CardTitle>
                <CardDescription>{result.aiError.userMessage}</CardDescription>
              </CardHeader>
            </Card>
          )}

          {/* 1. CONTEXTO HISTÓRICO */}
          {analysis?.historicalContext && (
            <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" />Contexto histórico</CardTitle>
                <CardDescription>Posição institucional e relevância política no período.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border p-3 bg-background/60">
                  <p className="text-xs text-muted-foreground mb-1">Cargo / posição institucional</p>
                  <p className="font-semibold text-sm">{analysis.historicalContext.role}</p>
                </div>
                <p className="text-sm leading-relaxed">{analysis.historicalContext.relevance}</p>
              </CardContent>
            </Card>
          )}

          {/* 2. CENÁRIO POLÍTICO DO PERÍODO */}
          {analysis?.politicalScene && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" />Cenário político do período</CardTitle>
                <CardDescription>Governo, debates e ambiente institucional do momento.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Governo federal</p>
                  <p className="text-sm">{analysis.politicalScene.federalGovernment}</p>
                </div>
                {analysis.politicalScene.mainDebates?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Principais debates nacionais</p>
                    <div className="flex flex-wrap gap-2">
                      {analysis.politicalScene.mainDebates.map((d, i) => (
                        <Badge key={i} variant="secondary" className="text-sm">{d}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Ambiente político</p>
                  <p className="text-sm leading-relaxed">{analysis.politicalScene.environment}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 3. LINHA DO TEMPO */}
          {analysis?.timeline && analysis.timeline.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />Linha do tempo — eventos relevantes</CardTitle>
                <CardDescription>Acontecimentos factuais relacionados ao político no período.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="relative border-l border-border ml-2 space-y-4">
                  {analysis.timeline.map((e, i) => (
                    <li key={i} className="ml-4">
                      <span className="absolute -left-1.5 w-3 h-3 bg-primary rounded-full mt-1.5" />
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{e.date}</Badge>
                        <p className="font-semibold text-sm">{e.title}</p>
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">{e.description}</p>
                      <p className="text-sm"><span className="font-medium text-primary">Relevância:</span> {e.relevance}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* 4. TEMAS ASSOCIADOS */}
          {analysis?.associatedThemes && analysis.associatedThemes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Tags className="h-5 w-5 text-primary" />Temas associados</CardTitle>
                <CardDescription>Temas políticos mais conectados ao político no período.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {analysis.associatedThemes.map((t, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <p className="font-semibold text-sm mb-1 capitalize">{t.theme}</p>
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 5. IMPACTO POLÍTICO E INSTITUCIONAL */}
          {analysis?.politicalImpact && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Gavel className="h-5 w-5 text-primary" />Impacto político e institucional</CardTitle>
                <CardDescription>Consequências objetivas — sem especulação emocional.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Institucional</p>
                  <p className="text-sm">{analysis.politicalImpact.institutional}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Governamental</p>
                  <p className="text-sm">{analysis.politicalImpact.governmental}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Influência política</p>
                  <p className="text-sm">{analysis.politicalImpact.influence}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 6. INTERPRETAÇÃO HISTÓRICA */}
          {analysis?.historicalInterpretation && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><ScrollText className="h-5 w-5 text-primary" />Interpretação histórica</CardTitle>
                <CardDescription>Como o período é enquadrado por analistas e historiadores.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed whitespace-pre-line">{analysis.historicalInterpretation}</p>
              </CardContent>
            </Card>
          )}

          {/* 7. RESUMO EXECUTIVO */}
          {analysis?.executiveSummary && (
            <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />Resumo executivo</CardTitle>
                <CardDescription>Briefing final de inteligência política.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="leading-relaxed text-sm md:text-base whitespace-pre-line">{analysis.executiveSummary}</p>
                {analysis.dataNote && (
                  <p className="text-xs text-muted-foreground italic mt-3">{analysis.dataNote}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Biografia Wikipedia */}
          {result.wikipedia && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" />Biografia de referência (Wikipedia)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{result.wikipedia.extract}</p>
                <a href={result.wikipedia.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                  Ver na Wikipedia <ExternalLink className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>
          )}

          {/* Fontes externas */}
          {sources && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Globe2 className="h-5 w-5 text-primary" />Referências externas</CardTitle>
                <CardDescription>Fontes públicas consultadas — análise não depende delas, mas as utiliza quando disponíveis.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">GDELT</p>
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

          {/* Documentos consultados */}
          {result.documents && result.documents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Newspaper className="h-5 w-5 text-primary" />Documentos consultados</CardTitle>
                <CardDescription>Amostra das referências externas (ordenadas por data).</CardDescription>
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
                        <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{d.date.slice(0, 10)}</span>
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
