import { useEffect, useMemo, useState, lazy, Suspense } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AlertCircle, ExternalLink, Heart, MessageCircle, RefreshCw, Share2, ThumbsUp, ThumbsDown, Minus, User } from "lucide-react";
import { subDays } from "date-fns";

// Carrega Recharts apenas quando o usuário entra na aba — reduz JS inicial.
const ChartsBlock = lazy(() => import("./ReactionsPerPostCharts"));

interface Props {
  candidateId?: string;
  days?: number;
}

type PeriodKey = "total" | "7d" | "30d" | "90d" | "6m" | "1y" | "custom";

interface SummaryData {
  totalRecords: number;
  postsCount: number;
  commentsCount: number;
  directCommentsCount?: number;
  repliesRowsCount?: number;
  subcommentsCount?: number;
  otherRecordsCount?: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  classifiedCount: number;
  pendingCount: number;
  totalLikes: number;
  totalReplies: number;
  totalShares: number;
  totalInteractions: number;
  dominantTopics: { topic: string; mentions: number }[];
  networkBreakdown?: { network: string; total: number }[];
  engagementByNetwork?: EngagementByNetwork[];
  sentimentByNetwork?: SentimentByNetwork[];
  activityHourWeek?: ActivityHourWeek[];
  debug?: {
    postsEncontrados: number;
    comentariosEncontrados: number;
    respostasEncontradas: number;
    subcomentariosEncontrados: number;
    outrosRegistrosEncontrados: number;
    redesEncontradas: number;
    registrosPorRede: Record<string, number>;
  };
  topPosts?: PostRow[];
}

export interface EngagementByNetwork {
  rede: string;
  registros: number;
  curtidas: number;
  comentarios_respostas: number;
  compartilhamentos: number;
  engajamento: number;
}

export interface SentimentByNetwork {
  rede: string;
  total: number;
  positivo: number;
  neutro: number;
  negativo: number;
  sem_classificacao: number;
}

export interface ActivityHourWeek {
  dia_semana: number;
  hora: number;
  registros: number;
  engajamento: number;
}

export interface PostRow {
  id: string;
  platform?: string | null;
  social_network: string;
  social_network_raw?: string | null;
  likes_count: number | null;
  replies_count: number | null;
  shares_count: number | null;
  sentiment_label: string | null;
  collected_at: string | null;
  engagement?: number;
  engagement_score?: number;
  post_url?: string | null;
  post_title?: string | null;
  post_description?: string | null;
  thumbnail_url?: string | null;
  author_name?: string | null;
  author_handle?: string | null;
  author_profile_url?: string | null;
  post_id?: string | null;
  political_relevance_score?: number | null;
  political_validation_reason?: string | null;
  related_records?: number | null;
}

function normalizePlatformKey(value?: string | null): string {
  const v = (value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (["youtube", "yt", "invidious"].includes(v)) return "youtube";
  if (["twitter", "twitter/x", "x", "x/twitter"].includes(v)) return "twitter";
  if (["google news", "google_news", "googlenews"].includes(v)) return "google_news";
  if (["gdelt", "portal", "portais", "noticias", "news", "portal de noticia", "portal de noticias"].includes(v)) return "portal";
  if (["tik tok", "tiktok"].includes(v)) return "tiktok";
  return v || "unknown";
}

function isValidHttpsUrl(u?: string | null): u is string {
  return !!u && /^https:\/\/[^\s]+$/i.test(u.trim());
}

function buildPostUrl(p: PostRow): string | null {
  if (isValidHttpsUrl(p.post_url)) return (p.post_url as string).trim();
  const net = normalizePlatformKey(p.platform || p.social_network_raw || p.social_network);
  const pid = p.post_id?.trim();
  const handle = p.author_handle?.replace(/^@/, "").trim();
  if (!pid) return null;
  let candidate: string | null = null;
  if (net === "youtube") candidate = `https://www.youtube.com/watch?v=${pid}`;
  else if (net === "twitter") candidate = `https://x.com/${handle || "i"}/status/${pid}`;
  else if (net === "tiktok" && handle) candidate = `https://www.tiktok.com/@${handle}/video/${pid}`;
  else if (net === "instagram") candidate = `https://www.instagram.com/p/${pid}/`;
  else if (net === "facebook" && handle) candidate = `https://www.facebook.com/${handle}/posts/${pid}`;
  return isValidHttpsUrl(candidate) ? candidate : null;
}

// Deriva thumbnail oficial quando o registro não trouxer uma — YouTube tem URL
// determinística por video_id. Demais redes dependem do que o coletor salvou.
function buildThumbnail(p: PostRow): string | null {
  if (isValidHttpsUrl(p.thumbnail_url)) return (p.thumbnail_url as string).trim();
  const net = normalizePlatformKey(p.platform || p.social_network_raw || p.social_network);
  const pid = p.post_id?.trim();
  const url = buildPostUrl(p);
  const urlVideoId = url?.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1] || url?.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1];
  if (net === "youtube" && (pid || urlVideoId)) {
    const videoId = pid || urlVideoId;
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  return null;
}

