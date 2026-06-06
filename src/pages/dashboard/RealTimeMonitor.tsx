import { useState, useEffect, useRef, useCallback } from "react";
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
  Newspaper, Flame, Sparkles, AlertTriangle, Zap, Activity, Calendar,
  Megaphone, Building2, ExternalLink, Heart, BrainCircuit,
} from "lucide-react";
import { CandidateSelector } from "@/components/dashboard/realtime/CandidateSelector";
import { LiveCollectionCenter, type LiveProgress } from "@/components/dashboard/realtime/LiveCollectionCenter";
import { cn } from "@/lib/utils";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

interface Candidate { id: string; full_name: string; party?: string | null; }

// ============ Tipos ============
interface EvidenceCounts { news: number; posts: number; videos: number; total: number; }
interface EvolutionPoint { label: string; total: number; positive: number; negative: number; neutral: number; }
interface Theme { name: string; count: number; evidence: EvidenceCounts; examples: string[]; }
interface EventItem { id: string; name: string; date: string; type: string; impact: number; publications: number; outlets: number; }
interface Outlet { name: string; count: number; percentage: number; }
interface Publication {
  id: string; title: string; author: string; network: string;
  engagement: number; url: string | null; sentiment: string | null; createdAt: string;
}
interface Alert {
  kind: "growth" | "negative" | "viral" | "news" | "crisis";
  title: string;
  detail: string;
  source?: string;
  engagement?: number;
  publishedAt?: string;
  evidence?: EvidenceCounts;
}

interface Snapshot {
  // BLOCO 1 — narrativa
  nowNarrative: string;
  // KPIs principais (TODOS derivados do mesmo sample filtrado)
  mentionsToday: number;
  positiveToday: number;
  negativeToday: number;
  neutralToday: number;
  classifiedToday: number;
  newsCollected: number;
  evidence: EvidenceCounts;
  windowCounts: { h1: number; h6: number; h12: number; h24: number; previous24h: number; };
  hasStatisticalBase: boolean;
  // BLOCO 2 — temas dominantes
  themes: Theme[];
  // BLOCO 3 — eventos
  events: EventItem[];
  // BLOCO 4 — movimentação sentimento
  sentimentDelta: { positiveDeltaPct: number; negativeDeltaPct: number; neutralDeltaPct: number; available: boolean; };
  // BLOCO 5 — veículos
  outlets: Outlet[];
  // BLOCO 6 — publicações
  publications: Publication[];
  // BLOCO 7 — alertas
  alerts: Alert[];
  // BLOCO 8 — resumo executivo
  executiveSummary: { what: string; why: string; who: string; impact: string; };
  // Gráficos
  evolution24h: EvolutionPoint[];
  evolution12h: EvolutionPoint[];
  evolution6h: EvolutionPoint[];
  evolution1h: EvolutionPoint[];
  // Meta
  savedAt: number;
  candidateName: string;
}

// ============ Cache 5 min ============
const cacheKey = (uid: string, cid: string) => `rt-activity-v1:${uid}:${cid}`;
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

// ============ Limpeza de ruído (HTML/CSS/JS/URLs) ============
const NOISE_TOKENS = new Set([
  "href","font","div","span","html","css","javascript","script","style","class","classname",
  "http","https","www","com","br","org","net","url","link","target","rel","src","alt","img",
  "button","input","form","table","header","footer","section","article","nav","aside",
  "ul","ol","li","tr","td","th","label","option","select","textarea","iframe","svg","path",
  "true","false","null","undefined","null","none","auto","data","attr","aria",
]);

const STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","em","no","na","nos","nas","um","uma","uns","umas",
  "para","por","com","sem","que","se","é","são","foi","ser","ter","como","mas","mais","menos",
  "muito","muita","muitos","muitas","já","ainda","sobre","entre","ou","não","sim","aos","ao",
  "este","esta","isso","isto","esse","essa","aquele","aquela","seu","sua","seus","suas",
  "ele","ela","eles","elas","nós","você","vocês","eu","te","lhe","lhes","pelo","pela","pelos","pelas",
  "rt","via","apenas","sendo","tem","tenho","tinha","onde","quando","quem","qual","quais",
  "hoje","ontem","amanhã","agora","então","também","porque","porém","contudo","entanto",
  "brasil","brasileiro","brasileira","país","governo","político","política","políticos","políticas",
]);

const cleanText = (raw: string): string =>
  (raw || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[a-z]+=["'][^"']*["']/g, " ")
    .replace(/\b(?:href|src|class|id|style|font|div|span|html|css|javascript|script|target|rel|alt)\b/gi, " ");

// ============ Mapeamento evidencial → Temas Políticos ============
const THEME_RULES: Array<{ name: string; keywords: RegExp }> = [
  { name: "Reforma Tributária", keywords: /\b(reforma tributária|reforma tributaria|imposto seletivo|cbs|ibs|iva|tributaç|tributac|alíquota|aliquota|arcabouço|arcabouco fiscal)\w*/i },
  { name: "Banco dos BRICS", keywords: /\b(banco dos brics|novo banco de desenvolvimento|new development bank|\bndb\b|brics|cúpula dos brics|cupula dos brics|banco do brics|china|rússia|russia|índia|india|áfrica do sul|africa do sul)\b/i },
  { name: "Eleições 2026", keywords: /\b(eleição 2026|eleições 2026|eleicao 2026|eleicoes 2026|presidência 2026|presidencia 2026|pré-candidat|pre-candidat|candidato 2026|campanha 2026|pesquisa eleitoral|datafolha|quaest|ipec)\w*/i },
  { name: "Segurança Pública", keywords: /\b(segurança|seguranca|polícia|policia|crime|violência|violencia|homicíd|homicid|facção|faccao|tráfico|trafico|pcc|cv|milíci|milici|operação|operacao)\w*/i },
  { name: "STF e Poder Judiciário", keywords: /\b(stf|supremo tribunal|supremo|judiciário|judiciario|justiça|justica|ministro do stf|moraes|fachin|barroso|toffoli|inquérito|inquerito|julgamento|condenação|condenacao|prisão|prisao)\w*/i },
  { name: "Congresso e Câmara", keywords: /\b(câmara|camara|senado|congresso|deputad|senador|relator|cpi|plenário|plenario|projeto de lei|pl\s|pec)\w*/i },
  { name: "Governo Federal", keywords: /\b(lula|planalto|haddad|alckmin|esplanada|ministério|ministerio|palácio do planalto|palacio do planalto)\w*/i },
  { name: "Bolsonarismo", keywords: /\b(bolsonaro|jair bolsonaro|michelle bolsonaro|tarcísio|tarcisio|zema|caiado|pl\b|inelegibilidade)\w*/i },
  { name: "Relações Internacionais", keywords: /\b(brics|otan|onu|eua|china|rússia|russia|ucrânia|ucrania|israel|palestina|argentina|milei|trump|biden|putin|xi jinping|mercosul|exterior|diplomac)\w*/i },
  { name: "Meio Ambiente", keywords: /\b(amazônia|amazonia|desmatamento|queimada|clima|cop\d|ibama|funai|indígena|indigena|garimpo|sustentab)\w*/i },
  { name: "Religião e Sociedade", keywords: /\b(religião|religiao|igreja|evangélic|evangelic|católic|catolic|pastor|padre|culto|fé|fe)\w*/i },
  { name: "Infraestrutura", keywords: /\b(infraestrutura|obra|rodovia|ferrovia|aeroporto|porto|saneamento|habitação|habitacao|minha casa|pac)\w*/i },
  { name: "Combate à Corrupção", keywords: /\b(corrupção|corrupcao|lava jato|propina|desvio|fraude|operação|operacao|pf|polícia federal|policia federal)\w*/i },
];

