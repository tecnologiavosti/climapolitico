import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  RefreshCw, Radio, Clock, CheckCircle2, TrendingUp, TrendingDown,
  Smile, Frown, Newspaper, Flame, Sparkles, AlertTriangle, Zap, Activity,
} from "lucide-react";
import { CandidateSelector } from "@/components/dashboard/realtime/CandidateSelector";
import { cn } from "@/lib/utils";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

interface Candidate { id: string; full_name: string; }

// ============ Tipos ============
interface EvolutionPoint { label: string; total: number; positive: number; negative: number; neutral: number; }
interface Topic { name: string; count: number; }
interface Alert { kind: "growth" | "negative" | "viral" | "news"; title: string; detail: string; }

interface Snapshot {
  // Linha 1
  topic: string;
  mentionsToday: number;
  positiveToday: number;
  negativeToday: number;
  newsCollected: number;
  // Linha 2
  evolution24h: EvolutionPoint[];
  evolution7d: EvolutionPoint[];
  evolution30d: EvolutionPoint[];
  // Linha 3
  topTopics: Topic[];
  // Linha 4
  alerts: Alert[];
  // Linha 5
  aiSummary: string;
  // Meta
  savedAt: number;
}

// ============ Cache 5 min ============
const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheKey = (uid: string, cid: string) => `rt-exec:${uid}:${cid}`;
const readCache = (k: string): Snapshot | null => {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; }
};
const writeCache = (k: string, s: Snapshot) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch {} };

// ============ Util ============
const formatRelative = (d: Date) => {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 10) return "agora";
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `há ${h}h`;
  return d.toLocaleDateString("pt-BR");
};

const withTimeout = <T,>(p: Promise<T>, ms: number, label = "query"): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });

// Stopwords PT-BR para topics
const STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","em","no","na","nos","nas","um","uma","uns","umas",
  "para","por","com","sem","que","se","é","são","foi","ser","ter","como","mas","mais","menos",
  "muito","muita","muitos","muitas","já","ainda","sobre","entre","ou","não","sim","aos","ao",
  "este","esta","isso","isto","esse","essa","aquele","aquela","seu","sua","seus","suas","meu","minha",
  "ele","ela","eles","elas","nós","você","vocês","eu","te","lhe","lhes","pelo","pela","pelos","pelas",
  "rt","via","https","http","www","com.br","br",
]);