// Imagem institucional usada quando o post não traz thumbnail válida.
const INSTITUTIONAL_FALLBACK = "/favicon.png";

// Palavras-chave que indicam conteúdo político brasileiro.
const POLITICAL_KEYWORDS = [
  "presidente","presidência","governador","governadora","senador","senadora",
  "deputado","deputada","prefeito","prefeita","vereador","vereadora","ministro","ministra",
  "ministério","câmara","camara","senado","congresso","assembleia","assembléia","planalto",
  "stf","tse","tcu","pgr","agu","governo","oposição","oposicao","eleição","eleicao","eleições","eleicoes",
  "campanha","candidatura","candidato","candidata","partido","coligação","coligacao","federação","federacao",
  "política","politica","político","politico","políticas","politicas","políticos","politicos",
  "lei","projeto de lei","pl ","pec","mp ","medida provisória","medida provisoria","reforma",
  "votação","votacao","plenário","plenario","sessão","sessao","comissão","comissao","cpi",
  "discurso","entrevista","coletiva","debate","sabatina","pronunciamento","agenda","posse","mandato",
  "pt","pl","pp","mdb","psdb","psd","união brasil","uniao brasil","podemos","novo","psol","pdt","psb","republicanos","cidadania","avante","solidariedade","pcdob","pv","rede",
  "lula","bolsonaro","alckmin","haddad","tarcísio","tarcisio","caiado","zema","ratinho","leite","castro","cláudio","claudio","nunes","boulos","datena","marçal","marcal","pacheco","lira","alcolumbre","motta","moraes","fachin","barroso","mendonça","mendonca","gilmar","dino","janja","michelle",
  "esquerda","direita","centro","conservador","progressista","liberal","bolsonarismo","lulismo",
  "imposto","tributária","tributaria","orçamento","orcamento","fiscal","economia","emprego","salário mínimo","salario minimo","bolsa família","bolsa familia","pé-de-meia","pe de meia",
  "segurança pública","seguranca publica","saúde","saude","educação","educacao","sus","previdência","previdencia",
  "marco civil","stf","supremo","tribunal","ministério público","ministerio publico","prefeitura","governo federal","governo estadual",
];

