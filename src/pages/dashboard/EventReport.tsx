import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarDays, MessageSquare, TrendingUp, AlertTriangle, Lightbulb, BookOpen, Zap } from "lucide-react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface Reaction {
  reaction: string;
  type: 'positiva' | 'negativa' | 'neutra';
  intensity: 'alta' | 'media' | 'baixa';
}

interface TopComment {
  text: string;
  author: string;
  network: string;
  sentiment: string;
  likes: number;
  replies: number;
  date: string;
}

interface EventReport {
  overall_assessment: string;
  executive_summary: string;
  key_reactions: Reaction[];
  main_topics: string[];
  impact_analysis: string;
  immediate_actions: string[];
  lessons_learned: string[];
}

interface ReportResult {
  report: EventReport | null;
  message?: string;
  stats: { total: number; positive: number; negative: number; neutral: number; byNetwork: Record<string, number> };
  dailyVolume?: Record<string, { total: number; positive: number; negative: number; neutral: number }>;
  topComments?: TopComment[];
  candidate?: { full_name: string; party: string };
  period?: { startDate: string; endDate: string; eventName: string | null };
}

const assessmentConfig: Record<string, { label: string; class: string }> = {
  muito_positiva: { label: "Muito Positiva", class: "bg-green-600 text-white" },
  positiva: { label: "Positiva", class: "bg-green-500 text-white" },
  mista: { label: "Mista", class: "bg-yellow-500 text-white" },
  negativa: { label: "Negativa", class: "bg-red-500 text-white" },
  muito_negativa: { label: "Muito Negativa", class: "bg-red-700 text-white" },
};

