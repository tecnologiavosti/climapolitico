import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarDays, MessageSquare, TrendingUp, AlertTriangle, Lightbulb, BookOpen, Zap, Users, Radio, Layers, LineChart as LineChartIcon } from "lucide-react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceDot } from "recharts";

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
  shares_count?: number | null;
  sentiment_label: string | null;
  social_network: string | null;
  post_url?: string | null;
  author_profile_url?: string | null;
  post_title?: string | null;
  post_description?: string | null;
  author_name?: string | null;
};

const normalizeEventText = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const tokenizeEventText = (text: string) => normalizeEventText(text).match(/[a-z0-9]{4,}/g) || [];

const titleFromPhrase = (phrase: string) => phrase.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const MIN_SOCIAL_ONLY_PEAK_VOLUME = 25;
const MIN_EVIDENCED_GROWTH_VOLUME = 15;

const CONFIRMED_EVENT_TERMS = [
  'eleição', 'eleicoes', 'eleições', 'segundo turno', 'primeiro turno', 'posse', 'diplomacao', 'diplomação',
  'debate', 'sabatina', 'entrevista', 'jornal nacional', 'roda viva', 'podcast', 'live', 'discurso',
  'pronunciamento', 'coletiva', 'comício', 'comicio', 'cpi', 'senado', 'câmara', 'camara', 'congresso',
  'stf', 'tse', 'tribunal', 'julgamento', 'decisão', 'decisao', 'operação', 'operacao', 'polícia federal',
  'votação', 'votacao', 'projeto de lei', 'pec', 'medida provisória', 'agenda', 'reunião', 'reuniao',
  'viagem', 'brics', 'banco dos brics', 'ndb', 'plenario', 'plenário', 'ministerio', 'ministério'
];

function decodeHtmlText(value: string): string {
  if (!value) return '';
  const textarea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  let decoded = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'");
  if (textarea) {
    textarea.innerHTML = decoded;
    decoded = textarea.value;
  }
  return decoded;
}