const extractTopics = (rows: { comment_text: string | null }[]): Topic[] => {
  const freq = new Map<string, number>();
  for (const r of rows) {
    const txt = (r.comment_text || "").toLowerCase().replace(/https?:\/\/\S+/g, " ");
    const words = txt.match(/[a-záàâãéêíóôõúç]{4,}/gi) || [];
    for (const w of words) {
      const lw = w.toLowerCase();
      if (STOPWORDS.has(lw)) continue;
      freq.set(lw, (freq.get(lw) || 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .map(([name, count]) => ({ name: name[0].toUpperCase() + name.slice(1), count }))
    .sort((a, b) => b.count - a.count).slice(0, 5);
};

// ============ Fetch otimizado (paralelo + timeout + progress) ============
async function fetchSnapshot(
  userId: string,
  candidateId: string,
  onProgress?: (p: Partial<LiveProgress>) => void,
  timeoutMs = 8000,
): Promise<Snapshot> {
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const start30d = new Date(now.getTime() - 30 * 86400000);
  const start24h = new Date(now.getTime() - 24 * 3600000);
  const startPrev24h = new Date(now.getTime() - 48 * 3600000);

  const base = () => supabase
    .from("social_interactions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("candidate_id", candidateId)
    .not("social_network", "in", "(mastodon,lemmy,pinterest)");

  const run = <T,>(b: any, label: string): Promise<T> =>
    withTimeout<T>(Promise.resolve(b) as Promise<T>, timeoutMs, label);

  // Estado de progresso interno (acumula chamadas de onProgress)
  const live: LiveProgress = {
    news: 0, posts: 0, videos: 0, comments: 0,
    mentionsProcessed: 0, sentimentClassified: 0,
    positivePct: 0, neutralPct: 0, negativePct: 0,
    emergingTopics: [],
    steps: { collectNews: false, collectSocial: false, processAI: false, classifySentiment: false, buildCharts: false },
  };
  const emit = (patch: Partial<LiveProgress>) => {
    Object.assign(live, patch);
    if (patch.steps) live.steps = { ...live.steps, ...patch.steps };
    onProgress?.({ ...live, steps: { ...live.steps } });
  };

  // Promessas com side-effect progressivo
  const pNews = run<{ count: number | null }>(base().eq("social_network", "Google News"), "news")
    .then(r => { emit({ news: r.count ?? 0, steps: { ...live.steps, collectNews: true } }); return r; });

  const pPosts = run<{ count: number | null }>(
    base().in("social_network", ["Instagram", "Twitter", "Twitter/X", "X", "Facebook", "LinkedIn", "Threads", "Bluesky"]),
    "posts"
  ).then(r => { emit({ posts: r.count ?? 0 }); return r; });

  const pVideos = run<{ count: number | null }>(
    base().in("social_network", ["YouTube", "TikTok"]),
    "videos"
  ).then(r => {
    emit({ videos: r.count ?? 0, steps: { ...live.steps, collectSocial: true } });
    return r;
  });

  const pComments = run<{ count: number | null }>(
    base().in("interaction_type", ["comment", "reply", "subcomment"]),
    "comments"
  ).then(r => { emit({ comments: r.count ?? 0 }); return r; });

  const pToday = run<{ count: number | null }>(base().gte("created_at", startToday.toISOString()), "today")
    .then(r => { emit({ mentionsProcessed: r.count ?? 0, steps: { ...live.steps, processAI: true } }); return r; });

  const pPos = run<{ count: number | null }>(base().gte("created_at", startToday.toISOString()).eq("sentiment_label", "Positivo"), "pos");
  const pNeg = run<{ count: number | null }>(base().gte("created_at", startToday.toISOString()).eq("sentiment_label", "Negativo"), "neg");
  const pNeu = run<{ count: number | null }>(base().gte("created_at", startToday.toISOString()).eq("sentiment_label", "Neutro"), "neu");
  const pPrev = run<{ count: number | null }>(base().gte("created_at", startPrev24h.toISOString()).lt("created_at", start24h.toISOString()), "prev24");

  // Sentimento parcial assim que p/n/neu retornarem
  Promise.all([pPos, pNeg, pNeu]).then(([rp, rn, ru]) => {
    const p = rp.count ?? 0, n = rn.count ?? 0, u = ru.count ?? 0;
    const total = p + n + u;
    if (total > 0) {
      emit({
        sentimentClassified: total,
        positivePct: Math.round((p / total) * 100),
        neutralPct: Math.round((u / total) * 100),
        negativePct: Math.round((n / total) * 100),
        steps: { ...live.steps, classifySentiment: true },
      });
    } else {
      emit({ steps: { ...live.steps, classifySentiment: true } });
    }
  }).catch(() => {});

  const pSample = run<{ data: any[] | null }>(
    supabase.from("social_interactions")
      .select("created_at, sentiment_label, comment_text, social_network, likes_count, shares_count")
      .eq("user_id", userId).eq("candidate_id", candidateId)
      .not("social_network", "in", "(mastodon,lemmy,pinterest)")
      .gte("created_at", start30d.toISOString())
      .order("created_at", { ascending: false })
      .limit(5000),
    "sample"
  ).then(r => {
    const topics = extractTopics((r.data ?? []).slice(0, 1500));
    emit({ emergingTopics: topics.slice(0, 6).map(t => t.name) });
    return r;
  });

  const [qToday, qPos, qNeg, qNews, qPrev24h, qSample] = await Promise.all([
    pToday, pPos, pNeg, pNews, pPrev, pSample,
  ]);
  // Garante posts/vídeos/comentários terminados antes de marcar gráficos
  await Promise.all([pPosts, pVideos, pComments]);

  const mentionsToday = qToday.count ?? 0;
  const positiveToday = qPos.count ?? 0;
  const negativeToday = qNeg.count ?? 0;
  const newsCollected = qNews.count ?? 0;
  const last24h = qToday.count ?? 0;
  const prev24h = qPrev24h.count ?? 0;
  const sample: any[] = qSample.data ?? [];

  const buckets24h: EvolutionPoint[] = Array.from({ length: 24 }, (_, i) => {
    const bs = new Date(now.getTime() - (23 - i) * 3600000);
    return { label: bs.getHours().toString().padStart(2, "0") + "h", total: 0, positive: 0, negative: 0, neutral: 0 };
  });
  const buckets7d: EvolutionPoint[] = Array.from({ length: 7 }, (_, i) => {
    const bs = new Date(now); bs.setDate(now.getDate() - (6 - i));
    return { label: bs.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), total: 0, positive: 0, negative: 0, neutral: 0 };
  });
  const buckets30d: EvolutionPoint[] = Array.from({ length: 30 }, (_, i) => {
    const bs = new Date(now); bs.setDate(now.getDate() - (29 - i));
    return { label: bs.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), total: 0, positive: 0, negative: 0, neutral: 0 };
  });

  for (const r of sample) {
    const t = new Date(r.created_at).getTime();
    const inc = (b: EvolutionPoint) => {
      b.total++;
      if (r.sentiment_label === "Positivo") b.positive++;
      else if (r.sentiment_label === "Negativo") b.negative++;
      else if (r.sentiment_label === "Neutro") b.neutral++;
    };
    const h = Math.floor((now.getTime() - t) / 3600000);
    if (h >= 0 && h < 24) inc(buckets24h[23 - h]);
    const d7 = Math.floor((now.getTime() - t) / 86400000);
    if (d7 >= 0 && d7 < 7) inc(buckets7d[6 - d7]);
    if (d7 >= 0 && d7 < 30) inc(buckets30d[29 - d7]);
  }

  emit({ steps: { ...live.steps, buildCharts: true } });

  const topics = extractTopics(sample.slice(0, 1500));
  const topTopic = topics[0]?.name ?? "—";

  const alerts: Alert[] = [];
  if (prev24h > 0) {
    const growth = ((last24h - prev24h) / prev24h) * 100;
    if (growth >= 50) alerts.push({ kind: "growth", title: `Crescimento de ${Math.round(growth)}% nas menções`, detail: "Volume disparou nas últimas 24h em relação ao período anterior." });
    else if (growth <= -40) alerts.push({ kind: "growth", title: `Queda de ${Math.round(Math.abs(growth))}% nas menções`, detail: "Volume de menções caiu significativamente." });
  }
  if (mentionsToday > 0 && (negativeToday / Math.max(1, mentionsToday)) >= 0.45) {
    alerts.push({ kind: "negative", title: "Pico de sentimento negativo", detail: `${negativeToday} menções negativas hoje (${Math.round(negativeToday / mentionsToday * 100)}% do total).` });
  }
  const viral = sample
    .filter(r => (r.likes_count || 0) + (r.shares_count || 0) > 500)
    .sort((a, b) => (b.likes_count + b.shares_count) - (a.likes_count + a.shares_count))[0];
  if (viral) {
    alerts.push({ kind: "viral", title: "Conteúdo viral identificado", detail: `Post em ${viral.social_network} com ${(viral.likes_count || 0) + (viral.shares_count || 0)} interações.` });
  }
  if (newsCollected > 0) {
    const recentNews = sample.filter(r => r.social_network === "Google News" && new Date(r.created_at).getTime() > Date.now() - 86400000).length;
    if (recentNews >= 5) alerts.push({ kind: "news", title: `${recentNews} notícias publicadas hoje`, detail: "Cobertura jornalística intensificada nas últimas 24h." });
  }

  const growthPct = prev24h > 0 ? Math.round(((last24h - prev24h) / prev24h) * 100) : 0;
  const tone = positiveToday > negativeToday ? "predominantemente positivo" : negativeToday > positiveToday ? "predominantemente negativo" : "equilibrado";
  const aiSummary =
    `Foram registradas ${mentionsToday.toLocaleString("pt-BR")} menções hoje, ` +
    `${growthPct >= 0 ? "alta" : "queda"} de ${Math.abs(growthPct)}% vs ontem. ` +
    `Sentimento ${tone} (${positiveToday} positivas / ${negativeToday} negativas). ` +
    `Assunto dominante: ${topTopic}. ` +
    `Cobertura jornalística: ${newsCollected.toLocaleString("pt-BR")} notícias coletadas.`;

  return {
    topic: topTopic, mentionsToday, positiveToday, negativeToday, newsCollected,
    evolution24h: buckets24h, evolution7d: buckets7d, evolution30d: buckets30d,
    topTopics: topics, alerts, aiSummary, savedAt: Date.now(),
  };
}

// ============ Componentes UI ============
const KpiCard = ({ icon, label, value, tone = "text-foreground", accent }: { icon: React.ReactNode; label: string; value: string; tone?: string; accent?: string; }) => (
  <Card className={cn("border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden relative")}>
    {accent && <div className={cn("absolute inset-x-0 top-0 h-0.5", accent)} />}
    <CardContent className="p-3 sm:p-4">
      <div className="flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {icon}<span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1.5 text-lg sm:text-2xl font-bold tabular-nums truncate", tone)}>{value}</div>
    </CardContent>
  </Card>
);

const alertStyles: Record<Alert["kind"], { icon: React.ReactNode; ring: string; bg: string; text: string }> = {
  growth: { icon: <TrendingUp className="h-4 w-4" />, ring: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-500" },
  negative: { icon: <TrendingDown className="h-4 w-4" />, ring: "border-red-500/30", bg: "bg-red-500/5", text: "text-red-500" },
  viral: { icon: <Zap className="h-4 w-4" />, ring: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-500" },
  news: { icon: <Newspaper className="h-4 w-4" />, ring: "border-violet-500/30", bg: "bg-violet-500/5", text: "text-violet-500" },
};

const EvolutionChart = ({ data }: { data: EvolutionPoint[] }) => (
  <div className="h-56 sm:h-64 w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gNeg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.5} /><stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={36} />
        <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
        <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gTotal)" />
        <Area type="monotone" dataKey="positive" stroke="#22c55e" strokeWidth={1.5} fill="url(#gPos)" />
        <Area type="monotone" dataKey="negative" stroke="#ef4444" strokeWidth={1.5} fill="url(#gNeg)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

// ============ Página ============
const RealTimeMonitor = () => {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const bgTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Candidatos
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("candidates").select("id, full_name")
        .eq("user_id", user.id).eq("status", "active").order("full_name");
      if (data) {
        setCandidates(data);
        if (data.length > 0 && !selectedCandidateId) setSelectedCandidateId(data[0].id);
      }
      setLoadingCandidates(false);
    })();
  }, [user]);

  const runSync = useCallback(async (cid: string, uid: string) => {
    setIsSyncing(true); setError(null);
    try {
      const snap = await fetchSnapshot(uid, cid);
      writeCache(cacheKey(uid, cid), snap);
      setSnapshot(snap);
    } catch (e: any) {
      setError(e?.message?.includes("Timeout") ? "Consulta excedeu 8s — exibindo último snapshot." : "Falha ao atualizar dados.");
    } finally { setIsSyncing(false); }
  }, []);

  // Snapshot do cache + background refresh
  useEffect(() => {
    if (!user || !selectedCandidateId) { setSnapshot(null); return; }
    const cached = readCache(cacheKey(user.id, selectedCandidateId));
    if (cached) setSnapshot(cached);
    // Se cache fresco, não bloqueia; mesmo assim atualiza em background se >2 min
    const stale = !cached || (Date.now() - cached.savedAt) > 2 * 60 * 1000;
    if (stale) runSync(selectedCandidateId, user.id);
  }, [user, selectedCandidateId, runSync]);

  // Refresh background a cada 60s
  useEffect(() => {
    if (!user || !selectedCandidateId) return;
    bgTimerRef.current = setInterval(() => runSync(selectedCandidateId, user.id), 60000);
    return () => { if (bgTimerRef.current) clearInterval(bgTimerRef.current); };
  }, [user, selectedCandidateId, runSync]);

  // Tick relativo
  useEffect(() => {
    tickRef.current = setInterval(() => force(n => n + 1), 30000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const lastUpdate = snapshot ? new Date(snapshot.savedAt) : null;
  const selectedCandidate = candidates.find(c => c.id === selectedCandidateId);

  return (
    <div className="space-y-4 sm:space-y-5 pb-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 mt-0.5">
            <Radio className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Monitor em Tempo Real</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Inteligência política instantânea</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-xs">
            {isSyncing ? (<><RefreshCw className="h-3 w-3 animate-spin text-primary" /><span className="text-muted-foreground">Atualizando…</span></>)
              : snapshot ? (<><CheckCircle2 className="h-3 w-3 text-emerald-500" /><span className="text-muted-foreground">{lastUpdate ? formatRelative(lastUpdate) : "Sincronizado"}</span></>)
              : (<><Clock className="h-3 w-3" /><span className="text-muted-foreground">Aguardando</span></>)}
          </div>
          <Button variant="outline" size="sm" disabled={isSyncing || !selectedCandidateId}
            onClick={() => user && selectedCandidateId && runSync(selectedCandidateId, user.id)}
            className="h-8 gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />Atualizar
          </Button>
        </div>
      </div>

      {/* Candidate selector */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-500 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>EM TEMPO REAL
          </span>
          {loadingCandidates ? <Skeleton className="h-11 w-full sm:w-[280px]" /> : (
            <CandidateSelector candidates={candidates} value={selectedCandidateId} onChange={setSelectedCandidateId} disabled={false} />
          )}
          {selectedCandidate && (
            <span className="text-xs text-muted-foreground ml-auto truncate">Monitorando: <span className="font-semibold text-foreground">{selectedCandidate.full_name}</span></span>
          )}
        </CardContent>
      </Card>

      {!selectedCandidateId ? (
        <Card className="border-border/60 bg-card/60">
          <CardContent className="py-16 text-center">
            <Radio className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <h3 className="text-base font-semibold mb-1">Selecione um candidato</h3>
            <p className="text-sm text-muted-foreground">Escolha um candidato para iniciar o monitoramento</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {error && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="py-2.5 text-xs text-amber-600 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />{error}
              </CardContent>
            </Card>
          )}

          {/* LINHA 1: Cards executivos */}
          {snapshot ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
              <KpiCard icon={<Flame className="h-3.5 w-3.5 text-amber-500" />} label="Assunto do Momento" value={snapshot.topic} accent="bg-amber-500/70" />
              <KpiCard icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />} label="Menções Hoje" value={snapshot.mentionsToday.toLocaleString("pt-BR")} accent="bg-primary/70" />
              <KpiCard icon={<Smile className="h-3.5 w-3.5 text-emerald-500" />} label="Sentimento +" value={snapshot.positiveToday.toLocaleString("pt-BR")} tone="text-emerald-500" accent="bg-emerald-500/70" />
              <KpiCard icon={<Frown className="h-3.5 w-3.5 text-red-500" />} label="Sentimento −" value={snapshot.negativeToday.toLocaleString("pt-BR")} tone="text-red-500" accent="bg-red-500/70" />
              <KpiCard icon={<Newspaper className="h-3.5 w-3.5 text-violet-500" />} label="Notícias" value={snapshot.newsCollected.toLocaleString("pt-BR")} accent="bg-violet-500/70" />
              <KpiCard icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />} label="Última Atualização" value={lastUpdate ? formatRelative(lastUpdate) : "—"} />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-lg" />)}
            </div>
          )}

          {/* LINHA 2: Evolução */}
          <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Evolução das menções</CardTitle>
            </CardHeader>
            <CardContent>
              {snapshot ? (
                <Tabs defaultValue="24h">
                  <TabsList className="h-8">
                    <TabsTrigger value="24h" className="text-xs">24h</TabsTrigger>
                    <TabsTrigger value="7d" className="text-xs">7 dias</TabsTrigger>
                    <TabsTrigger value="30d" className="text-xs">30 dias</TabsTrigger>
                  </TabsList>
                  <TabsContent value="24h" className="mt-3"><EvolutionChart data={snapshot.evolution24h} /></TabsContent>
                  <TabsContent value="7d" className="mt-3"><EvolutionChart data={snapshot.evolution7d} /></TabsContent>
                  <TabsContent value="30d" className="mt-3"><EvolutionChart data={snapshot.evolution30d} /></TabsContent>
                </Tabs>
              ) : <Skeleton className="h-64 w-full rounded-lg" />}
            </CardContent>
          </Card>

          {/* LINHA 3 + 4: Topics + Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Top assuntos emergentes</CardTitle></CardHeader>
              <CardContent>
                {snapshot ? (
                  snapshot.topTopics.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">Sem dados suficientes para identificar assuntos.</p>
                  ) : (
                    <ol className="space-y-2">
                      {snapshot.topTopics.map((t, i) => {
                        const max = snapshot.topTopics[0].count || 1;
                        const pct = Math.round((t.count / max) * 100);
                        return (
                          <li key={t.name} className="flex items-center gap-3">
                            <span className="w-5 h-5 rounded-md bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium truncate">{t.name}</span>
                                <span className="text-[11px] text-muted-foreground tabular-nums">{t.count.toLocaleString("pt-BR")}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mt-1">
                                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} className="h-full bg-primary" />
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )
                ) : <Skeleton className="h-40 w-full" />}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Alertas automáticos</CardTitle></CardHeader>
              <CardContent>
                {snapshot ? (
                  snapshot.alerts.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">Nenhum alerta no momento. Tudo dentro da normalidade.</p>
                  ) : (
                    <ul className="space-y-2">
                      <AnimatePresence>
                        {snapshot.alerts.map((a, i) => {
                          const s = alertStyles[a.kind];
                          return (
                            <motion.li key={a.title + i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                              className={cn("rounded-lg border p-2.5 flex items-start gap-2.5", s.ring, s.bg)}>
                              <div className={cn("rounded-md p-1.5 bg-background/60", s.text)}>{s.icon}</div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold truncate">{a.title}</div>
                                <div className="text-xs text-muted-foreground">{a.detail}</div>
                              </div>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ul>
                  )
                ) : <Skeleton className="h-40 w-full" />}
              </CardContent>
            </Card>
          </div>

          {/* LINHA 5: Resumo IA */}
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />Resumo IA
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Inteligência</Badge>
            </CardTitle></CardHeader>
            <CardContent>
              {snapshot ? (
                <p className="text-sm leading-relaxed text-foreground/90">{snapshot.aiSummary}</p>
              ) : <Skeleton className="h-16 w-full" />}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default RealTimeMonitor;
