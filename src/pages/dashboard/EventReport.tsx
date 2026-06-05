import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarDays, MessageSquare, TrendingUp, AlertTriangle, Lightbulb, BookOpen, Zap, Users, Radio, Layers } from "lucide-react";
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

const EVENT_STOP_WORDS = new Set([
  'para','como','mais','muito','pela','pelo','isso','essa','esse','esta','este','entre','sobre','quando','onde','tambem','também','presidente','candidato','candidata','brasil','politica','política','governo','partido','povo','gente','tudo','todos','todas','agora','hoje','ontem','sempre','nunca','assim','porque','porquê','mesmo','quem','tem','tinha','foi','sao','são','dos','das','com','sem','por','seu','sua','meu','minha','nos','nas','que','dele','dela','aqui','ali','ainda','depois','antes','pouco','bom','boa','ruim','você','voce','eles','elas','dele','dela','ser','ter','vai','vou','era','pra','pro','não','nao','sim','cada','anos','contra','favor','https','http'
]);

const EVENT_PHRASES = [
  'jornal nacional','jn','globo','debate','entrevista','podcast','flow','roda viva','cnn','band','sbt','record','fantástico','fantastico','pronunciamento','discurso','comício','comicio','sabatin','live','tv','rádio','radio','congresso','senado','câmara','camara','stf'
];

type LocalInteraction = {
  comment_text: string | null;
  original_posted_at: string | null;
  created_at: string | null;
  likes_count: number | null;
  replies_count: number | null;
};

const normalizeEventText = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const tokenizeEventText = (text: string) => normalizeEventText(text).match(/[a-z0-9]{4,}/g) || [];

const titleFromPhrase = (phrase: string) => phrase.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function detectEventsFromInteractions(comments: LocalInteraction[], _candidateName: string): DetectedEvent[] {
  if (comments.length < 5) return [];

  const byDay = new Map<string, LocalInteraction[]>();
  comments.forEach((comment) => {
    const day = (comment.original_posted_at || comment.created_at || '').substring(0, 10);
    if (!day || !comment.comment_text) return;
    byDay.set(day, [...(byDay.get(day) || []), comment]);
  });

  const daysAsc = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const counts = daysAsc.map(([, rows]) => rows.length);
  const avg = counts.reduce((s, n) => s + n, 0) / Math.max(counts.length, 1);

  // Detecta picos (acima de 1.5x média e >= 4) e quedas abruptas (abaixo de 0.4x média do período anterior)
  const peakDays = daysAsc
    .map(([day, rows], i) => {
      // baseline: média dos 7 dias anteriores
      const prev = counts.slice(Math.max(0, i - 7), i);
      const baseline = prev.length > 0 ? prev.reduce((s, n) => s + n, 0) / prev.length : avg;
      const variation = baseline > 0 ? ((rows.length - baseline) / baseline) * 100 : 0;
      const isPeak = rows.length >= Math.max(4, avg * 1.5) && variation > 50;
      const isDrop = baseline >= 4 && variation < -60;
      return { day, rows, variation, baseline, isPeak, isDrop };
    })
    .filter(d => d.isPeak || d.isDrop)
    .sort((a, b) => Math.abs(b.variation) - Math.abs(a.variation))
    .slice(0, 20);

  return peakDays.map(({ day, rows, variation, isDrop }) => {
    const formatted = day.split('-').reverse().join('/');
    const sign = variation >= 0 ? '+' : '';
    const tag = isDrop ? 'Queda abrupta' : variation > 200 ? 'Explosão de menções' : 'Pico de menções';
    return {
      name: `${formatted} — ${tag}`,
      type: isDrop ? 'queda' : 'pico',
      keywords: [],
      start_date: day,
      end_date: day,
      mentions_estimate: rows.length,
      variation_pct: Math.round(variation),
      description: `${tag} em ${formatted} — ${rows.length} comentários (${sign}${Math.round(variation)}% vs. média anterior).`,
    };
  });
}