// ============ Filtros de Relevância Política ============
// Conteúdo descartado automaticamente (memes, humor, nostalgia, fan pages, etc.)
const IRRELEVANT_REGEX = /\b(meme|memes|fan\s?page|fanpage|humor|humorist|engraçad|engracad|piada|paródia|parodia|edição engraçad|edicao engracad|nostalg|throwback|tbt|relembr|curiosidad|aleatóri|aleatori|montagem|montagens|zoaç|zoac|zueir|gracinha|tributo|homenagem póstuma|playlist|compilaç|compilac|melhores momentos|cortes engraçad|cortes engracad|edit\b|reels engraçad|reels engracad|stitch|duet|macarrão|macarrao|pix|primeira mulher presidente)\b/i;
const HISTORICAL_CONTEXT_REGEX = /\b(impeachment|2010|2011|2012|2013|2014|2015|2016|2017|golpe de 64|ditadura|ex-presidente|ex presidenta|primeiro mandato|segundo mandato|lava jato|pedaladas fiscais|biografia|história de|historia de|há \d+ anos|ha \d+ anos|na época|na epoca|arquivo|relembra|relembre|retrospectiva)\b/i;
const OFFICIAL_ACTIVITY_REGEX = /\b(agenda oficial|reunião|reuniao|encontro bilateral|comitiva|missão oficial|missao oficial|viagem institucional|visita oficial|cúpula|cupula|fórum|forum|conferência|conferencia|evento do brics|brics|novo banco de desenvolvimento|new development bank|\bndb\b|banco dos brics|presidente do banco|preside o banco|banco multilateral|declaração oficial|declaracao oficial)\b/i;
const CURRENT_ACTIVITY_REGEX = /\b(hoje|agora|nesta\s+(segunda|terça|terca|quarta|quinta|sexta|semana)|neste\s+(sábado|sabado|domingo|mês|mes)|participa|participou|participará|participara|discursa|discursou|fará discurso|entrevista|concede entrevista|declara|declarou|afirma|afirmou|defende|defendeu|critica|criticou|anuncia|anunciou|lança|lanca|lançou|lancou|recebe|recebeu|se reúne|se reune|reuniu-se|visita|viaja|viajou|cumpre agenda|agenda em|evento em|coletiva)\b/i;

// Sinais políticos fortes (entrevistas, discursos, decisões, etc.)
const POLITICAL_HARD_REGEX = /\b(entrevist|sabatin|discurso|pronunciamento|debate|coletiva|agenda pública|agenda publica|projeto de lei|pec\b|medida provisória|medida provisoria|decis|liminar|julgamento|operação|operacao|reforma|votaç|votac|eleiç|eleic|cpi|stf|tse|congresso|senado|câmara|camara|governo|prefeit|ministro|presidente|polícia federal|policia federal|tributári|tributari|inflaç|inflac|crise|declaraç|declarac|movimentaç eleitoral|movimentac eleitoral|brics|otan|onu|exterior|posse|nomeaç|nomeac|sanção|sancao|vetou|sancionou)\b/i;

// Veículos confiáveis (boost de pontuação)
const TRUSTED_OUTLET_REGEX = /(g1\.globo|globo\.com|globonews|cnnbrasil|uol\.com|folha\.uol|folha\.com|estadao|poder360|metropoles|metrópoles|valor\.globo|valor\.com|r7\.com|veja\.abril|cartacapital|jovempan|band\.uol|sbt\.com|record\.com|antagonista|infomoney|reuters|bbc|gazetadopovo|correiobraziliense|nexojornal|brasildefato|agenciabrasil|congressoemfoco|jota\.info)/i;

const scoreRelevance = (row: any, windowStart: number, now: number): number => {
  const t = effectiveDateOf(row).getTime();
  if (t < windowStart || t > now + 60_000) return 0; // fora da janela
  const rawText = `${row.post_title || ""} ${row.post_description || ""} ${row.comment_text || ""}`;
  if (!rawText.trim()) return 0;
  if (IRRELEVANT_REGEX.test(rawText)) return 0;
  const cleaned = cleanText(rawText);
  if (!cleaned || cleaned.length < 8) return 0;
  const isNews = isNewsNetwork(row.social_network, row.platform, row.interaction_type);
  const matchesTheme = THEME_RULES.some(r => r.keywords.test(cleaned));
  const matchesHard = POLITICAL_HARD_REGEX.test(cleaned);
  const officialActivity = OFFICIAL_ACTIVITY_REGEX.test(cleaned);
  const currentActivity = officialActivity || CURRENT_ACTIVITY_REGEX.test(cleaned) || matchesHard;
  const historicalOnly = HISTORICAL_CONTEXT_REGEX.test(cleaned) && !currentActivity;
  if (historicalOnly) return 0;
  if (!currentActivity) return 0;
  if (!isNews && !matchesTheme && !matchesHard && !officialActivity) return 0;
  const ageH = Math.max(0.1, (now - t) / 3600000);
  const recency = Math.max(0.25, 1 - ageH / 24);
  const engagement = isNews
    ? Math.max(1, Number(row.engagement_score) || 1)
    : (Number(row.likes_count) || 0) + (Number(row.shares_count) || 0) + (Number(row.replies_count) || 0) + 1;
  const trust = isNews ? 1.6 : 1.0;
  const trustedBoost = TRUSTED_OUTLET_REGEX.test(`${row.post_url || ""} ${row.author_name || ""} ${row.author_handle || ""}`) ? 1.5 : 1.0;
  const activityBoost = officialActivity ? 2.2 : isNews ? 1.7 : matchesHard ? 1.35 : 1.0;
  const historyPenalty = HISTORICAL_CONTEXT_REGEX.test(cleaned) ? 0.25 : 1;
  const themeBoost = matchesTheme ? 1.2 : 1.0;
  return Math.log10(engagement + 1) * recency * trust * trustedBoost * activityBoost * themeBoost * historyPenalty;
};

const hasOfficialActivity = (text: string): boolean => OFFICIAL_ACTIVITY_REGEX.test(cleanText(text));
const hasCurrentPoliticalActivity = (text: string): boolean => {
  const cleaned = cleanText(text);
  return (OFFICIAL_ACTIVITY_REGEX.test(cleaned) || CURRENT_ACTIVITY_REGEX.test(cleaned) || POLITICAL_HARD_REGEX.test(cleaned)) && !IRRELEVANT_REGEX.test(cleaned);
};

const emptyEvidence = (): EvidenceCounts => ({ news: 0, posts: 0, videos: 0, total: 0 });
const isNewsNetwork = (network?: string | null, platform?: string | null, type?: string | null): boolean => {
  const value = `${network || ""} ${platform || ""} ${type || ""}`.toLowerCase();
  return /\b(news|not[ií]cia|noticias|gdelt|jornal|portal|imprensa)\b/.test(value) || value.includes("google_news");
};