const reactionTypeConfig: Record<string, string> = {
  positiva: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  negativa: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  neutra: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const intensityConfig: Record<string, string> = {
  alta: "border-red-300 dark:border-red-700",
  media: "border-yellow-300 dark:border-yellow-700",
  baixa: "border-blue-300 dark:border-blue-700",
};

const sentimentColors: Record<string, string> = {
  Positivo: "text-green-600 dark:text-green-400",
  Negativo: "text-red-600 dark:text-red-400",
  Neutro: "text-muted-foreground",
};

const EventReportPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [eventName, setEventName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { data: candidates = [] } = useQuery({
    queryKey: ['candidates-for-event', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('id, full_name, party').eq('user_id', user!.id).order('full_name');
      if (error) throw error;
      return data || [];
    },
    
  });

  const handleGenerate = async () => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    if (!startDate || !endDate) { toast.error("Defina o período do evento"); return; }

    setIsLoading(true);
    setResult(null);
    try {
      const sDate = new Date(startDate);
      sDate.setHours(0, 0, 0, 0);
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);

      const { data, error } = await supabase.functions.invoke('analyze-event-repercussion', {
        body: {
          candidateId: selectedCandidate,
          startDate: sDate.toISOString(),
          endDate: eDate.toISOString(),
          eventName: eventName || undefined,
        },
      });
      if (error) throw error;
      setResult(data);
      if (!data.report) toast.info(data.message || "Nenhum comentário encontrado.");
      else toast.success("Relatório gerado com sucesso!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Erro ao gerar relatório");
    } finally {
      setIsLoading(false);
    }
  };

  const report = result?.report;
  const stats = result?.stats;
  const assessment = report ? assessmentConfig[report.overall_assessment] || assessmentConfig.mista : null;

  return (
    <div className="space-y-6">
      <div>
        <HelpTooltip text="Veja se um evento (debate, entrevista, comício) ajudou ou atrapalhou seu candidato.">
        <h1 className="text-3xl font-bold">Relatório de Evento</h1>
      </HelpTooltip>
        <p className="text-muted-foreground mt-1">Analise a repercussão de entrevistas, eventos ou falas específicas.</p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="w-full sm:w-[280px]">
                <SelectValue placeholder="Selecione um candidato" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}{c.party ? ` (${c.party})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Nome do evento (ex: Entrevista no Jornal X)"
              value={eventName}
              onChange={e => setEventName(e.target.value)}
              className="w-full sm:w-[300px]"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Data Início</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[180px]" />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Data Fim</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[180px]" />
            </div>
            <Button onClick={handleGenerate} disabled={isLoading || !selectedCandidate || !startDate || !endDate}>
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando...</> : <><CalendarDays className="mr-2 h-4 w-4" />Gerar Relatório</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* No data */}
      {result && !report && (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum comentário no período</h3>
            <p className="text-muted-foreground">{result.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {report && stats && (
        <div className="space-y-6">
          {/* Header with assessment */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">{result.period?.eventName || 'Repercussão do Período'}</h2>
                  <p className="text-sm text-muted-foreground">
                    {result.candidate?.full_name} • {result.period?.startDate?.substring(0, 10)} a {result.period?.endDate?.substring(0, 10)}
                  </p>
                </div>
                <Badge className={`text-base px-4 py-1 ${assessment?.class}`}>{assessment?.label}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-3xl font-bold">{stats.total}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Positivos</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.positive}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Negativos</p>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400">{stats.negative}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Neutros</p>
              <p className="text-3xl font-bold text-muted-foreground">{stats.neutral}</p>
            </CardContent></Card>
          </div>

          {/* Executive Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />Resumo Executivo</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">{report.executive_summary}</p>
            </CardContent>
          </Card>

          {/* Key Reactions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" />Principais Reações</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {report.key_reactions.map((r, i) => (
                  <div key={i} className={`border rounded-lg p-3 ${intensityConfig[r.intensity] || ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={reactionTypeConfig[r.type]}>{r.type}</Badge>
                      <Badge variant="outline" className="text-xs">intensidade: {r.intensity}</Badge>
                    </div>
                    <p className="text-sm">{r.reaction}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Main Topics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />Temas Mais Discutidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {report.main_topics.map((t, i) => (
                  <Badge key={i} variant="secondary" className="text-sm px-3 py-1">{t}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Impact Analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Análise de Impacto</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">{report.impact_analysis}</p>
            </CardContent>
          </Card>

          {/* Immediate Actions */}
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary"><Lightbulb className="h-5 w-5" />Ações Recomendadas</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {report.immediate_actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{i + 1}</span>
                    <span className="text-sm">{a}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Lessons Learned */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" />Lições para Eventos Futuros</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {report.lessons_learned.map((l, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground">•</span>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Top Comments */}
          {result.topComments && result.topComments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Comentários Mais Relevantes</CardTitle>
                <CardDescription>Ordenados por engajamento</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {result.topComments.map((c, i) => (
                    <div key={i} className="border rounded-lg p-3 bg-muted/30">
                      <p className="text-sm mb-2">"{c.text}"</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {c.author && <span>@{c.author}</span>}
                        <Badge variant="outline" className="text-xs">{c.network}</Badge>
                        {c.sentiment && <span className={sentimentColors[c.sentiment] || ''}>{c.sentiment}</span>}
                        {c.likes > 0 && <span>👍 {c.likes}</span>}
                        {c.replies > 0 && <span>💬 {c.replies}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Daily Volume */}
          {result.dailyVolume && Object.keys(result.dailyVolume).length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Volume Diário</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(result.dailyVolume).sort().map(([day, vol]) => {
                    const maxDay = Math.max(...Object.values(result.dailyVolume!).map(v => v.total), 1);
                    const pct = (vol.total / maxDay) * 100;
                    return (
                      <div key={day} className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground w-24">{day}</span>
                        <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden flex">
                          <div className="bg-green-500 h-full" style={{ width: `${vol.total > 0 ? (vol.positive / vol.total) * pct : 0}%` }} />
                          <div className="bg-yellow-400 h-full" style={{ width: `${vol.total > 0 ? (vol.neutral / vol.total) * pct : 0}%` }} />
                          <div className="bg-red-500 h-full" style={{ width: `${vol.total > 0 ? (vol.negative / vol.total) * pct : 0}%` }} />
                        </div>
                        <span className="text-sm font-medium w-12 text-right">{vol.total}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default EventReportPage;