const NON_POLITICAL_KEYWORDS = [
  "novela","bbb","big brother","reality","fazenda","masterchef","carnaval","samba","funk","sertanejo",
  "futebol","flamengo","corinthians","palmeiras","são paulo fc","sao paulo fc","santos fc","vasco","fluminense","grêmio","gremio","internacional","atlético","atletico","cruzeiro","botafogo","seleção brasileira","selecao brasileira","copa","champions","libertadores","neymar","vini jr","vinicius jr","endrick","cr7","cristiano ronaldo","messi","mbappé","mbappe",
  "globo esporte","fantástico","fantastico","domingão","domingao","caldeirão","caldeirao","altas horas","programa do","faustão","faustao","ratinho","silvio santos",
  "anitta","luan santana","gusttavo lima","marília mendonça","marilia mendonca","henrique e juliano","jorge e mateus",
  "ufc","mma","fórmula 1","formula 1","f1","nba","tênis","tenis","vôlei","volei",
  "trailer","teaser","filme","série","serie","temporada","episódio","episodio","netflix","disney+","prime video","hbo","spotify","apple music","clipe oficial","videoclipe","videoclip","music video","lyrics","letra",
  "receita","culinária","culinaria","comida","restaurante","gastronomia","cerveja","whisky",
  "tutorial","unboxing","gameplay","minecraft","fortnite","free fire","valorant","league of legends",
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Classificação semântica leve combinando: nomes monitorados, palavras-chave políticas,
 * pistas institucionais no autor e penalidade para conteúdo claramente não-político.
 * Retorna um score 0..N — quanto maior, mais relevante politicamente.
 */
function politicalScore(p: PostRow, monitoredNames: string[] = []): number {
  const haystack = norm(
    [p.post_title, p.post_description, p.author_name, p.author_handle].filter(Boolean).join(" "),
  );
  if (!haystack.trim()) return 0;
  let score = 0;
  for (const name of monitoredNames) {
    const n = norm(name);
    if (!n || n.length < 3) continue;
    if (haystack.includes(n)) { score += 4; break; }
    const tokens = n.split(/\s+/).filter((t) => t.length >= 4);
    if (tokens.length >= 2 && tokens.every((t) => haystack.includes(t))) { score += 3; break; }
  }
  let kwHits = 0;
  for (const k of POLITICAL_KEYWORDS) {
    if (haystack.includes(norm(k))) { kwHits += 1; if (kwHits >= 3) break; }
  }
  score += Math.min(kwHits * 2, 4);
  const author = norm(`${p.author_name || ""} ${p.author_handle || ""}`);
  if (/\b(g1|cnn|globo|uol|folha|estadao|veja|exame|metropoles|jovempan|band|sbt|record|congresso|senado|camara|tse|stf|gov|oficial|partido|pt|pl|psdb|psol|pdt|psb|mdb)\b/.test(author)) {
    score += 2;
  }
  let nonHits = 0;
  for (const k of NON_POLITICAL_KEYWORDS) {
    if (haystack.includes(norm(k))) { nonHits += 1; if (nonHits >= 2) break; }
  }
  score -= Math.min(nonHits * 2, 4);
  return score;
}


function periodRange(period: PeriodKey, customStart: string, customEnd: string) {
  const end = period === "custom" && customEnd ? new Date(`${customEnd}T23:59:59`).toISOString() : null;
  if (period === "total") return { start: null, end };
  if (period === "custom") return { start: customStart ? new Date(`${customStart}T00:00:00`).toISOString() : null, end };
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : period === "6m" ? 180 : 365;
  return { start: subDays(new Date(), days).toISOString(), end };
}

function normalizeSentiment(label: string | null): "positive" | "negative" | "neutral" | null {
  const v = (label || "").trim().toLowerCase();
  if (["positivo", "positive", "pos"].includes(v)) return "positive";
  if (["negativo", "negative", "neg"].includes(v)) return "negative";
  if (["neutro", "neutral", "neu"].includes(v)) return "neutral";
  return null;
}

type SectionState<T> = { data: T | null; loading: boolean; error: string | null; ms: number };

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; ms: number; error: string | null; bytes: number }> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase.rpc(name as any, args);
    const ms = Math.round(performance.now() - t0);
    if (error) {
      console.warn(`[ReactionsPerPost] RPC ${name} falhou em ${ms}ms`, error);
      return { data: null, ms, error: error.message || "Falha desconhecida", bytes: 0 };
    }
    const bytes = JSON.stringify(data ?? null).length;
    console.log(`[ReactionsPerPost] RPC ${name} OK em ${ms}ms — payload ${(bytes / 1024).toFixed(1)} KB`);
    return { data: data as T, ms, error: null, bytes };
  } catch (e: any) {
    const ms = Math.round(performance.now() - t0);
    console.warn(`[ReactionsPerPost] RPC ${name} exception em ${ms}ms`, e);
    return { data: null, ms, error: e?.message || "Erro de rede", bytes: 0 };
  }
}