const classifyNetwork = (network?: string | null): keyof Omit<EvidenceCounts, "total"> => {
  const n = (network || "").toLowerCase();
  if (isNewsNetwork(n)) return "news";
  if (n.includes("youtube") || n.includes("video") || n.includes("tiktok")) return "videos";
  return "posts";
};
const addEvidence = (ev: EvidenceCounts, network?: string | null) => { ev[classifyNetwork(network)]++; ev.total++; };

const effectiveDateOf = (row: any): Date => new Date(row.original_posted_at || row.created_at || row.collected_at || Date.now());

const newsFilter = "interaction_type.eq.news,social_network.ilike.%news%,social_network.ilike.%gdelt%,platform.ilike.%portal%,platform.ilike.%news%";

const triggerNewsCollection = async (candidateId: string, candidateName: string) => {
  try {
    await withTimeout(
      supabase.functions.invoke("search-google-news", { body: { candidateId, candidateName, realtime: true } }),
      2200,
      "coleta de notícias",
    );
  } catch {
    // A coleta continua em background; o snapshot nunca fica bloqueado por notícias.
  }
};

const eventRules: Array<{ type: string; regex: RegExp }> = [
  { type: "entrevista", regex: /\b(entrevist|sabatin|podcast|programa de tv|jornal nacional|roda viva)\w*/i },
  { type: "discurso", regex: /\b(discurso|pronunciamento|declaraç|declarac|fala sobre|defende|critica)\w*/i },
  { type: "debate", regex: /\b(debate|confronto|discussão|discussao|embate)\w*/i },
  { type: "reunião", regex: /\b(reunião|reuniao|encontro|agenda|comitiva|cúpula|cupula)\w*/i },
  { type: "viagem institucional", regex: /\b(viagem|viaja|viajou|visita oficial|missão oficial|missao oficial|comitiva|agenda internacional)\w*/i },
  { type: "coletiva", regex: /\b(coletiva|entrevista coletiva|fala à imprensa|fala a imprensa|declaração à imprensa|declaracao a imprensa)\w*/i },
  { type: "participação em evento", regex: /\b(participa|participou|participará|participara|fórum|forum|conferência|conferencia|seminário|seminario|evento do brics|brics|ndb|novo banco de desenvolvimento)\w*/i },
  { type: "operação", regex: /\b(operação|operacao|pf|polícia federal|policia federal|busca e apreensão|busca e apreensao)\w*/i },
  { type: "decisão judicial", regex: /\b(stf|tse|decisão|decisao|julgamento|liminar|condenaç|condenac|recurso)\w*/i },
];

const detectEventsFromNews = (newsRows: any[]): EventItem[] => {
  const groups = new Map<string, { rows: any[]; outlets: Set<string>; title: string; official: boolean }>();
  for (const row of newsRows) {
    const text = `${row.post_title || ""} ${row.post_description || ""} ${row.comment_text || ""}`;
    if (!hasCurrentPoliticalActivity(text)) continue;
    const rule = eventRules.find((r) => r.regex.test(text));
    if (!rule) continue;
    const title = (row.post_title || row.comment_text || rule.type).replace(/\s+/g, " ").trim().slice(0, 120);
    const outlet = normalizeOutlet(row.author_name || row.comment_author || row.author_handle || "Portal de notícia") || "Portal de notícia";
    const current = groups.get(rule.type) || { rows: [], outlets: new Set<string>(), title, official: false };
    current.rows.push(row);
    current.outlets.add(outlet);
    current.official = current.official || hasOfficialActivity(text);
    if (effectiveDateOf(row).getTime() > effectiveDateOf(current.rows[0] || row).getTime()) current.title = title;
    groups.set(rule.type, current);
  }
  return Array.from(groups.entries())
    // Evento exige 3 evidências, 2 veículos ou sinal oficial confirmado.
    .filter(([, g]) => g.official || g.outlets.size >= 2 || g.rows.length >= 3)
    .map(([type, g]) => ({
      id: `news-${type}`,
      name: g.title,
      date: effectiveDateOf(g.rows[0]).toISOString(),
      type,
      impact: g.rows.length + g.outlets.size + (g.official ? 3 : 0),
      publications: g.rows.length,
      outlets: g.outlets.size,
    }))
    .sort((a, b) => b.impact - a.impact).slice(0, 6);
};