function cleanDisplayText(value: string | null | undefined): string {
  return decodeHtmlText(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<video[\s\S]*?<\/video>/gi, ' ')
    .replace(/<source[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(src|href|class|target|rel|nofollow|width|height|type)=\S+/gi, ' ')
    .replace(/[{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function interactionDate(row: LocalInteraction): string {
  return (row.original_posted_at || row.created_at || '').substring(0, 10);
}

function hostFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function hasConfirmedEventEvidence(rows: LocalInteraction[]): boolean {
  const joined = normalizeEventText(rows.map(r => `${r.post_title || ''} ${r.post_description || ''} ${r.comment_text || ''}`).join(' '));
  return CONFIRMED_EVENT_TERMS.some(term => joined.includes(normalizeEventText(term)));
}

function summarizeRows(rows: LocalInteraction[]) {
  let pos = 0, neg = 0, neu = 0;
  const netCounts = new Map<string, number>();
  rows.forEach(r => {
    const s = (r.sentiment_label || '').toLowerCase();
    if (s === 'positive' || s === 'positivo') pos++;
    else if (s === 'negative' || s === 'negativo') neg++;
    else neu++;
    if (r.social_network) netCounts.set(r.social_network, (netCounts.get(r.social_network) || 0) + 1);
  });
  const labeled = pos + neg + neu;
  return {
    sentiment: {
      positivePct: labeled ? Math.round((pos / labeled) * 100) : 0,
      negativePct: labeled ? Math.round((neg / labeled) * 100) : 0,
      neutralPct: labeled ? Math.round((neu / labeled) * 100) : 0,
    },
    topNetworks: [...netCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n),
    distinctNetworks: netCounts.size,
  };
}

function classifyMotivo(variation: number, count: number, topNetwork: string | null): string {
  if (variation > 400) return 'Viralização / explosão de menções';
  if (variation > 200) return 'Crise ou repercussão massiva';
  if (variation > 100) return 'Evento de alta repercussão (debate, entrevista, decisão)';
  if (variation > 50) return 'Pico de atenção (declaração, ato político)';
  if (variation < -60) return 'Queda abrupta de menções';
  return topNetwork ? `Aumento de atividade em ${topNetwork}` : 'Aumento de atividade';
}

interface DailyPoint {
  date: string;
  count: number;
  positive: number;
  negative: number;
  neutral: number;
  isPeak?: boolean;
}

function detectEventsFromInteractions(comments: LocalInteraction[], _candidateName: string): { events: DetectedEvent[]; timeline: DailyPoint[] } {
  if (comments.length === 0) return { events: [], timeline: [] };

  const byDay = new Map<string, LocalInteraction[]>();
  comments.forEach((comment) => {
    const day = interactionDate(comment);
    if (!day) return;
    byDay.set(day, [...(byDay.get(day) || []), comment]);
  });

  const daysAsc = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const counts = daysAsc.map(([, rows]) => rows.length);
  const avg = counts.reduce((s, n) => s + n, 0) / Math.max(counts.length, 1);

  const timeline: DailyPoint[] = daysAsc.map(([day, rows]) => {
    let pos = 0, neg = 0, neu = 0;
    rows.forEach(r => {
      const s = (r.sentiment_label || '').toLowerCase();
      if (s === 'positive' || s === 'positivo') pos++;
      else if (s === 'negative' || s === 'negativo') neg++;
      else if (s === 'neutral' || s === 'neutro') neu++;
    });
    return { date: day, count: rows.length, positive: pos, negative: neg, neutral: neu };
  });

  const peakDays = daysAsc
    .map(([day, rows], i) => {
      const prev = counts.slice(Math.max(0, i - 7), i);
      const baseline = prev.length > 0 ? prev.reduce((s, n) => s + n, 0) / prev.length : avg;
      const variation = baseline > 0 ? ((rows.length - baseline) / baseline) * 100 : 0;
      const { distinctNetworks } = summarizeRows(rows);
      const confirmedTerms = hasConfirmedEventEvidence(rows);
      const relevantVolume = rows.length >= Math.max(MIN_SOCIAL_ONLY_PEAK_VOLUME, Math.ceil(avg * 2)) && variation >= 100;
      const strongGrowthWithEvidence = rows.length >= MIN_EVIDENCED_GROWTH_VOLUME && variation >= 300 && confirmedTerms && distinctNetworks >= 2;
      const exceptionalVolume = rows.length >= 100 && variation >= 35;
      const isPeak = relevantVolume || strongGrowthWithEvidence || exceptionalVolume;
      return { day, rows, variation, baseline, isPeak, confirmedTerms };
    })
    .filter(d => d.isPeak)
    .sort((a, b) => (b.rows.length * Math.max(1, b.variation / 100)) - (a.rows.length * Math.max(1, a.variation / 100)))
    .slice(0, 50);

  // mark timeline points
  const peakSet = new Set(peakDays.map(p => p.day));
  timeline.forEach(p => { if (peakSet.has(p.date)) p.isPeak = true; });

  const events: DetectedEvent[] = peakDays.map(({ day, rows, variation, confirmedTerms }) => {
    const formatted = day.split('-').reverse().join('/');
    const sign = variation >= 0 ? '+' : '';
    const tag = confirmedTerms ? 'Forte repercussão com indícios de evento' : 'Forte crescimento de repercussão';
    const summary = summarizeRows(rows);
    const sampleText = rows.map(r => cleanDisplayText(r.post_title || r.comment_text)).filter(Boolean).slice(0, 8).join(' ');
    const keywords = [...new Set(tokenizeEventText(sampleText).filter(w => !EVENT_STOP_WORDS.has(w)).slice(0, 8))];

    return {
      name: `${formatted} — ${tag}`,
      type: 'repercussao_social_evidenciada',
      keywords,
      start_date: day,
      end_date: day,
      mentions_estimate: rows.length,
      variation_pct: Math.round(variation),
      description: `${tag} em ${formatted}: ${rows.length} menções (${sign}${Math.round(variation)}% vs. média anterior), com evidência textual/rede suficiente para investigação histórica.`,
      motivo: classifyMotivo(variation, rows.length, summary.topNetworks[0] || null),
      sentiment: summary.sentiment,
      topNetworks: summary.topNetworks,
      confirmed_event: false,
      evidence_level: confirmedTerms ? 'crescimento_com_indicios' : 'volume_relevante',
      relevance_score: Math.round(Math.min(70, rows.length * 1.2 + Math.max(0, variation) / 10 + (confirmedTerms ? 15 : 0))),
    };
  });

  return { events, timeline };
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
  motivo?: string;
  sentiment?: { positivePct: number; negativePct: number; neutralPct: number };
  topNetworks?: string[];
  confirmed_event?: boolean;
  evidence_level?: 'evento_documentado' | 'crescimento_com_indicios' | 'volume_relevante';
  relevance_score?: number;
  publications_count?: number;
  distinct_outlets?: number;
  sources?: Array<{ name: string; url: string; region?: string }>;
  source_titles?: string[];
}

const EventReportPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [detectedEvents, setDetectedEvents] = useState<DetectedEvent[]>([]);
  const [timeline, setTimeline] = useState<DailyPoint[]>([]);
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

  const fetchLocalEvents = async (): Promise<{ events: DetectedEvent[]; timeline: DailyPoint[] }> => {
    let fromISO: string;
    let toISO: string;
    if (startDate && endDate) {
      const s = new Date(startDate); s.setHours(0, 0, 0, 0);
      const e = new Date(endDate); e.setHours(23, 59, 59, 999);
      fromISO = s.toISOString();
      toISO = e.toISOString();
    } else {
      toast.error("Selecione um período inicial e final");
      return { events: [], timeline: [] };
    }
    const selectedCandidateData = candidates.find(candidate => candidate.id === selectedCandidate);

    // Paginação para suportar análise histórica longa (anos)
    const PAGE = 1000;
    const MAX_PAGES = 30; // até 30k registros
    const all: any[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE;
      const to = from + PAGE - 1;
      const { data, error } = await supabase
        .from('social_interactions')
        .select('comment_text, original_posted_at, created_at, likes_count, replies_count, shares_count, sentiment_label, social_network, post_url, author_profile_url, post_title, post_description, author_name')
        .eq('candidate_id', selectedCandidate)
        .or(`and(original_posted_at.gte.${fromISO},original_posted_at.lte.${toISO}),and(original_posted_at.is.null,created_at.gte.${fromISO},created_at.lte.${toISO})`)
        .order('original_posted_at', { ascending: false, nullsFirst: false })
        .range(from, to);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    const localDetection = detectEventsFromInteractions(all as LocalInteraction[], selectedCandidateData?.full_name || '');

    let aiEvents: DetectedEvent[] = [];
    try {
      const { data: aiDetected, error: aiError } = await supabase.functions.invoke('detect-historical-peaks', {
        body: {
          candidateId: selectedCandidate,
          startDate: fromISO,
          endDate: toISO,
          localTimeline: localDetection.timeline,
        },
      });
      if (aiError) throw aiError;
      aiEvents = Array.isArray(aiDetected?.events) ? aiDetected.events as DetectedEvent[] : [];
    } catch (error) {
      console.warn('Detecção histórica externa indisponível; nenhum pico interno será promovido a evento.', error);
    }
    const merged = aiEvents
      .filter((evt) => {
        const hasExternalEvidence = (evt.publications_count || 0) > 0 || (evt.sources?.length || 0) > 0 || evt.confirmed_event;
        return hasExternalEvidence && (evt.sources?.length || 0) > 0 && (evt.publications_count || 0) > 0;
      })
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, 30);

    const peakDates = new Set(merged.map((e) => e.start_date));
    localDetection.timeline.forEach((point) => { point.isPeak = peakDates.has(point.date); });
    return { events: merged, timeline: localDetection.timeline };
  };


  const handleCandidateChange = (id: string) => {
    setSelectedCandidate(id);
    setDetectedEvents([]);
    setTimeline([]);
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
        const measured = count ?? 0;
        return { ...evt, mentions_estimate: measured };
      } catch {
        return evt;
      }
    }));
    return refined;
  };

  const handleDetectEvents = async () => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    if (!startDate || !endDate) { toast.error("Defina o período histórico (início e fim)"); return; }
    setIsDetecting(true);
    setDetectedEvents([]);
    setTimeline([]);
    setSelectedEventIdx("");
    try {
      const { events: detected, timeline: tl } = await fetchLocalEvents();
      const refined = (await refineEventCounts(detected)).map((evt) => {
        const formatted = evt.start_date.split('-').reverse().join('/');
        const v = evt.variation_pct ?? 0;
        const sign = v >= 0 ? '+' : '';
        const tag = 'Evento político documentado';
        return {
          ...evt,
          description: evt.description
            ? evt.description
            : `${tag} em ${formatted} — validado por ${evt.publications_count || evt.sources?.length || 0} fonte(s) externa(s).`,
        };
      }).sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
      setDetectedEvents(refined);
      setTimeline(tl);
      if (refined.length === 0) toast.info("Nenhum evento político documentado foi detectado no período selecionado.");
      else toast.success(`${refined.length} evento(s) relevante(s) detectado(s) em ${tl.length} dias analisados`);
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

  const handleGenerate = async (forcedEvent?: DetectedEvent) => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    const evt = forcedEvent || (selectedEventIdx ? detectedEvents[Number(selectedEventIdx)] : null);
    if (!evt || !evt.confirmed_event || !evt.sources?.length) {
      toast.error("Detecte e selecione um acontecimento com evidência externa antes de gerar o relatório.");
      return;
    }
    const reportStartDate = evt?.start_date || startDate;
    const reportEndDate = evt?.end_date || endDate;
    if (!reportStartDate || !reportEndDate) { toast.error("Defina o período do evento"); return; }

    setIsLoading(true);
    setResult(null);
    try {
      const sDate = new Date(reportStartDate);
      sDate.setHours(0, 0, 0, 0);
      const eDate = new Date(reportEndDate);
      eDate.setHours(23, 59, 59, 999);

      const { data, error } = await supabase.functions.invoke('analyze-event-repercussion', {
        body: {
          candidateId: selectedCandidate,
          startDate: sDate.toISOString(),
          endDate: eDate.toISOString(),
          eventName: evt?.name || undefined,
          eventKeywords: evt?.keywords || undefined,
          eventDescription: evt?.description || undefined,
          eventType: evt?.type || undefined,
          eventSources: evt?.sources || undefined,
          eventSourceTitles: evt?.source_titles || undefined,
          confirmedEvent: evt?.confirmed_event || false,
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
        <p className="text-muted-foreground mt-1">Ferramenta de inteligência histórica para identificar acontecimentos políticos reais e documentados dentro do intervalo selecionado.</p>
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
            <HelpTooltip text="A IA cruza fontes externas e sinais internos para identificar eventos políticos reais no período selecionado.">
              <Button variant="outline" size="sm" className="sm:size-default" onClick={handleDetectEvents} disabled={isDetecting || !selectedCandidate}>
                {isDetecting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Detectando...</>
                  : <><Zap className="mr-2 h-4 w-4" />Detectar eventos</>}
              </Button>
            </HelpTooltip>
          </div>

          {detectedEvents.length > 0 && (
            <HelpTooltip text="Selecione um evento documentado para gerar o relatório contextual com IA.">
              <Select value={selectedEventIdx} onValueChange={handleSelectEvent}>
                <SelectTrigger className="w-full sm:w-[520px]">
                  <SelectValue placeholder={`${detectedEvents.length} evento(s) detectado(s) — escolha um`} />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  {detectedEvents.map((e, i) => {
                    const v = e.variation_pct ?? 0;
                    const sign = v >= 0 ? '+' : '';
                    return (
                      <SelectItem key={i} value={String(i)} className="whitespace-normal break-words pr-8">
                        <span className="block text-sm leading-snug">
                          {e.name} — relevância {e.relevance_score || 0} • {e.mentions_estimate} registros <span className={v >= 0 ? 'text-green-600' : 'text-red-600'}>({sign}{v}%)</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </HelpTooltip>
          )}

          {selectedEventIdx !== "" && detectedEvents[Number(selectedEventIdx)] && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{detectedEvents[Number(selectedEventIdx)].name}</p>
              <p className="text-muted-foreground mt-1">{detectedEvents[Number(selectedEventIdx)].description}</p>
            </div>
          )}

          <div className="flex flex-row flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Data Inicial</label>
              <HelpTooltip text="Dia em que o evento começou.">
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[130px] sm:w-[180px]" />
              </HelpTooltip>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Data Final</label>
              <HelpTooltip text="Até quando você quer analisar a repercussão.">
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[130px] sm:w-[180px]" />
              </HelpTooltip>
            </div>
            <HelpTooltip text="Clica aqui pra IA olhar tudo que falaram nesse período e te dizer se foi bom ou ruim.">
              <Button onClick={() => handleGenerate()} disabled={isLoading || !selectedCandidate || selectedEventIdx === ""}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analisando...</> : <><CalendarDays className="mr-2 h-4 w-4" />Gerar Relatório</>}
              </Button>
            </HelpTooltip>
          </div>

        </CardContent>
      </Card>

      {/* Histórico contínuo */}
      {timeline.length > 0 && (
        <Card>
          <CardHeader>
            <HelpTooltip text="Gráfico contínuo do volume diário de menções em todo o período selecionado. Pontos marcados = eventos reais detectados.">
              <CardTitle className="flex items-center gap-2"><LineChartIcon className="h-5 w-5" />Gráfico Histórico ({startDate} → {endDate})</CardTitle>
            </HelpTooltip>
            <CardDescription>
              {timeline.reduce((s, p) => s + p.count, 0).toLocaleString("pt-BR")} registros totais • {timeline.length} dias analisados • {detectedEvents.length} eventos detectados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                    formatter={(v: number, name: string) => [v, name === 'count' ? 'Menções' : name]}
                  />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  {timeline.filter(p => p.isPeak).map(p => (
                    <ReferenceDot key={p.date} x={p.date} y={p.count} r={5} fill="hsl(var(--destructive))" stroke="white" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista detalhada de eventos */}
      {detectedEvents.length > 0 && (
        <Card>
          <CardHeader>
            <HelpTooltip text="Eventos documentados por fontes externas e sinais internos, ordenados por relevância histórica.">
              <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" />Eventos Históricos Detectados</CardTitle>
            </HelpTooltip>
            <CardDescription>{detectedEvents.length} eventos relevantes — ordenados por relevância histórica</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {detectedEvents.map((e, i) => {
                const v = e.variation_pct ?? 0;
                const sign = v >= 0 ? '+' : '';
                const formatted = e.start_date.split('-').reverse().join('/');
                const sent = e.sentiment;
                return (
                  <div key={i} className="border rounded-lg p-4 space-y-2 bg-card hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm">{formatted}</p>
                        <p className="text-xs text-muted-foreground">{e.motivo || e.description || 'Evento político documentado'}</p>
                      </div>
                      <Badge variant={e.confirmed_event ? 'default' : 'secondary'} className="text-xs">
                        {e.confirmed_event ? 'documentado' : `relevância ${e.relevance_score || 0}`}
                      </Badge>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold">{e.publications_count || e.sources?.length || 0}</span>
                      <span className="text-xs text-muted-foreground">fonte(s) externa(s)</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {e.distinct_outlets || 0} veículo(s) • {e.mentions_estimate.toLocaleString("pt-BR")} menção(ões) internas correlacionadas • {sign}{v}% vs. base interna
                    </p>
                    {sent && (sent.positivePct + sent.negativePct + sent.neutralPct) > 0 && (
                      <div className="space-y-1">
                        <div className="flex h-1.5 w-full rounded overflow-hidden bg-muted">
                          <div className="bg-green-500" style={{ width: `${sent.positivePct}%` }} />
                          <div className="bg-yellow-400" style={{ width: `${sent.neutralPct}%` }} />
                          <div className="bg-red-500" style={{ width: `${sent.negativePct}%` }} />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {sent.positivePct}% positivo • {sent.neutralPct}% neutro • {sent.negativePct}% negativo
                        </p>
                      </div>
                    )}
                    {e.topNetworks && e.topNetworks.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {e.topNetworks.map(n => (
                          <Badge key={n} variant="outline" className="text-[10px] capitalize">{n}</Badge>
                        ))}
                      </div>
                    )}
                    {e.sources && e.sources.length > 0 && (
                      <div className="space-y-1 rounded-md bg-muted/30 p-2">
                        {e.sources.slice(0, 3).map((source, sourceIdx) => (
                          <a
                            key={`${source.url}-${sourceIdx}`}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-[11px] text-primary hover:underline"
                          >
                            {source.name || 'Fonte externa'}
                          </a>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-1"
                       onClick={() => { setSelectedEventIdx(String(i)); setStartDate(e.start_date); setEndDate(e.end_date); handleGenerate(e); }}
                    >
                      <Lightbulb className="h-3 w-3 mr-1" />Analisar com IA
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}


      {/* No data */}
      {result && !report && (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Relatório não gerado</h3>
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