export function ReactionsPerPost({ candidateId }: Props) {
  const { user } = useAuth();
  const { isAdmin: _isAdmin } = useAdminCheck();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("total");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sentimentEnqueuedKey, setSentimentEnqueuedKey] = useState<string | null>(null);

  const range = useMemo(() => periodRange(selectedPeriod, customStart, customEnd), [selectedPeriod, customStart, customEnd]);

  type TotalsT = Omit<SummaryData, "dominantTopics" | "engagementByNetwork" | "sentimentByNetwork" | "activityHourWeek" | "topPosts">;
  const [totalsState, setTotalsState] = useState<SectionState<TotalsT>>({ data: null, loading: true, error: null, ms: 0 });
  const [engState, setEngState] = useState<SectionState<EngagementByNetwork[]>>({ data: [], loading: true, error: null, ms: 0 });
  const [sentNetState, setSentNetState] = useState<SectionState<SentimentByNetwork[]>>({ data: [], loading: true, error: null, ms: 0 });
  const [actState, setActState] = useState<SectionState<ActivityHourWeek[]>>({ data: [], loading: true, error: null, ms: 0 });
  const [topState, setTopState] = useState<SectionState<PostRow[]>>({ data: [], loading: true, error: null, ms: 0 });
  const [topicsState, setTopicsState] = useState<SectionState<{ topic: string; mentions: number }[]>>({ data: [], loading: true, error: null, ms: 0 });

  const [monitoredNames, setMonitoredNames] = useState<string[]>([]);
  const [topFallbackIdx, setTopFallbackIdx] = useState(0);
  const [autoCollectionKey, setAutoCollectionKey] = useState<string | null>(null);

  const fallbackLadder = useMemo<PeriodKey[]>(() => {
    if (selectedPeriod === "custom" || selectedPeriod === "total") return [selectedPeriod];
    const order: PeriodKey[] = ["7d", "30d", "90d", "6m", "1y", "total"];
    const i = order.indexOf(selectedPeriod);
    return i >= 0 ? order.slice(i) : [selectedPeriod];
  }, [selectedPeriod]);
  const effectiveTopPeriod = fallbackLadder[Math.min(topFallbackIdx, fallbackLadder.length - 1)] ?? selectedPeriod;
  const topRange = useMemo(
    () => periodRange(effectiveTopPeriod, customStart, customEnd),
    [effectiveTopPeriod, customStart, customEnd],
  );

  useEffect(() => { setTopFallbackIdx(0); }, [selectedPeriod, candidateId, customStart, customEnd]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const q = candidateId
        ? supabase.from("candidates").select("full_name").eq("id", candidateId)
        : supabase.from("candidates").select("full_name").eq("user_id", user.id).limit(200);
      const { data } = await q;
      if (!active) return;
      setMonitoredNames((data || []).map((c) => c.full_name).filter(Boolean) as string[]);
    })();
    return () => { active = false; };
  }, [user, candidateId]);


  const reqKey = `${user?.id}|${candidateId || "all"}|${range.start || "ALL"}|${range.end || "OPEN"}`;
  const topReqKey = `${user?.id}|${candidateId || "all"}|${topRange.start || "ALL"}|${topRange.end || "OPEN"}`;

  const loadAll = useMemo(() => async () => {
    if (!user) return;
    const args = {
      _user_id: user.id,
      _candidate_id: candidateId ?? null,
      _period_start: range.start,
      _period_end: range.end,
    };
    setTotalsState((s) => ({ ...s, loading: true, error: null }));
    setEngState((s) => ({ ...s, loading: true, error: null }));
    setSentNetState((s) => ({ ...s, loading: true, error: null }));
    setActState((s) => ({ ...s, loading: true, error: null }));
    setTopicsState((s) => ({ ...s, loading: true, error: null }));

    const tStart = performance.now();
    const [totals, eng, sentNet, act, topics] = await Promise.all([
      callRpc<TotalsT>("get_reactions_totals", args),
      callRpc<EngagementByNetwork[]>("get_reactions_engagement_by_network", args),
      callRpc<SentimentByNetwork[]>("get_reactions_sentiment_by_network", args),
      callRpc<ActivityHourWeek[]>("get_reactions_activity_hour_week", args),
      callRpc<{ topic: string; mentions: number }[]>("get_reactions_dominant_topics", args),
    ]);
    console.log("[ReactionsPerPost] DEBUG carga total", {
      tempoTotalMs: Math.round(performance.now() - tStart),
      totaisMs: totals.ms, totaisErro: totals.error,
      engajamentoMs: eng.ms, engajamentoErro: eng.error,
      sentimentoMs: sentNet.ms, sentimentoErro: sentNet.error,
      atividadeMs: act.ms, atividadeErro: act.error,
      topicosMs: topics.ms, topicosErro: topics.error,
    });
    setTotalsState({ data: totals.data, loading: false, error: totals.error, ms: totals.ms });
    setEngState({ data: eng.data ?? [], loading: false, error: eng.error, ms: eng.ms });
    setSentNetState({ data: sentNet.data ?? [], loading: false, error: sentNet.error, ms: sentNet.ms });
    setActState({ data: act.data ?? [], loading: false, error: act.error, ms: act.ms });
    setTopicsState({ data: topics.data ?? [], loading: false, error: topics.error, ms: topics.ms });
  }, [user, candidateId, range.start, range.end]);

  useEffect(() => { void loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [reqKey]);

  // Top posts em fluxo próprio para suportar fallback automático de período.
  useEffect(() => {
    if (!user) return;
    setTopState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const top = await callRpc<PostRow[]>("get_reactions_top_posts", {
        _user_id: user.id,
        _candidate_id: candidateId ?? null,
        _period_start: topRange.start,
        _period_end: topRange.end,
      });
      setTopState({ data: top.data ?? [], loading: false, error: top.error, ms: top.ms });
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [topReqKey]);


  const summary = totalsState.data;
  const summaryLoading = totalsState.loading;
  const summaryIsError = !!totalsState.error && !summary;
  const summaryFetching = totalsState.loading;
  const refetchSummary = loadAll;

  useEffect(() => {
    if (!user || !summary || (summary.pendingCount || 0) <= 0) return;
    const key = `${user.id}:${candidateId || "all"}:${range.start || "total"}:${range.end || "open"}:${summary.pendingCount}`;
    if (sentimentEnqueuedKey === key) return;
    setSentimentEnqueuedKey(key);

    (async () => {
      let pendingRemaining = summary.pendingCount || 0;
      let totalEnqueued = 0;
      for (let batch = 0; batch < 20 && pendingRemaining > 0; batch += 1) {
        const { data, error } = await supabase.rpc("enqueue_pending_sentiment_jobs" as any, {
          _user_id: user.id,
          _candidate_id: candidateId ?? null,
          _period_start: range.start,
          _period_end: range.end,
          _batch_size: 5000,
        });
        if (error) {
          console.warn("[ReactionsPerPost] Falha ao enfileirar classificação IA automática", error);
          return;
        }
        const result = data as { enqueued?: number; pendingRemaining?: number } | null;
        totalEnqueued += result?.enqueued || 0;
        pendingRemaining = result?.pendingRemaining ?? 0;
        if (!result?.enqueued) break;
      }
      console.log("[ReactionsPerPost] Classificação IA automática enfileirada", { totalEnqueued, pendingRemaining });
    })();
  }, [candidateId, range.end, range.start, sentimentEnqueuedKey, summary, user]);

  const totals = useMemo(() => {
    const d = summary;
    const pos = d?.positiveCount || 0;
    const neg = d?.negativeCount || 0;
    const neu = d?.neutralCount || 0;
    const labeled = d?.classifiedCount || 0;
    const totalRecords = d?.totalRecords || 0;
    const pending = d?.pendingCount ?? Math.max(0, totalRecords - labeled);
    const denom = totalRecords > 0 ? totalRecords : 1;
    return {
      pos, neg, neu, labeled, pending, totalRecords,
      postsCount: d?.postsCount || 0,
      commentsCount: d?.commentsCount || 0,
      totalLikes: d?.totalLikes || 0,
      totalShares: d?.totalShares || 0,
      totalInteractions: d?.totalInteractions || 0,
      posPct: Math.round((pos / denom) * 100),
      negPct: Math.round((neg / denom) * 100),
      neuPct: Math.round((neu / denom) * 100),
      pendingPct: Math.round((pending / denom) * 100),
    };
  }, [summary]);

  const top5 = useMemo(() => {
    const list = topState.data || [];
    const scored = list.map((p) => {
      const engagement = p.engagement ?? p.engagement_score ?? ((p.likes_count || 0) + (p.replies_count || 0) + (p.shares_count || 0));
      const relevance = politicalScore(p, monitoredNames);
      const platform = normalizePlatformKey(p.platform || p.social_network_raw || p.social_network);
      return { ...p, engagement, _relevance: relevance, _platform: platform };
    });
    const filtered = scored
      .filter((p) => (p.political_relevance_score ?? p._relevance) >= 2 && buildPostUrl(p))
      .sort((a, b) => b.engagement - a.engagement || (b.political_relevance_score ?? b._relevance) - (a.political_relevance_score ?? a._relevance));
    const bestByPlatform = new Map<string, typeof filtered[number]>();
    for (const post of filtered) {
      if (!bestByPlatform.has(post._platform)) bestByPlatform.set(post._platform, post);
    }
    const primary = Array.from(bestByPlatform.values()).sort((a, b) => b.engagement - a.engagement);
    const picked = primary.slice(0, 5);
    if (picked.length < 5) {
      for (const post of filtered) {
        if (picked.some((p) => p.id === post.id)) continue;
        const platformCount = picked.filter((p) => p._platform === post._platform).length;
        if (platformCount >= 2 && filtered.some((p) => !picked.some((x) => x.id === p.id) && picked.filter((x) => x._platform === p._platform).length === 0)) continue;
        picked.push(post);
        if (picked.length === 5) break;
      }
    }
    return picked.sort((a, b) => b.engagement - a.engagement || (b.political_relevance_score ?? b._relevance) - (a.political_relevance_score ?? a._relevance));
  }, [topState.data, monitoredNames]);

  // Fallback automático de período: se nada relevante, expande a janela.
  useEffect(() => {
    if (topState.loading) return;
    if (top5.length > 0) return;
    if (topFallbackIdx < fallbackLadder.length - 1) {
      setTopFallbackIdx((i) => i + 1);
    }
  }, [topState.loading, top5.length, topFallbackIdx, fallbackLadder.length]);

  useEffect(() => {
    if (!user || topState.loading || top5.length > 0 || topFallbackIdx < fallbackLadder.length - 1) return;
    const key = `${user.id}:${candidateId || "all"}:${selectedPeriod}:${customStart}:${customEnd}`;
    if (autoCollectionKey === key) return;
    setAutoCollectionKey(key);
    (async () => {
      await supabase.rpc("reprocess_social_interactions_political_validation" as any, { _batch_size: 10000 });
      await Promise.allSettled([
        supabase.functions.invoke("google-news-collector"),
        supabase.functions.invoke("gdelt-collector", { body: candidateId ? { candidateId } : {} }),
        supabase.functions.invoke("search-twitter-mentions", { body: candidateId ? { candidateId } : {} }),
        supabase.functions.invoke("tiktok-collector", { body: candidateId ? { candidateId } : {} }),
        supabase.functions.invoke("facebook-rss-collector", { body: candidateId ? { candidateId } : {} }),
      ]);
      setTimeout(() => {
        setTopFallbackIdx(0);
        void loadAll();
      }, 8000);
    })().catch((error) => console.warn("[ReactionsPerPost] coleta política automática falhou", error));
  }, [autoCollectionKey, candidateId, customEnd, customStart, fallbackLadder.length, loadAll, selectedPeriod, top5.length, topFallbackIdx, topState.loading, user]);

  useEffect(() => {
    if (!user || topState.loading || top5.length === 0) return;
    const needsMediaRepair = top5.some((p) => !buildThumbnail(p) || !buildPostUrl(p));
    if (!needsMediaRepair) return;
    const key = `${user.id}:${candidateId || "all"}:${effectiveTopPeriod}:media-repair`;
    if (autoCollectionKey === key) return;
    setAutoCollectionKey(key);
    void supabase.functions.invoke("orchestrate-all-collectors", {
      body: candidateId ? { collector: "all", candidateId } : { collector: "all" },
    }).then(() => {
      setTimeout(() => setTopFallbackIdx(0), 10000);
    }).catch((error) => console.warn("[ReactionsPerPost] recoleta de mídia do Top 5 falhou", error));
  }, [autoCollectionKey, candidateId, effectiveTopPeriod, top5, topState.loading, user]);


  const topTopics = useMemo(() => {
    return (topicsState.data || []).slice(0, 8)
      .map((t) => ({ label: t.topic.charAt(0).toUpperCase() + t.topic.slice(1), mentions: t.mentions }));
  }, [topicsState.data]);

  function dominantSentiment(label: string | null) {
    const s = normalizeSentiment(label);
    if (s === "positive") return { label: "Positivo", color: "text-emerald-600 border-emerald-500/40 bg-emerald-500/10", Icon: ThumbsUp };
    if (s === "negative") return { label: "Negativo", color: "text-rose-600 border-rose-500/40 bg-rose-500/10", Icon: ThumbsDown };
    return { label: "Neutro", color: "text-muted-foreground border-border bg-muted", Icon: Minus };
  }

  return (
    <Card className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HelpTooltip text="Resumo agregado dos posts coletados. Sem listagem de comentários para garantir carregamento rápido.">
          <div className="cursor-help">
            <h3 className="text-lg font-bold">Reações por posts</h3>
            <p className="text-sm text-muted-foreground">Métricas agregadas — gráficos e top 5 posts</p>
          </div>
        </HelpTooltip>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedPeriod} onValueChange={(v) => setSelectedPeriod(v as PeriodKey)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Período" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="total">Total</SelectItem>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
              <SelectItem value="90d">90 dias</SelectItem>
              <SelectItem value="6m">6 meses</SelectItem>
              <SelectItem value="1y">1 ano</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {selectedPeriod === "custom" && (
            <>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-[150px]" />
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-[150px]" />
            </>
          )}
        </div>
      </div>

      {summaryLoading && !summaryIsError ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-sm text-muted-foreground">Processando análise...</p>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : summaryIsError ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 py-8 text-center">
          <AlertCircle className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">Não foi possível carregar os dados</p>
          <p className="text-xs text-muted-foreground max-w-md">
            Detalhe: {totalsState.error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchSummary(); }}
            disabled={summaryFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />Atualizar análise
          </Button>
        </div>
      ) : totals.totalRecords === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum registro no período.</div>
      ) : (
        <>
          {/* KPIs principais */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiBox label="Registros analisados" value={totals.totalRecords} highlight />
            <KpiBox label="Posts" value={totals.postsCount} />
            <KpiBox label="Comentários / respostas" value={totals.commentsCount} />
            <KpiBox label="Interações totais" value={totals.totalInteractions} />
            <KpiBox label="Sentimento geral" value={totals.posPct - totals.negPct} suffix="%" tone={totals.posPct >= totals.negPct ? "pos" : "neg"} />
          </div>

          {/* Barra de sentimento consolidado */}
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Sentimento consolidado{" "}
              <span className="ml-1 normal-case text-[10px] text-muted-foreground/80">
                (pos + neu + neg + sem classificação = {totals.totalRecords.toLocaleString("pt-BR")})
              </span>
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <KpiBox label={`Positivo (${totals.posPct}%)`} value={totals.pos} tone="pos" />
              <KpiBox label={`Neutro (${totals.neuPct}%)`} value={totals.neu} tone="neu" />
              <KpiBox label={`Negativo (${totals.negPct}%)`} value={totals.neg} tone="neg" />
              <KpiBox label={`Sem classificação (${totals.pendingPct}%)`} value={totals.pending} />
            </div>
            <div className="flex h-3 w-full rounded overflow-hidden border border-border">
              <div className="bg-success" style={{ width: `${totals.posPct}%` }} />
              <div className="bg-warning" style={{ width: `${totals.neuPct}%` }} />
              <div className="bg-destructive" style={{ width: `${totals.negPct}%` }} />
              <div className="bg-muted" style={{ width: `${totals.pendingPct}%` }} />
            </div>
          </div>

          {topTopics.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Assuntos dominantes:</span>
              {topTopics.map((t) => (
                <Badge key={t.label} variant="secondary" className="text-xs">{t.label} · {t.mentions.toLocaleString("pt-BR")}</Badge>
              ))}
            </div>
          )}

          {/* Gráficos — lazy loaded */}
          <Suspense fallback={<Skeleton className="h-80 w-full" />}>
            <ChartsBlock
              positive={totals.pos}
              negative={totals.neg}
              neutral={totals.neu}
              pending={totals.pending}
              engagementByNetwork={engState.data || []}
              sentimentByNetwork={sentNetState.data || []}
              activityHourWeek={actState.data || []}
            />
          </Suspense>

          {/* Top 5 posts */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h4 className="text-sm font-semibold">Top 5 posts por engajamento</h4>
              {topFallbackIdx > 0 && top5.length > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  Janela expandida para {effectiveTopPeriod === "total" ? "todo o histórico" : effectiveTopPeriod}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {top5.map((p) => {
                const ds = dominantSentiment(p.sentiment_label);
                const url = buildPostUrl(p);
                const author = p.author_name || p.author_handle || "Autor desconhecido";
                const title = p.post_title || p.post_description || "(sem título disponível)";
                return (
                  <Card key={p.id} className="p-3 flex flex-col gap-2 overflow-hidden">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{p.social_network || "?"}</Badge>
                      <Badge className={`text-[10px] border ${ds.color}`}>
                        <ds.Icon className="h-3 w-3 mr-1" />{ds.label}
                      </Badge>
                    </div>

                    {/* Thumbnail real do post; fallback institucional somente se não houver imagem válida */}
                    {(() => {
                      const thumb = buildThumbnail(p);
                      const imgSrc = thumb || INSTITUTIONAL_FALLBACK;
                      const wrapperClass = `relative block aspect-video w-full overflow-hidden rounded-md bg-muted ${url ? "cursor-pointer" : "cursor-default"}`;
                      const ImgEl = (
                        <img
                          src={imgSrc}
                          alt={title}
                          loading="lazy"
                          className={`h-full w-full ${thumb ? "object-cover" : "object-contain p-6 opacity-80"} transition-transform hover:scale-105`}
                          onError={(e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            if (img.src.endsWith(INSTITUTIONAL_FALLBACK)) return;
                            img.src = INSTITUTIONAL_FALLBACK;
                            img.classList.remove("object-cover");
                            img.classList.add("object-contain", "p-6", "opacity-80");
                          }}
                        />
                      );
                      return url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className={wrapperClass}>{ImgEl}</a>
                      ) : (
                        <div className={wrapperClass}>{ImgEl}</div>
                      );
                    })()}


                    <div className="text-xs text-muted-foreground">
                      {p.collected_at ? new Date(p.collected_at).toLocaleDateString("pt-BR") : "—"}
                    </div>

                    <div className="text-sm font-semibold leading-snug line-clamp-2" title={title}>
                      {title}
                    </div>

                    {p.post_description && p.post_title && (
                      <div className="text-xs text-muted-foreground line-clamp-2">{p.post_description}</div>
                    )}

                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">Publicado por</div>
                    {p.author_profile_url ? (
                      <a
                        href={p.author_profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline truncate"
                      >
                        <User className="h-3 w-3" />{author}
                      </a>
                    ) : (
                      <div className="flex items-center gap-1 text-xs font-medium truncate">
                        <User className="h-3 w-3" />{author}
                      </div>
                    )}

                    <div className="text-xl font-bold mt-1">{p.engagement.toLocaleString("pt-BR")}</div>
                    <div className="text-[10px] text-muted-foreground -mt-1">Engajamento total</div>

                    <div className="flex justify-between gap-2 text-xs pt-2 border-t">
                      <span className="flex items-center gap-1" title="Curtidas"><Heart className="h-3 w-3" />{(p.likes_count || 0).toLocaleString("pt-BR")}</span>
                      <span className="flex items-center gap-1" title="Comentários"><MessageCircle className="h-3 w-3" />{(p.replies_count || 0).toLocaleString("pt-BR")}</span>
                      <span className="flex items-center gap-1" title="Compartilhamentos"><Share2 className="h-3 w-3" />{(p.shares_count || 0).toLocaleString("pt-BR")}</span>
                    </div>

                    <div className="mt-2">
                      {url ? (
                        <Button asChild size="sm" variant="outline" className="w-full">
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3 mr-1" />Ver publicação
                          </a>
                        </Button>
                      ) : (
                        <p className="text-[10px] text-center text-muted-foreground italic">Link original indisponível</p>
                      )}
                    </div>
                  </Card>
                );
              })}
              {top5.length === 0 && (
               <p className="text-sm text-muted-foreground col-span-full">
                  {topState.loading || topFallbackIdx < fallbackLadder.length - 1
                    ? "Buscando conteúdos políticos relevantes em períodos maiores..."
                    : "Nenhum post político relevante encontrado, mesmo expandindo até todo o histórico."}
                </p>
              )}
            </div>
          </div>

        </>
      )}
    </Card>
  );
}

function KpiBox({ label, value, highlight = false, tone, suffix }: { label: string; value: number; highlight?: boolean; tone?: "pos" | "neg" | "neu"; suffix?: string }) {
  const toneClass =
    tone === "pos" ? "bg-success/10 border-success/30"
    : tone === "neg" ? "bg-destructive/10 border-destructive/30"
    : tone === "neu" ? "bg-warning/10 border-warning/30"
    : highlight ? "bg-primary/10 border-primary/30"
    : "bg-muted/40";
  return (
    <div className={`p-3 rounded-lg border ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value.toLocaleString("pt-BR")}{suffix || ""}</div>
    </div>
  );
}