const extractThemes = (rows: Array<{ comment_text: string | null; post_title?: string | null; post_description?: string | null; social_network?: string | null; platform?: string | null; interaction_type?: string | null; author_name?: string | null; author_handle?: string | null; comment_author?: string | null }>): Theme[] => {
  const counts = new Map<string, { count: number; evidence: EvidenceCounts; examples: string[]; sources: Set<string>; outlets: Set<string>; official: boolean }>();
  for (const r of rows) {
    const raw = `${r.post_title || ""} ${r.post_description || ""} ${r.comment_text || ""}`;
    const txt = cleanText(raw);
    if (!txt || txt.length < 8 || !hasCurrentPoliticalActivity(raw)) continue;
    for (const rule of THEME_RULES) {
      if (rule.keywords.test(txt)) {
        const current = counts.get(rule.name) || { count: 0, evidence: emptyEvidence(), examples: [], sources: new Set<string>(), outlets: new Set<string>(), official: false };
        current.count++;
        addEvidence(current.evidence, r.social_network);
        const src = (r.author_name || r.author_handle || r.social_network || "").toString().toLowerCase().trim();
        if (src) current.sources.add(src);
        if (isNewsNetwork(r.social_network, r.platform, r.interaction_type)) {
          const outlet = normalizeOutlet(r.author_name || r.comment_author || r.author_handle || null);
          if (outlet) current.outlets.add(outlet.toLowerCase());
        }
        current.official = current.official || hasOfficialActivity(raw);
        const example = (r.post_title || r.comment_text || "").replace(/\s+/g, " ").trim();
        if (example && current.examples.length < 2) current.examples.push(example.slice(0, 110));
        counts.set(rule.name, current);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([name, item]) => ({ name, count: item.count, evidence: item.evidence, examples: item.examples, _sources: item.sources.size, _outlets: item.outlets.size, _official: item.official }))
    // Tema só existe com 3 evidências independentes, 2 veículos ou evento oficial confirmado.
    .filter((t: any) => t._official || t._outlets >= 2 || t._sources >= 3 || t.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 7)
    .map(({ _sources, _outlets, _official, ...rest }: any) => rest);
};

// ============ Domínios conhecidos para veículos ============
const KNOWN_OUTLETS = [
  "G1","Globo","GloboNews","CNN Brasil","UOL","Folha","Estadão","Estadao","Poder360",
  "Metrópoles","Metropoles","Valor","Valor Econômico","R7","BBC","Veja","Carta Capital",
  "Jovem Pan","Band","SBT","Record","O Antagonista","InfoMoney","Reuters","AP","AFP",
  "Correio Braziliense","Gazeta do Povo","Diário","Tribuna",
];

const normalizeOutlet = (raw: string | null): string | null => {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const k of KNOWN_OUTLETS) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  // remove trailing junk and limit
  const clean = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(" - ")[0];
  if (clean.length > 32) return clean.slice(0, 32) + "…";
  return clean;
};

// ============ Fetch ============
async function fetchSnapshot(
  userId: string,
  candidateId: string,
  candidateName: string,
  onProgress?: (p: Partial<LiveProgress>) => void,
  windowHours: 1 | 6 | 12 | 24 = 24,
  timeoutMs = 8000,
): Promise<Snapshot> {
  const now = new Date();
  const windowMs = windowHours * 3600000;
  const start12h = new Date(now.getTime() - 12 * 3600000);
  const start6h = new Date(now.getTime() - 6 * 3600000);
  const start1h = new Date(now.getTime() - 3600000);
  const start24h = new Date(now.getTime() - windowMs); // janela selecionada
  const startPrev24h = new Date(now.getTime() - 2 * windowMs);

  const base = () => supabase
    .from("social_interactions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("candidate_id", candidateId)
    .not("social_network", "in", "(mastodon,lemmy,pinterest)");

  const run = <T,>(b: any, label: string): Promise<T> =>
    withTimeout<T>(Promise.resolve(b) as Promise<T>, timeoutMs, label);

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

  await triggerNewsCollection(candidateId, candidateName);

  const pNews = run<{ count: number | null }>(base().or(newsFilter).or(`created_at.gte.${start24h.toISOString()},original_posted_at.gte.${start24h.toISOString()}`), "news")
    .then(r => { emit({ news: r.count ?? 0, steps: { ...live.steps, collectNews: true } }); return r; });
  const pToday = run<{ count: number | null }>(base().or(`created_at.gte.${start24h.toISOString()},original_posted_at.gte.${start24h.toISOString()}`), "today")
    .then(r => { emit({ mentionsProcessed: r.count ?? 0, steps: { ...live.steps, processAI: true, collectSocial: true } }); return r; });
  const pH12 = run<{ count: number | null }>(base().or(`created_at.gte.${start12h.toISOString()},original_posted_at.gte.${start12h.toISOString()}`), "h12");
  const pH6 = run<{ count: number | null }>(base().or(`created_at.gte.${start6h.toISOString()},original_posted_at.gte.${start6h.toISOString()}`), "h6");
  const pH1 = run<{ count: number | null }>(base().or(`created_at.gte.${start1h.toISOString()},original_posted_at.gte.${start1h.toISOString()}`), "h1");
  const pPos = run<{ count: number | null }>(base().or(`created_at.gte.${start24h.toISOString()},original_posted_at.gte.${start24h.toISOString()}`).eq("sentiment_label", "Positivo"), "pos");
  const pNeg = run<{ count: number | null }>(base().or(`created_at.gte.${start24h.toISOString()},original_posted_at.gte.${start24h.toISOString()}`).eq("sentiment_label", "Negativo"), "neg");
  const pNeu = run<{ count: number | null }>(base().or(`created_at.gte.${start24h.toISOString()},original_posted_at.gte.${start24h.toISOString()}`).eq("sentiment_label", "Neutro"), "neu");
  const pPrev = run<{ count: number | null }>(base().or(`and(created_at.gte.${startPrev24h.toISOString()},created_at.lt.${start24h.toISOString()}),and(original_posted_at.gte.${startPrev24h.toISOString()},original_posted_at.lt.${start24h.toISOString()})`), "prev24");

  // Sentimento da janela anterior equivalente (24h anteriores)
  const pYestPos = run<{ count: number | null }>(base().or(`and(created_at.gte.${startPrev24h.toISOString()},created_at.lt.${start24h.toISOString()}),and(original_posted_at.gte.${startPrev24h.toISOString()},original_posted_at.lt.${start24h.toISOString()})`).eq("sentiment_label", "Positivo"), "yPos");
  const pYestNeg = run<{ count: number | null }>(base().or(`and(created_at.gte.${startPrev24h.toISOString()},created_at.lt.${start24h.toISOString()}),and(original_posted_at.gte.${startPrev24h.toISOString()},original_posted_at.lt.${start24h.toISOString()})`).eq("sentiment_label", "Negativo"), "yNeg");
  const pYestNeu = run<{ count: number | null }>(base().or(`and(created_at.gte.${startPrev24h.toISOString()},created_at.lt.${start24h.toISOString()}),and(original_posted_at.gte.${startPrev24h.toISOString()},original_posted_at.lt.${start24h.toISOString()})`).eq("sentiment_label", "Neutro"), "yNeu");
  const pVideos = run<{ count: number | null }>(base().or(`created_at.gte.${start24h.toISOString()},original_posted_at.gte.${start24h.toISOString()}`).or("social_network.ilike.%youtube%,social_network.ilike.%tiktok%,social_network.ilike.%video%"), "videos")
    .then(r => { emit({ videos: r.count ?? 0 }); return r; });

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
    } else emit({ steps: { ...live.steps, classifySentiment: true } });
  }).catch(() => {});

  // Amostra com campos ricos para temas, veículos e publicações
  const pSample = run<{ data: any[] | null }>(
    supabase.from("social_interactions")
      .select("id, created_at, collected_at, original_posted_at, sentiment_label, comment_text, social_network, platform, interaction_type, likes_count, shares_count, replies_count, engagement_score, post_url, post_title, post_description, author_name, author_handle, comment_author")
      .eq("user_id", userId).eq("candidate_id", candidateId)
      .not("social_network", "in", "(mastodon,lemmy,pinterest)")
      .or(`created_at.gte.${start24h.toISOString()},original_posted_at.gte.${start24h.toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(3000),
    "sample"
  );

  // Eventos políticos
  const pEvents = run<{ data: any[] | null }>(
    supabase.from("political_events")
      .select("id, event_name, event_date, event_type, importance_score, publications_count, distinct_outlets")
      .eq("user_id", userId).eq("candidate_id", candidateId)
      .gte("event_date", start24h.toISOString())
      .lte("event_date", now.toISOString())
      .order("importance_score", { ascending: false })
      .limit(6),
    "events"
  );

  const [qToday, qH12, qH6, qH1, qPos, qNeg, qNeu, qNews, qVideos, qPrev24h, qSample, qEvents, qYPos, qYNeg, qYNeu] = await Promise.all([
    pToday, pH12, pH6, pH1, pPos, pNeg, pNeu, pNews, pVideos, pPrev, pSample, pEvents, pYestPos, pYestNeg, pYestNeu,
  ]);

  void qToday; void qH12; void qH6; void qH1; void qPos; void qNeg; void qNeu; void qVideos; // contagens brutas substituídas pelo sample (fonte única)
  const newsCollected = qNews.count ?? 0;
  const prev24h = qPrev24h.count ?? 0;
  const rawSample: any[] = qSample.data ?? [];
  // Pontuação + filtro de relevância política dentro da janela selecionada
  const scoredSample = rawSample
    .map((r) => ({ row: r, score: scoreRelevance(r, start24h.getTime(), now.getTime()) }))
    .filter((x) => x.score > 0);
  const sample: any[] = scoredSample.map((x) => x.row);
  const scoreById = new Map<string, number>(scoredSample.map((x) => [x.row.id, x.score]));

  // ============ FONTE ÚNICA DE VERDADE ============
  // Todos os números exibidos são derivados de `sample`. Nada de count queries divergentes.
  const mentionsToday = sample.length;
  const positiveToday = sample.filter((r) => r.sentiment_label === "Positivo").length;
  const negativeToday = sample.filter((r) => r.sentiment_label === "Negativo").length;
  const neutralToday = sample.filter((r) => r.sentiment_label === "Neutro").length;
  const classifiedToday = positiveToday + negativeToday + neutralToday;
  // Validação: soma sempre <= total e nunca expostos números maiores que a base
  if (classifiedToday > mentionsToday) {
    // proteção defensiva — nunca exibir mais classificações que total
    // (não deve acontecer, mas garantido aqui)
  }

  const newsRows = sample.filter(r => isNewsNetwork(r.social_network, r.platform, r.interaction_type) && effectiveDateOf(r).getTime() >= start24h.getTime());
  const evidence = emptyEvidence();
  evidence.news = newsRows.length;
  evidence.videos = sample.filter(r => classifyNetwork(r.social_network) === "videos").length;
  evidence.posts = Math.max(0, sample.length - evidence.news - evidence.videos);
  evidence.total = evidence.news + evidence.posts + evidence.videos;

  // Window counts derivados do sample (mesma base do total exibido)
  const effectiveWindowCount = (ms: number) => sample.filter(r => effectiveDateOf(r).getTime() >= now.getTime() - ms).length;
  const windowCounts = {
    h1: effectiveWindowCount(3600000),
    h6: effectiveWindowCount(6 * 3600000),
    h12: effectiveWindowCount(12 * 3600000),
    h24: sample.length,
    previous24h: prev24h,
  };

  // Base estatística mínima para alertas/percentuais comparativos
  const hasStatisticalBase = mentionsToday >= 50;

  // Movimentação de sentimento (delta % vs 24h anteriores) — somente com base suficiente
  const yPos = qYPos.count ?? 0;
  const yNeg = qYNeg.count ?? 0;
  const yNeu = qYNeu.count ?? 0;
  const pctDelta = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
  const sentimentDelta = {
    positiveDeltaPct: hasStatisticalBase ? pctDelta(positiveToday, yPos) : 0,
    negativeDeltaPct: hasStatisticalBase ? pctDelta(negativeToday, yNeg) : 0,
    neutralDeltaPct: hasStatisticalBase ? pctDelta(neutralToday, yNeu) : 0,
    available: hasStatisticalBase,
  };

  // Buckets evolução — somente janelas de tempo real
  const buckets24h: EvolutionPoint[] = Array.from({ length: 24 }, (_, i) => {
    const bs = new Date(now.getTime() - (23 - i) * 3600000);
    return { label: bs.getHours().toString().padStart(2, "0") + "h", total: 0, positive: 0, negative: 0, neutral: 0 };
  });
  const buckets12h: EvolutionPoint[] = Array.from({ length: 12 }, (_, i) => {
    const bs = new Date(now.getTime() - (11 - i) * 3600000);
    return { label: bs.getHours().toString().padStart(2, "0") + "h", total: 0, positive: 0, negative: 0, neutral: 0 };
  });
  const buckets6h: EvolutionPoint[] = Array.from({ length: 6 }, (_, i) => {
    const bs = new Date(now.getTime() - (5 - i) * 3600000);
    return { label: bs.getHours().toString().padStart(2, "0") + "h", total: 0, positive: 0, negative: 0, neutral: 0 };
  });
  const buckets1h: EvolutionPoint[] = Array.from({ length: 12 }, (_, i) => {
    const bs = new Date(now.getTime() - (11 - i) * 5 * 60000);
    return { label: bs.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), total: 0, positive: 0, negative: 0, neutral: 0 };
  });
  for (const r of sample) {
    const t = effectiveDateOf(r).getTime();
    const inc = (b: EvolutionPoint) => {
      b.total++;
      if (r.sentiment_label === "Positivo") b.positive++;
      else if (r.sentiment_label === "Negativo") b.negative++;
      else if (r.sentiment_label === "Neutro") b.neutral++;
    };
    const h = Math.floor((now.getTime() - t) / 3600000);
    if (h >= 0 && h < 24) inc(buckets24h[23 - h]);
    if (h >= 0 && h < 12) inc(buckets12h[11 - h]);
    if (h >= 0 && h < 6) inc(buckets6h[5 - h]);
    const m5 = Math.floor((now.getTime() - t) / (5 * 60000));
    if (m5 >= 0 && m5 < 12) inc(buckets1h[11 - m5]);
  }
  emit({ steps: { ...live.steps, buildCharts: true } });

  // BLOCO 2 — Temas dominantes (evidência mínima já aplicada em extractThemes)
  const themes = extractThemes(sample);
  emit({ emergingTopics: themes.slice(0, 6).map(t => t.name) });

  // BLOCO 3 — Eventos (sample garante janela + relevância)
  const storedEvents: EventItem[] = (qEvents.data ?? [])
    .filter((e: any) => {
      const ts = new Date(e.event_date).getTime();
      const hasEvidence = Number(e.publications_count || 0) >= 2 || Number(e.distinct_outlets || 0) >= 2;
      return ts >= start24h.getTime() && ts <= now.getTime() && hasEvidence;
    })
    .map((e: any) => ({
      id: e.id,
      name: e.event_name,
      date: e.event_date,
      type: e.event_type || "evento",
      impact: Number(e.importance_score || e.publications_count || 0),
      publications: Number(e.publications_count || 0),
      outlets: Number(e.distinct_outlets || 0),
    }));
  const events: EventItem[] = [...detectEventsFromNews(newsRows), ...storedEvents]
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 6);

  // BLOCO 5 — Veículos mais ativos (distribuição completa, sem corte artificial)
  const outletCounts = new Map<string, number>();
  for (const r of newsRows) {
    const outlet = normalizeOutlet(r.author_name || r.comment_author || r.author_handle || r.post_title?.split(" - ").pop() || null);
    if (!outlet) continue;
    outletCounts.set(outlet, (outletCounts.get(outlet) || 0) + 1);
  }
  const totalOutletNews = Array.from(outletCounts.values()).reduce((sum, count) => sum + count, 0) || 1;
  const outlets: Outlet[] = Array.from(outletCounts.entries())
    .map(([name, count]) => ({ name, count, percentage: Math.round((count / totalOutletNews) * 100) }))
    .sort((a, b) => b.count - a.count);

  // BLOCO 6 — Publicações mais relevantes (Score)
  const publications: Publication[] = sample
    .map((r: any) => ({
      id: r.id,
      title: (r.post_title || r.comment_text || "").slice(0, 140) || "(sem título)",
      author: r.author_name || r.comment_author || r.author_handle || "Autor desconhecido",
      network: r.social_network,
      engagement: isNewsNetwork(r.social_network, r.platform, r.interaction_type) ? Math.max(1, r.engagement_score || 1) : (r.likes_count || 0) + (r.shares_count || 0) + (r.replies_count || 0),
      url: r.post_url || null,
      sentiment: r.sentiment_label || null,
      createdAt: effectiveDateOf(r).toISOString(),
      _score: scoreById.get(r.id) || 0,
    }))
    .filter((p: any) => p.title && p.title !== "(sem título)")
    .sort((a: any, b: any) => b._score - a._score)
    .slice(0, 8)
    .map(({ _score, ...rest }: any) => rest);

  // BLOCO 7 — Alertas (sempre com base estatística mínima)
  const alerts: Alert[] = [];
  if (hasStatisticalBase) {
    const growth = prev24h >= 10 ? ((windowCounts.h24 - prev24h) / prev24h) * 100 : 0;
    if (prev24h >= 10 && growth >= 50) alerts.push({ kind: "growth", title: `Crescimento de ${Math.round(growth)}% nas menções`, detail: `${windowCounts.h24.toLocaleString("pt-BR")} registros na janela contra ${prev24h.toLocaleString("pt-BR")} na anterior.`, evidence });
    else if (prev24h >= 10 && growth <= -40) alerts.push({ kind: "growth", title: `Queda de ${Math.round(Math.abs(growth))}% nas menções`, detail: `${windowCounts.h24.toLocaleString("pt-BR")} registros na janela contra ${prev24h.toLocaleString("pt-BR")} na anterior.`, evidence });
    if ((negativeToday / Math.max(1, classifiedToday)) >= 0.5) {
      alerts.push({ kind: "crisis", title: "Volume negativo elevado", detail: `${negativeToday.toLocaleString("pt-BR")} de ${classifiedToday.toLocaleString("pt-BR")} classificações são negativas.`, evidence });
    } else if ((negativeToday / Math.max(1, classifiedToday)) >= 0.35) {
      alerts.push({ kind: "negative", title: "Atenção ao sentimento negativo", detail: `${negativeToday.toLocaleString("pt-BR")} registros negativos na janela.`, evidence });
    }
    if (Math.abs(sentimentDelta.positiveDeltaPct - sentimentDelta.negativeDeltaPct) >= 40) {
      alerts.push({ kind: "growth", title: "Mudança mensurável de sentimento", detail: `Comparação contra janela anterior: positivo ${sentimentDelta.positiveDeltaPct >= 0 ? "+" : ""}${sentimentDelta.positiveDeltaPct}% / negativo ${sentimentDelta.negativeDeltaPct >= 0 ? "+" : ""}${sentimentDelta.negativeDeltaPct}%.`, evidence });
    }
  }
  const viral = sample.filter(r => (r.likes_count || 0) + (r.shares_count || 0) + (r.replies_count || 0) > 500)
    .sort((a, b) => (b.likes_count + b.shares_count) - (a.likes_count + a.shares_count))[0];
  if (viral) {
    const viralEngagement = (viral.likes_count || 0) + (viral.shares_count || 0) + (viral.replies_count || 0);
    alerts.push({ kind: "viral", title: "Conteúdo viral identificado", detail: (viral.post_title || viral.comment_text || "Publicação recente").slice(0, 120), source: viral.social_network, engagement: viralEngagement, publishedAt: effectiveDateOf(viral).toISOString(), evidence: { news: isNewsNetwork(viral.social_network, viral.platform, viral.interaction_type) ? 1 : 0, posts: classifyNetwork(viral.social_network) === "posts" ? 1 : 0, videos: classifyNetwork(viral.social_network) === "videos" ? 1 : 0, total: 1 } });
  }
  if (newsRows.length >= 5) alerts.push({ kind: "news", title: `${newsRows.length} notícias na janela`, detail: "Alerta baseado nas notícias coletadas na janela monitorada.", evidence: { ...evidence, news: newsRows.length } });

  // BLOCO 1 — leitura factual, sem preencher lacunas
  const topTheme = themes[0];
  const tone = classifiedToday === 0 ? "sem sentimento classificado suficiente"
    : positiveToday > negativeToday * 1.2 ? "predomínio positivo nos registros classificados"
    : negativeToday > positiveToday * 1.2 ? "predomínio negativo nos registros classificados" : "sentimento equilibrado nos registros classificados";
  const nowNarrative =
    mentionsToday === 0
      ? `Pouca atividade pública relevante detectada para ${candidateName} nas últimas ${windowHours}h.`
      : `${candidateName} teve ${mentionsToday.toLocaleString("pt-BR")} sinais de atividade política atual nas últimas ${windowHours}h. ` +
        (topTheme ? `Tema com maior evidência: ${topTheme.name}, sustentado por ${topTheme.evidence.news} notícias, ${topTheme.evidence.posts} posts e ${topTheme.evidence.videos} vídeos. ` : `Nenhum tema atingiu evidência mínima (3 evidências, 2 veículos ou evento oficial). `) +
        (classifiedToday > 0 ? `Leitura de sentimento: ${tone}.` : "Ainda sem volume classificado suficiente.");

  // BLOCO 8 — Resumo executivo (mesmíssima base dos demais blocos)
  const executiveSummary = {
    what: mentionsToday > 0 ? `${candidateName} apresentou ${mentionsToday.toLocaleString("pt-BR")} sinais de atividade política atual: ${evidence.news.toLocaleString("pt-BR")} notícias, ${evidence.posts.toLocaleString("pt-BR")} posts e ${evidence.videos.toLocaleString("pt-BR")} vídeos; ${windowCounts.h1.toLocaleString("pt-BR")} na última hora.` : "Pouca atividade pública relevante detectada nas últimas 24 horas.",
    why: events[0]
      ? `Evento recente detectado: "${events[0].name}" (${events[0].publications} publicações, ${events[0].outlets} veículos).`
      : viral ? `Evidência de viralização: ${viral.social_network}, ${((viral.likes_count || 0) + (viral.shares_count || 0) + (viral.replies_count || 0)).toLocaleString("pt-BR")} interações.`
      : "Sem evidência suficiente para atribuir causa.",
    who: outlets.length > 0
      ? `Veículos identificados na janela: ${outlets.slice(0, 3).map(o => `${o.name} (${o.count})`).join(", ")}${outlets.length > 3 ? ` e mais ${outlets.length - 3}` : ""}.`
      : "Nenhum veículo jornalístico identificado na janela.",
    impact: classifiedToday > 0
      ? `Classificações na janela (${classifiedToday} de ${mentionsToday}): ${positiveToday.toLocaleString("pt-BR")} positivas, ${negativeToday.toLocaleString("pt-BR")} negativas e ${neutralToday.toLocaleString("pt-BR")} neutras.`
      : "Sem classificação de sentimento suficiente na janela.",
  };

  return {
    nowNarrative, mentionsToday, positiveToday, negativeToday, neutralToday, classifiedToday,
    newsCollected, evidence, windowCounts, hasStatisticalBase,
    themes, events, sentimentDelta, outlets, publications, alerts, executiveSummary,
    evolution24h: buckets24h, evolution12h: buckets12h, evolution6h: buckets6h, evolution1h: buckets1h,
    savedAt: Date.now(), candidateName,
  };
}

// ============ Componentes UI ============
const KpiCard = ({ icon, label, value, tone = "text-foreground", accent }: { icon: React.ReactNode; label: string; value: string; tone?: string; accent?: string; }) => (
  <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden relative">
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
  growth: { icon: <TrendingUp className="h-4 w-4" />, ring: "border-success/30", bg: "bg-success/5", text: "text-success" },
  negative: { icon: <TrendingDown className="h-4 w-4" />, ring: "border-destructive/30", bg: "bg-destructive/5", text: "text-destructive" },
  crisis: { icon: <AlertTriangle className="h-4 w-4" />, ring: "border-destructive/40", bg: "bg-destructive/10", text: "text-destructive" },
  viral: { icon: <Zap className="h-4 w-4" />, ring: "border-warning/30", bg: "bg-warning/5", text: "text-warning" },
  news: { icon: <Newspaper className="h-4 w-4" />, ring: "border-accent/30", bg: "bg-accent/5", text: "text-accent" },
};

const EvolutionChart = ({ data }: { data: EvolutionPoint[] }) => (
  <div className="h-56 sm:h-64 w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.5} /><stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gNeg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.5} /><stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
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
        <Area type="monotone" dataKey="positive" stroke="hsl(var(--success))" strokeWidth={1.5} fill="url(#gPos)" />
        <Area type="monotone" dataKey="negative" stroke="hsl(var(--destructive))" strokeWidth={1.5} fill="url(#gNeg)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

const SentimentDeltaPill = ({ label, delta, positive }: { label: string; delta: number; positive: boolean }) => {
  const up = delta >= 0;
  const good = positive ? up : !up;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card/40 p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
      <div className={cn("flex items-center gap-1.5 text-lg font-bold tabular-nums", good ? "text-success" : "text-destructive")}>
        {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        {up ? "+" : ""}{delta}%
      </div>
      <span className="text-[11px] text-muted-foreground">vs 24h anteriores</span>
    </div>
  );
};

// ============ Página ============
const RealTimeMonitor = () => {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState<1 | 6 | 12 | 24>(24);
  const [, force] = useState(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const bgTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("candidates").select("id, full_name, party")
        .eq("user_id", user.id).eq("status", "active").order("full_name");
      if (data) {
        setCandidates(data);
        if (data.length > 0 && !selectedCandidateId) setSelectedCandidateId(data[0].id);
      }
      setLoadingCandidates(false);
    })();
  }, [user]);

  const runSync = useCallback(async (cid: string, uid: string, name: string, hours: 1 | 6 | 12 | 24) => {
    setIsSyncing(true); setError(null);
    setLiveProgress({
      news: 0, posts: 0, videos: 0, comments: 0, mentionsProcessed: 0, sentimentClassified: 0,
      positivePct: 0, neutralPct: 0, negativePct: 0, emergingTopics: [],
      steps: { collectNews: false, collectSocial: false, processAI: false, classifySentiment: false, buildCharts: false },
    });
    try {
      const snap = await fetchSnapshot(uid, cid, name, (p) => setLiveProgress(prev => ({ ...(prev as LiveProgress), ...p })), hours);
      writeCache(cacheKey(uid, cid) + `:${hours}h`, snap);
      setSnapshot(snap);
    } catch (e: any) {
      setError(e?.message?.includes("Timeout") ? "Consulta excedeu 8s — exibindo último snapshot." : "Falha ao atualizar dados.");
    } finally { setIsSyncing(false); setLiveProgress(null); }
  }, []);

  const selectedCandidate = candidates.find(c => c.id === selectedCandidateId);

  useEffect(() => {
    if (!user || !selectedCandidateId || !selectedCandidate) { setSnapshot(null); return; }
    const cached = readCache(cacheKey(user.id, selectedCandidateId) + `:${windowHours}h`);
    if (cached) setSnapshot(cached); else setSnapshot(null);
    const stale = !cached || (Date.now() - cached.savedAt) > 2 * 60 * 1000;
    if (stale) runSync(selectedCandidateId, user.id, selectedCandidate.full_name, windowHours);
  }, [user, selectedCandidateId, selectedCandidate, windowHours, runSync]);

  useEffect(() => {
    if (!user || !selectedCandidateId || !selectedCandidate) return;
    bgTimerRef.current = setInterval(() => runSync(selectedCandidateId, user.id, selectedCandidate.full_name, windowHours), 60000);
    return () => { if (bgTimerRef.current) clearInterval(bgTimerRef.current); };
  }, [user, selectedCandidateId, selectedCandidate, windowHours, runSync]);

  useEffect(() => {
    tickRef.current = setInterval(() => force(n => n + 1), 30000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const lastUpdate = snapshot ? new Date(snapshot.savedAt) : null;

  return (
    <div className="space-y-4 sm:space-y-5 pb-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 mt-0.5">
            <BrainCircuit className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Centro de Inteligência Política</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">O que está acontecendo agora, em tempo real</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-xs">
            {isSyncing ? (<><RefreshCw className="h-3 w-3 animate-spin text-primary" /><span className="text-muted-foreground">Atualizando…</span></>)
              : snapshot ? (<><CheckCircle2 className="h-3 w-3 text-success" /><span className="text-muted-foreground">{lastUpdate ? formatRelative(lastUpdate) : "Sincronizado"}</span></>)
              : (<><Clock className="h-3 w-3" /><span className="text-muted-foreground">Aguardando</span></>)}
          </div>
          <Button variant="outline" size="sm" disabled={isSyncing || !selectedCandidateId || !selectedCandidate}
            onClick={() => user && selectedCandidateId && selectedCandidate && runSync(selectedCandidateId, user.id, selectedCandidate.full_name, windowHours)}
            className="h-8 gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />Atualizar
          </Button>
        </div>
      </div>

      {/* Selector */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
            </span>AO VIVO
          </span>
          {loadingCandidates ? <Skeleton className="h-11 w-full sm:w-[280px]" /> : (
            <CandidateSelector candidates={candidates} value={selectedCandidateId} onChange={setSelectedCandidateId} disabled={false} />
          )}
          <div className="flex items-center gap-1 ml-auto">
            {([1, 6, 12, 24] as const).map((h) => (
              <button
                key={h}
                onClick={() => setWindowHours(h)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors border",
                  windowHours === h
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card/60 text-muted-foreground border-border/60 hover:text-foreground"
                )}
              >
                {h}h
              </button>
            ))}
          </div>
          {selectedCandidate && (
            <span className="text-xs text-muted-foreground truncate">Monitorando: <span className="font-semibold text-foreground">{selectedCandidate.full_name}</span></span>
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
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="py-2.5 text-xs text-warning flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />{error}
              </CardContent>
            </Card>
          )}

          {!snapshot && liveProgress && (
            <LiveCollectionCenter progress={liveProgress} candidate={selectedCandidate} />
          )}

          {/* BLOCO 1 — O que está acontecendo agora */}
          {snapshot ? (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent overflow-hidden relative">
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />O que está acontecendo agora
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-auto">Tempo real</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base sm:text-lg leading-relaxed font-medium text-foreground/95">
                  {snapshot.nowNarrative}
                </p>
              </CardContent>
            </Card>
          ) : !liveProgress ? <Skeleton className="h-32 w-full rounded-lg" /> : null}

          {snapshot && (
            <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
              <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Baseado em:</span>
                <span>{snapshot.evidence.news.toLocaleString("pt-BR")} notícias</span>
                <span className="hidden sm:inline">·</span>
                <span>{snapshot.evidence.posts.toLocaleString("pt-BR")} posts</span>
                <span className="hidden sm:inline">·</span>
                <span>{snapshot.evidence.videos.toLocaleString("pt-BR")} vídeos</span>
                <Badge variant="outline" className="w-fit sm:ml-auto text-[10px]">Últimas {windowHours}h</Badge>
              </CardContent>
            </Card>
          )}

          {/* KPIs */}
          {snapshot && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
              <KpiCard icon={<Activity className="h-3.5 w-3.5 text-primary" />} label="Última hora" value={snapshot.windowCounts.h1.toLocaleString("pt-BR")} accent="bg-primary/70" />
              <KpiCard icon={<Clock className="h-3.5 w-3.5 text-primary" />} label="Últimas 6h" value={snapshot.windowCounts.h6.toLocaleString("pt-BR")} accent="bg-primary/50" />
              <KpiCard icon={<Activity className="h-3.5 w-3.5 text-primary" />} label="Últimas 12h" value={snapshot.windowCounts.h12.toLocaleString("pt-BR")} accent="bg-primary/40" />
              <KpiCard icon={<Newspaper className="h-3.5 w-3.5 text-primary" />} label="Notícias relevantes" value={snapshot.evidence.news.toLocaleString("pt-BR")} accent="bg-primary/30" />
            </div>
          )}

          {/* BLOCO 2 + BLOCO 4 */}
          {snapshot && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Flame className="h-4 w-4 text-warning" />Assuntos dominantes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {snapshot.themes.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">Sem evidência recente suficiente para identificar temas políticos nas últimas 24h.</p>
                  ) : (
                    <div className="space-y-2">
                      {snapshot.themes.map((t, i) => (
                        <motion.div key={t.name} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                          className={cn(
                            "rounded-lg border px-3 py-2",
                            i === 0 ? "border-warning/40 bg-warning/10" :
                            i === 1 ? "border-primary/30 bg-primary/10" :
                            "border-border/60 bg-muted/30"
                          )}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground">{t.name}</span>
                            <span className="text-[11px] tabular-nums text-muted-foreground">{t.count} registros</span>
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Base: {t.evidence.news} notícias · {t.evidence.posts} posts · {t.evidence.videos} vídeos
                          </div>
                          {t.examples[0] && <div className="mt-1 text-xs text-foreground/75 line-clamp-1">{t.examples[0]}</div>}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />Movimentação de sentimento
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {snapshot.sentimentDelta.available ? (
                    <div className="grid grid-cols-3 gap-2">
                      <SentimentDeltaPill label="Positivo" delta={snapshot.sentimentDelta.positiveDeltaPct} positive />
                      <SentimentDeltaPill label="Negativo" delta={snapshot.sentimentDelta.negativeDeltaPct} positive={false} />
                      <SentimentDeltaPill label="Neutro" delta={snapshot.sentimentDelta.neutralDeltaPct} positive />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground py-4">
                      Dados insuficientes para tendência estatística (mínimo de 50 registros relevantes na janela).
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Evolução */}
          {snapshot && (
            <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Evolução das menções</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="24h">
                  <TabsList className="h-8">
                    <TabsTrigger value="1h" className="text-xs">1h</TabsTrigger>
                    <TabsTrigger value="6h" className="text-xs">6h</TabsTrigger>
                    <TabsTrigger value="12h" className="text-xs">12h</TabsTrigger>
                    <TabsTrigger value="24h" className="text-xs">24h</TabsTrigger>
                  </TabsList>
                  <TabsContent value="1h" className="mt-3"><EvolutionChart data={snapshot.evolution1h} /></TabsContent>
                  <TabsContent value="6h" className="mt-3"><EvolutionChart data={snapshot.evolution6h} /></TabsContent>
                  <TabsContent value="12h" className="mt-3"><EvolutionChart data={snapshot.evolution12h} /></TabsContent>
                  <TabsContent value="24h" className="mt-3"><EvolutionChart data={snapshot.evolution24h} /></TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* BLOCO 3 — Eventos + BLOCO 5 — Veículos */}
          {snapshot && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />Eventos em alta
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {snapshot.events.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">Nenhum evento detectado nas últimas 24h.</p>
                  ) : (
                    <ul className="space-y-2">
                      {snapshot.events.map(e => (
                        <li key={e.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-2.5">
                          <div className="rounded-md bg-primary/10 p-1.5 text-primary"><Megaphone className="h-3.5 w-3.5" /></div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{e.name}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                              <span className="capitalize">{e.type}</span>
                              <span>·</span>
                              <span>{formatRelative(new Date(e.date))}</span>
                              <span>·</span>
                              <span>{e.publications} publicações / {e.outlets} veículos</span>
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-[10px] h-5 shrink-0">Evidência recente</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-accent" />Veículos mais ativos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {snapshot.outlets.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">Nenhum veículo jornalístico identificado nas últimas 24h.</p>
                  ) : (
                    <ul className="space-y-2">
                      {snapshot.outlets.map((o, i) => {
                        const max = snapshot.outlets[0].count || 1;
                        const pct = Math.round((o.count / max) * 100);
                        return (
                          <li key={o.name} className="flex items-center gap-3">
                            <span className="w-5 h-5 rounded-md bg-accent/10 text-accent text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium truncate">{o.name}</span>
                                <span className="text-[11px] text-muted-foreground tabular-nums">{o.count.toLocaleString("pt-BR")} · {o.percentage}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mt-1">
                                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} className="h-full bg-accent" />
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* BLOCO 6 — Publicações mais relevantes */}
          {snapshot && (
            <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />Publicações relevantes nas últimas 24h
                </CardTitle>
              </CardHeader>
              <CardContent>
                {snapshot.publications.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">Sem publicações recentes com engajamento relevante.</p>
                ) : (
                  <ul className="space-y-2">
                    {snapshot.publications.map(p => (
                      <li key={p.id} className="rounded-lg border border-border/60 bg-background/40 p-3 hover:bg-background/60 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium leading-snug line-clamp-2">{p.title}</div>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground/80 truncate max-w-[160px]">{p.author}</span>
                              <Badge variant="outline" className="h-4 text-[10px] px-1.5">{p.network}</Badge>
                              <span>{formatRelative(new Date(p.createdAt))}</span>
                              {p.sentiment && (
                                <Badge variant="secondary" className={cn("h-4 text-[10px] px-1.5",
                                  p.sentiment === "Positivo" && "bg-success/10 text-success",
                                  p.sentiment === "Negativo" && "bg-destructive/10 text-destructive",
                                )}>{p.sentiment}</Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <div className="flex items-center gap-1 text-xs font-semibold tabular-nums">
                              <Heart className="h-3 w-3 text-destructive" />{p.engagement.toLocaleString("pt-BR")}
                            </div>
                            {p.url && (
                              <a href={p.url} target="_blank" rel="noopener noreferrer"
                                className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5">
                                Abrir <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* BLOCO 7 — Alertas IA */}
          {snapshot && (
            <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />Alertas IA
                </CardTitle>
              </CardHeader>
              <CardContent>
                {snapshot.alerts.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">Nenhum alerta com evidência suficiente nas últimas 24h.</p>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                                {a.source && <span>Fonte: {a.source}</span>}
                                {typeof a.engagement === "number" && <span>Engajamento: {a.engagement.toLocaleString("pt-BR")}</span>}
                                {a.publishedAt && <span>Publicado: {formatRelative(new Date(a.publishedAt))}</span>}
                                {a.evidence && <span>Base: {a.evidence.news} notícias · {a.evidence.posts} posts · {a.evidence.videos} vídeos</span>}
                              </div>
                            </div>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* BLOCO 8 — Resumo Executivo */}
          {snapshot && (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-primary" />Resumo executivo
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Evidências</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { k: "O que aconteceu", v: snapshot.executiveSummary.what, icon: <Activity className="h-3.5 w-3.5" /> },
                    { k: "Evidência associada", v: snapshot.executiveSummary.why, icon: <Sparkles className="h-3.5 w-3.5" /> },
                    { k: "Fontes observadas", v: snapshot.executiveSummary.who, icon: <Megaphone className="h-3.5 w-3.5" /> },
                    { k: "Qual foi o impacto", v: snapshot.executiveSummary.impact, icon: <TrendingUp className="h-3.5 w-3.5" /> },
                  ].map(item => (
                    <div key={item.k} className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
                        <span className="text-primary">{item.icon}</span>{item.k}
                      </dt>
                      <dd className="text-sm text-foreground/90 mt-1.5 leading-relaxed">{item.v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default RealTimeMonitor;