interface DetectedEvent {
  name: string;
  type: string;
  keywords: string[];
  start_date: string;
  end_date: string;
  mentions_estimate: number;
  variation_pct?: number;
  description: string;
}

const EventReportPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [detectedEvents, setDetectedEvents] = useState<DetectedEvent[]>([]);
  const [selectedEventIdx, setSelectedEventIdx] = useState<string>("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Enriquecimento: bolhas, temas dominantes (com sentimento) e origem do pico
  const enrichQueryKey = result?.period ? `${selectedCandidate}|${result.period.startDate}|${result.period.endDate}` : "";
  const { data: enrichment } = useQuery({
    queryKey: ["peak-enrichment", enrichQueryKey],
    enabled: !!result?.report && !!result?.period && !!selectedCandidate,
    queryFn: async () => {
      const p = result!.period!;
      const { data, error } = await supabase
        .from("social_interactions")
        .select("social_network, region, state, city, comment_text, sentiment_label")
        .eq("candidate_id", selectedCandidate)
        .or(`and(original_posted_at.gte.${p.startDate},original_posted_at.lte.${p.endDate}),and(original_posted_at.is.null,created_at.gte.${p.startDate},created_at.lte.${p.endDate})`)
        .limit(8000);
      if (error) throw error;
      const rows = data || [];
      const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      // Origem do pico (rede)
      const networkMap = new Map<string, number>();
      rows.forEach(r => { if (r.social_network) networkMap.set(r.social_network, (networkMap.get(r.social_network) || 0) + 1); });
      const networkOrigin = [...networkMap.entries()].sort((a, b) => b[1] - a[1]);

      // Bolhas detectadas (região + estado)
      const bubbleMap = new Map<string, number>();
      rows.forEach(r => {
        if (r.region) bubbleMap.set(r.region, (bubbleMap.get(r.region) || 0) + 1);
        else if (r.state) bubbleMap.set(r.state, (bubbleMap.get(r.state) || 0) + 1);
      });
      const bubbles = [...bubbleMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

      // Temas dominantes com sentimento (cruza main_topics × comentários)
      const topics = (result?.report?.main_topics || []).slice(0, 10);
      const themes = topics.map((topic) => {
        const ntopic = norm(topic);
        let total = 0, pos = 0, neg = 0, neu = 0;
        rows.forEach(r => {
          if (!r.comment_text) return;
          if (norm(r.comment_text).includes(ntopic)) {
            total++;
            if (r.sentiment_label === "positive") pos++;
            else if (r.sentiment_label === "negative") neg++;
            else if (r.sentiment_label === "neutral") neu++;
          }
        });
        const labeled = pos + neg + neu;
        return {
          topic,
          total,
          positivePct: labeled > 0 ? Math.round((pos / labeled) * 100) : 0,
          negativePct: labeled > 0 ? Math.round((neg / labeled) * 100) : 0,
          neutralPct: labeled > 0 ? Math.round((neu / labeled) * 100) : 0,
        };
      }).filter(t => t.total > 0).sort((a, b) => b.total - a.total);

      return { networkOrigin, bubbles, themes, totalSample: rows.length };
    },
    staleTime: 60_000,
  });



  const { data: candidates = [] } = useQuery({
    queryKey: ['candidates-for-event', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('id, full_name, party').eq('user_id', user!.id).order('full_name');
      if (error) throw error;
      return data || [];
    },
  });

  const fetchLocalEvents = async (): Promise<DetectedEvent[]> => {
    let fromISO: string;
    let toISO: string;
    if (startDate && endDate) {
      const s = new Date(startDate); s.setHours(0, 0, 0, 0);
      const e = new Date(endDate); e.setHours(23, 59, 59, 999);
      fromISO = s.toISOString();
      toISO = e.toISOString();
    } else {
      const since = new Date();
      since.setMonth(since.getMonth() - 6);
      fromISO = since.toISOString();
      toISO = new Date().toISOString();
    }
    const selectedCandidateData = candidates.find(candidate => candidate.id === selectedCandidate);

    const { data, error } = await supabase
      .from('social_interactions')
      .select('comment_text, original_posted_at, created_at, likes_count, replies_count')
      .eq('candidate_id', selectedCandidate)
      .or(`and(original_posted_at.gte.${fromISO},original_posted_at.lte.${toISO}),and(original_posted_at.is.null,created_at.gte.${fromISO},created_at.lte.${toISO})`)
      .not('comment_text', 'is', null)
      .order('original_posted_at', { ascending: false, nullsFirst: false })
      .limit(2000);

    if (error) throw error;
    return detectEventsFromInteractions((data || []) as LocalInteraction[], selectedCandidateData?.full_name || '');
  };

  const handleCandidateChange = (id: string) => {
    setSelectedCandidate(id);
    setDetectedEvents([]);
    setSelectedEventIdx("");
    setResult(null);
  };

  const refineEventCounts = async (events: DetectedEvent[]): Promise<DetectedEvent[]> => {
    if (events.length === 0) return events;
    const refined = await Promise.all(events.map(async (evt) => {
      try {
        const sDate = new Date(evt.start_date); sDate.setHours(0, 0, 0, 0);
        const eDate = new Date(evt.end_date); eDate.setHours(23, 59, 59, 999);
        let query = supabase
          .from('social_interactions')
          .select('id', { count: 'exact', head: true })
          .eq('candidate_id', selectedCandidate)
          .or(`and(original_posted_at.gte.${sDate.toISOString()},original_posted_at.lte.${eDate.toISOString()}),and(original_posted_at.is.null,created_at.gte.${sDate.toISOString()},created_at.lte.${eDate.toISOString()})`);
        const kws = (evt.keywords || []).filter(Boolean);
        if (kws.length > 0) {
          const orExpr = kws.map(k => `comment_text.ilike.*${k.replace(/[*,()]/g, '')}*`).join(',');
          query = query.or(orExpr);
        }
        const { count } = await query;
        return { ...evt, mentions_estimate: count ?? evt.mentions_estimate };
      } catch {
        return evt;
      }
    }));
    return refined;
  };

  const handleDetectEvents = async () => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    setIsDetecting(true);
    setDetectedEvents([]);
    setSelectedEventIdx("");
    try {
      const detected = await fetchLocalEvents();
      // Atualiza contagens com o total real do dia (mesma query usada no relatório),
      // pois a amostra local é limitada a 800 registros.
      const refined = (await refineEventCounts(detected)).map((evt) => {
        const formatted = evt.start_date.split('-').reverse().join('/');
        return {
          ...evt,
          description: `Pico de menções detectado em ${formatted} — ${evt.mentions_estimate} comentários nesse dia.`,
        };
      }).sort((a, b) => b.mentions_estimate - a.mentions_estimate);
      setDetectedEvents(refined);
      if (refined.length === 0) toast.info("Nenhum dia com pico detectado nos últimos meses.");
      else toast.success(`${refined.length} dia(s) com pico detectado(s)`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Erro ao detectar picos");
    } finally {
      setIsDetecting(false);
    }
  };

  const handleSelectEvent = (idx: string) => {
    setSelectedEventIdx(idx);
    const evt = detectedEvents[Number(idx)];
    if (evt) {
      setStartDate(evt.start_date);
      setEndDate(evt.end_date);
    }
  };

  const handleGenerate = async () => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    if (!startDate || !endDate) { toast.error("Defina o período do evento"); return; }

    const evt = selectedEventIdx ? detectedEvents[Number(selectedEventIdx)] : null;

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
          eventName: evt?.name || undefined,
          eventKeywords: evt?.keywords || undefined,
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
        <HelpTooltip text="Descubra os picos de menções do candidato: debates, entrevistas, viralizações e momentos que mais repercutiram nas redes.">
        <h1 className="text-3xl font-bold">Picos de Menções</h1>
      </HelpTooltip>
        <p className="text-muted-foreground mt-1">Identifique os momentos de maior repercussão do candidato nas redes sociais.</p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-row flex-wrap gap-3 items-end">
            <HelpTooltip text="Escolha o candidato cujo evento você quer analisar.">
              <Select value={selectedCandidate} onValueChange={handleCandidateChange}>
                <SelectTrigger className="w-[140px] sm:w-[280px]">
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
            </HelpTooltip>
            <HelpTooltip text="A IA varre comentários dos últimos 3 meses e identifica picos de menções (entrevistas, debates, viralizações) que tiveram repercussão.">
              <Button variant="outline" size="sm" className="sm:size-default" onClick={handleDetectEvents} disabled={isDetecting || !selectedCandidate}>
                {isDetecting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Detectando...</>
                  : <><Zap className="mr-2 h-4 w-4" />Picos</>}
              </Button>
            </HelpTooltip>
          </div>

          {detectedEvents.length > 0 && (
            <HelpTooltip text="Selecione um dia com pico de menções. Só os comentários desse dia serão analisados.">
              <Select value={selectedEventIdx} onValueChange={handleSelectEvent}>
                <SelectTrigger className="w-full sm:w-[480px]">
                  <SelectValue placeholder={`${detectedEvents.length} dia(s) com pico — escolha um`} />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  {detectedEvents.map((e, i) => (
                    <SelectItem key={i} value={String(i)} className="whitespace-normal break-words pr-8">
                      <span className="block text-sm leading-snug">
                        {e.name} — {e.mentions_estimate} menções
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </HelpTooltip>
          )}

          {selectedEventIdx && detectedEvents[Number(selectedEventIdx)] && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{detectedEvents[Number(selectedEventIdx)].name}</p>
              <p className="text-muted-foreground mt-1">{detectedEvents[Number(selectedEventIdx)].description}</p>
            </div>
          )}

          <div className="flex flex-row flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Data Início</label>
              <HelpTooltip text="Dia em que o evento começou.">
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[130px] sm:w-[180px]" />
              </HelpTooltip>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Data Fim</label>
              <HelpTooltip text="Até quando você quer analisar a repercussão.">
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[130px] sm:w-[180px]" />
              </HelpTooltip>
            </div>
            <HelpTooltip text="Clica aqui pra IA olhar tudo que falaram nesse período e te dizer se foi bom ou ruim.">
              <Button onClick={handleGenerate} disabled={isLoading || !selectedCandidate || !startDate || !endDate}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando...</> : <><CalendarDays className="mr-2 h-4 w-4" />Gerar Relatório</>}
              </Button>
            </HelpTooltip>
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
            <HelpTooltip text="Total de comentários coletados durante o evento."><Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-3xl font-bold">{stats.total}</p>
            </CardContent></Card></HelpTooltip>
            <HelpTooltip text="Quantos comentários foram elogios ou apoios."><Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Positivos</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.positive}</p>
            </CardContent></Card></HelpTooltip>
            <HelpTooltip text="Quantos comentários foram críticas ou ataques."><Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Negativos</p>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400">{stats.negative}</p>
            </CardContent></Card></HelpTooltip>
            <HelpTooltip text="Comentários sem opinião clara, nem elogio nem crítica."><Card><CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">Neutros</p>
              <p className="text-3xl font-bold text-muted-foreground">{stats.neutral}</p>
            </CardContent></Card></HelpTooltip>
          </div>

          {/* Executive Summary */}
          <Card>
            <CardHeader>
              <HelpTooltip text="Resumão em poucas linhas: o que aconteceu e qual foi a reação geral do povo.">
                <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />Resumo Executivo</CardTitle>
              </HelpTooltip>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">{report.executive_summary}</p>
            </CardContent>
          </Card>

          {/* Key Reactions */}
          <Card>
            <CardHeader>
              <HelpTooltip text="As reações mais marcantes do povo: o que mais chamou atenção, pra bem ou pra mal.">
                <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" />Principais Reações</CardTitle>
              </HelpTooltip>
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
              <HelpTooltip text="Os assuntos que apareceram mais vezes nos comentários sobre o evento.">
                <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />Temas Mais Discutidos</CardTitle>
              </HelpTooltip>
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
              <HelpTooltip text="A IA explica se o evento ajudou ou atrapalhou seu candidato e por quê.">
                <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Análise de Impacto</CardTitle>
              </HelpTooltip>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">{report.impact_analysis}</p>
            </CardContent>
          </Card>

          {/* Immediate Actions */}
          <Card className="border-primary/30">
            <CardHeader>
              <HelpTooltip text="Coisas pra fazer JÁ pra aproveitar (ou consertar) o que rolou no evento.">
                <CardTitle className="flex items-center gap-2 text-primary"><Lightbulb className="h-5 w-5" />Ações Recomendadas</CardTitle>
              </HelpTooltip>
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
              <HelpTooltip text="O que aprender desse evento pra ir melhor no próximo.">
                <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" />Lições para Eventos Futuros</CardTitle>
              </HelpTooltip>
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

          {/* Bolhas detectadas */}
          {enrichment && enrichment.bubbles.length > 0 && (
            <Card>
              <CardHeader>
                <HelpTooltip text="Regiões/estados onde o pico mais ressoou.">
                  <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Bolhas detectadas</CardTitle>
                </HelpTooltip>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {enrichment.bubbles.map(([name, n]) => (
                    <Badge key={name} variant="outline" className="text-sm px-3 py-1">
                      {name} <span className="ml-2 text-muted-foreground">{n}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Narrativas detectadas */}
          {report.main_topics && report.main_topics.length > 0 && (
            <Card>
              <CardHeader>
                <HelpTooltip text="Linhas narrativas dominantes no pico, extraídas dos temas mais discutidos.">
                  <CardTitle className="flex items-center gap-2"><Layers className="h-5 w-5" />Narrativas detectadas</CardTitle>
                </HelpTooltip>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {report.main_topics.slice(0, 6).map((t, i) => (
                    <div key={i} className="rounded-md border bg-muted/30 p-3 text-sm">
                      <span className="text-xs text-muted-foreground">Narrativa {String.fromCharCode(65 + i)}</span>
                      <p className="font-medium mt-0.5">{t}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Temas dominantes com sentimento */}
          {enrichment && enrichment.themes.length > 0 && (
            <Card>
              <CardHeader>
                <HelpTooltip text="Para cada tema, total de menções e distribuição de sentimento.">
                  <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />Temas dominantes</CardTitle>
                </HelpTooltip>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {enrichment.themes.map((t) => (
                    <div key={t.topic} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-sm">{t.topic}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.total.toLocaleString("pt-BR")} menções • {t.positivePct}% positivo
                        </span>
                      </div>
                      <div className="flex h-2 w-full rounded overflow-hidden bg-muted">
                        <div className="bg-green-500" style={{ width: `${t.positivePct}%` }} />
                        <div className="bg-yellow-400" style={{ width: `${t.neutralPct}%` }} />
                        <div className="bg-red-500" style={{ width: `${t.negativePct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Origem do pico (redes) */}
          {enrichment && enrichment.networkOrigin.length > 0 && (
            <Card>
              <CardHeader>
                <HelpTooltip text="De onde partiu o pico — distribuição por rede social.">
                  <CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5" />Origem do pico</CardTitle>
                </HelpTooltip>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {enrichment.networkOrigin.map(([net, n]) => {
                    const max = enrichment.networkOrigin[0][1];
                    const pct = Math.round((n / max) * 100);
                    return (
                      <div key={net} className="flex items-center gap-3">
                        <span className="text-sm w-24 capitalize">{net}</span>
                        <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-medium w-16 text-right">{n.toLocaleString("pt-BR")}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

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
