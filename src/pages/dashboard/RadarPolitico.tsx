import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2, ExternalLink, Search, Radio, CalendarIcon, Sparkles, ArrowUpDown, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { analyzeEventImpact, type ImpactAnalysis } from "@/lib/radarImpactAnalysis";
import { generateEventSummary } from "@/lib/radarEventSummary";

interface RadarEvent {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  snippet?: string;
  content?: string;
  category: string;
  event_date: string;
  source_count: number;
  institutional_sources: number;
  social_score: number;
  importance: number;
  sources: Array<{ name: string; url: string; type?: string }>;
}

interface RadarJobStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  total_chunks: number;
  processed_chunks: number;
  events_count: number;
  events: RadarEvent[];
  error: string | null;
  partial?: boolean;
  page_size?: number;
  offset?: number;
  has_more?: boolean;
}

const CATEGORIES = [
  "Todos","Eleições","STF","TSE","PF","CPI","Congresso","Executivo","Economia",
  "Escândalos","Prisões","Julgamentos","Internacional","Outros",
];

const MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// =====================================================================
// Entity Resolution — distinguir Flávio / Jair / Eduardo / Michelle / Carlos Bolsonaro
// =====================================================================
const CANDIDATE_ALIASES: Record<string, { strong: string[]; conflicts: string[] }> = {
  "flavio bolsonaro": {
    strong: ["flávio bolsonaro", "flavio bolsonaro", "senador flávio", "senador flavio", "flávio nantes", "flavio nantes"],
    conflicts: ["jair bolsonaro", "ex-presidente bolsonaro", "presidente bolsonaro", "eduardo bolsonaro", "michelle bolsonaro", "carlos bolsonaro"],
  },
  "jair bolsonaro": {
    strong: ["jair bolsonaro", "ex-presidente bolsonaro", "presidente bolsonaro", "jair messias"],
    conflicts: ["flávio bolsonaro", "flavio bolsonaro", "eduardo bolsonaro", "michelle bolsonaro", "carlos bolsonaro"],
  },
  "eduardo bolsonaro": {
    strong: ["eduardo bolsonaro", "deputado eduardo bolsonaro"],
    conflicts: ["jair bolsonaro", "flávio bolsonaro", "flavio bolsonaro", "michelle bolsonaro", "carlos bolsonaro"],
  },
  "michelle bolsonaro": {
    strong: ["michelle bolsonaro"],
    conflicts: ["jair bolsonaro", "flávio bolsonaro", "flavio bolsonaro", "eduardo bolsonaro", "carlos bolsonaro"],
  },
  "carlos bolsonaro": {
    strong: ["carlos bolsonaro", "vereador carlos bolsonaro"],
    conflicts: ["jair bolsonaro", "flávio bolsonaro", "flavio bolsonaro", "eduardo bolsonaro", "michelle bolsonaro"],
  },
};

function normalizeCandidateName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// =====================================================================
// NER: extrai entidade principal (pessoa) do título/resumo do evento.
// Heurística: nomes próprios (>=2 palavras capitalizadas, com de/da/do/dos opcional).
// =====================================================================
const STOPWORDS_CAPS = new Set([
  "STF","TSE","STJ","PF","CGU","TCU","CNJ","BC","BCB","AGU","COAF","MPF","PGR",
  "CPI","CPMI","PT","PL","PSDB","MDB","PP","PSD","PDT","PSB","NOVO","PSOL",
  "União","Uniao","Republicanos","Senado","Câmara","Camara","Planalto",
  "Itamaraty","Brasil","Brasília","Brasilia",
  "Janeiro","Fevereiro","Março","Marco","Abril","Maio","Junho","Julho",
  "Agosto","Setembro","Outubro","Novembro","Dezembro",
]);

function extractPeople(text: string): string[] {
  if (!text) return [];
  const re = /\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+(?:de|da|do|dos|das)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]?[a-záéíóúâêôãõç]+|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){1,3})\b/g;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const name = m[1].trim();
    if (name.length > 60) continue;
    const first = name.split(/\s+/)[0];
    if (STOPWORDS_CAPS.has(first)) continue;
    out.push(name);
  }
  return out;
}

interface EntityMatchResult {
  primaryEntity: string | null;
  secondaryEntities: string[];
  matched: boolean;
  score: number;
  reason: string;
}

function analyzeEventEntity(event: RadarEvent, candidateName: string): EntityMatchResult {
  const candNorm = normalizeCandidateName(candidateName);
  const candTokens = candNorm.split(/\s+/).filter((t) => !["de","da","do","dos","das"].includes(t));
  const candFirst = candTokens[0] ?? "";
  const candLast = candTokens[candTokens.length - 1] ?? "";

  const title = sanitizeRadarText(event.title);
  const summary = sanitizeRadarText(event.summary ?? event.description ?? "");
  const haystackNorm = `${title} ${summary}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const people = Array.from(new Set([...extractPeople(title), ...extractPeople(summary)]));
  const primary = people[0] ?? null;
  const secondary = people.slice(1, 6);

  // Disambiguation overrides (ex.: família Bolsonaro)
  const rule = CANDIDATE_ALIASES[candNorm];
  if (rule) {
    const hasStrong = rule.strong.some((a) => haystackNorm.includes(normalizeCandidateName(a)));
    const hasConflict = rule.conflicts.some((a) => haystackNorm.includes(normalizeCandidateName(a)));
    if (hasStrong) return { primaryEntity: primary, secondaryEntities: secondary, matched: true, score: 1, reason: `alias forte: ${candidateName}` };
    if (hasConflict) return { primaryEntity: primary, secondaryEntities: secondary, matched: false, score: 0, reason: "conflito de homônimo" };
  }

  // Estrito: a entidade principal precisa ser o candidato selecionado.
  if (!primary) {
    if (candTokens.length >= 2 && haystackNorm.includes(candNorm)) {
      return { primaryEntity: candidateName, secondaryEntities: secondary, matched: true, score: 0.7, reason: "nome completo no texto" };
    }
    return { primaryEntity: null, secondaryEntities: secondary, matched: false, score: 0, reason: "nenhuma pessoa detectada" };
  }

  const primaryNorm = normalizeCandidateName(primary);
  const primaryTokens = primaryNorm.split(/\s+/);
  const containsFull = candTokens.length >= 2 && primaryNorm.includes(candTokens.slice(0, 2).join(" "));
  const containsFirstAndLast = primaryNorm.includes(candFirst) && primaryTokens.includes(candLast);

  if (containsFull || containsFirstAndLast) {
    return { primaryEntity: primary, secondaryEntities: secondary, matched: true, score: 1, reason: "primary_entity = candidato" };
  }
  if (candLast.length >= 5 && primaryTokens.includes(candLast)) {
    return { primaryEntity: primary, secondaryEntities: secondary, matched: true, score: 0.85, reason: `sobrenome distintivo "${candLast}"` };
  }

  return {
    primaryEntity: primary,
    secondaryEntities: secondary,
    matched: false,
    score: 0,
    reason: `primary_entity "${primary}" ≠ "${candidateName}"`,
  };
}

function isEventRelevantForCandidate(event: RadarEvent, candidateName: string): boolean {
  return analyzeEventEntity(event, candidateName).matched;
}

const PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "90d", label: "90 dias", days: 90 },
  { id: "1y", label: "1 ano", days: 365 },
  { id: "4y", label: "4 anos", days: 365 * 4 },
  { id: "8y", label: "8 anos", days: 365 * 8 },
  { id: "custom", label: "Personalizado", days: 0 },
];


const nfBR = new Intl.NumberFormat("pt-BR");
const PAGE_SIZE = 500;
const LOAD_MORE_STEP = 100;
const BACKEND_FETCH_PAGE = 500;
const MEMORY_CACHE_TTL_MS = 15 * 60 * 1000;
const BROWSER_CACHE_TTL_MS = 60 * 60 * 1000;
const radarMemoryCache = new Map<string, { expiresAt: number; events: RadarEvent[]; jobId?: string; fetchedAt: string; eventsCount?: number }>();

function radarCacheKey(candidateId: string, from?: Date, to?: Date, category = "Todos", sortBy = "importance") {
  return ["radar-v8", candidateId, from?.toISOString().slice(0, 10), to?.toISOString().slice(0, 10), category, sortBy].join("|");
}

function getRadarCache(key: string) {
  const now = Date.now();
  const mem = radarMemoryCache.get(key);
  if (mem && mem.expiresAt > now) return mem;
  if (mem) radarMemoryCache.delete(key);
  try {
    const raw = localStorage.getItem(`radar-cache:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || parsed.expiresAt <= now || !Array.isArray(parsed.events)) {
      localStorage.removeItem(`radar-cache:${key}`);
      return null;
    }
    radarMemoryCache.set(key, { ...parsed, expiresAt: now + MEMORY_CACHE_TTL_MS });
    return parsed as { expiresAt: number; events: RadarEvent[]; jobId?: string; fetchedAt: string; eventsCount?: number };
  } catch {
    return null;
  }
}

function setRadarCache(key: string, entry: { events: RadarEvent[]; jobId?: string; fetchedAt: string; eventsCount?: number }) {
  const memEntry = { ...entry, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS };
  radarMemoryCache.set(key, memEntry);
  try {
    localStorage.setItem(`radar-cache:${key}`, JSON.stringify({ ...entry, expiresAt: Date.now() + BROWSER_CACHE_TTL_MS }));
  } catch {
    // cache local é best-effort; evita travar a UI por quota do navegador
  }
}

function sanitizeRadarText(input: unknown): string {
  if (input == null) return "";
  let s = String(input);
  // Remove HTML tags
  s = s.replace(/<[^>]*>/g, " ");
  // Decode common HTML entities
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "")
    .replace(/&gt;/gi, "")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    });
  // Remove URLs cruas
  s = s.replace(/https?:\/\/\S+/gi, "");
  // Remove control / zero-width
  s = Array.from(s).map((ch) => {
    const code = ch.charCodeAt(0);
    return (code <= 31 || (code >= 127 && code <= 159)) ? " " : ch;
  }).join("");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
  const map: Record<string, string> = {
    "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'",
    "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"',
    "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-",
    "\u2022": "-", "\u2023": "-", "\u25E6": "-", "\u2043": "-",
    "\u00A0": " ", "\u202F": " ", "\u2009": " ", "\u200A": " ",
    "\u2026": "...",
  };
  s = s.replace(/[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2013\u2014\u2015\u2212\u2022\u2023\u25E6\u2043\u00A0\u202F\u2009\u200A\u2026]/g, (c) => map[c] ?? c);
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Constrói um resumo real e legível do evento, evitando repetir o título.
 * Prioridade: summary -> description -> snippet -> content (recortado) -> title.
 */
function buildEventSummary(e: {
  title?: string;
  summary?: string;
  description?: string;
  snippet?: string;
  content?: string;
}, maxLen = 800): string {
  const title = sanitizeRadarText(e.title).toLowerCase();
  const isUseful = (raw: unknown) => {
    const t = sanitizeRadarText(raw);
    if (!t || t.length < 25) return "";
    if (title && t.toLowerCase() === title) return "";
    return t;
  };
  const candidates = [e.summary, e.description, e.snippet];
  for (const c of candidates) {
    const t = isUseful(c);
    if (t) return t.length > maxLen ? t.slice(0, maxLen).replace(/\s+\S*$/, "") + "…" : t;
  }
  const contentClean = sanitizeRadarText(e.content);
  if (contentClean && contentClean.toLowerCase() !== title) {
    const trimmed = contentClean.length > maxLen
      ? contentClean.slice(0, maxLen).replace(/\s+\S*$/, "") + "…"
      : contentClean;
    if (trimmed.length >= 25) return trimmed;
  }
  return sanitizeRadarText(e.title);
}


function band(value: number) {
  if (value >= 70) return { label: "Grande", tone: "bg-foreground text-background" };
  if (value >= 40) return { label: "Médio", tone: "bg-muted text-foreground border" };
  return { label: "Pequeno", tone: "bg-background text-muted-foreground border" };
}

function friendlyRadarError(message?: string | null) {
  const msg = message ?? "";
  if (/RADAR_TIMEOUT/i.test(msg)) return "Busca histórica retornou resultado parcial. O processamento continuará em background.";
  if (/Rate limit/i.test(msg)) return "Algumas fontes limitaram requisições temporariamente. Eventos parciais foram preservados.";
  return msg || "Falha temporária no Radar Político.";
}

function fmtDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function RadarPolitico() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("all");
  const [preset, setPreset] = useState<string>("90d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [category, setCategory] = useState<string>("Todos");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "importance" | "social">("importance");
  const [selected, setSelected] = useState<RadarEvent | null>(null);
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<{ message: string; stack: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(LOAD_MORE_STEP);
  const listParentRef = useRef<HTMLDivElement | null>(null);

  const { data: candidates } = useQuery({
    queryKey: ["candidates-min", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates").select("id,full_name").eq("user_id", user!.id).order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const candidateName = useMemo(() => {
    if (candidateId === "all") return "todos os candidatos monitorados";
    return candidates?.find((c) => c.id === candidateId)?.full_name ?? "candidato";
  }, [candidateId, candidates]);

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    const days = PRESETS.find((p) => p.id === preset)?.days ?? 90;
    const t = new Date();
    const f = new Date();
    f.setDate(f.getDate() - days);
    return { from: f, to: t };
  }, [preset, customFrom, customTo]);

  const cacheKey = useMemo(() => radarCacheKey(candidateId, from, to, category, sortBy), [candidateId, from, to, category, sortBy]);

  // Polling do job em background
  const { data: jobStatus } = useQuery({
    queryKey: ["radar-job", jobId],
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = (q.state.data as RadarJobStatus | undefined)?.status;
      return s === "completed" || s === "failed" ? false : 3000;
    },
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("radar-job-status", {
        body: { job_id: jobId, page_size: PAGE_SIZE, offset: 0, sort: sortBy },
      });
      if (error) throw error;
      return data as RadarJobStatus;
    },
  });

  const isJobRunning = jobStatus?.status === "queued" || jobStatus?.status === "running";
  const jobProgress = jobStatus?.total_chunks
    ? Math.min(100, Math.max(0, Math.round((jobStatus.processed_chunks / jobStatus.total_chunks) * 100)))
    : Math.min(100, Math.max(0, jobStatus?.progress ?? 0));

  // Atualiza resultados incrementalmente enquanto o job roda e mantém o resultado final/ parcial ao concluir
  useEffect(() => {
    if (!jobStatus) return;
    if (Array.isArray(jobStatus.events)) {
      const clean = (jobStatus.events ?? []).map((e) => {
        const rawWithExtras = e as RadarEvent & { body?: string; snippet?: string };
        return {
          ...e,
          title: sanitizeRadarText(e.title),
          summary: generateEventSummary({
            title: e.title,
            summary: e.summary,
            description: e.description,
            snippet: rawWithExtras.snippet,
            content: e.content,
            body: rawWithExtras.body,
            category: e.category,
            source_count: e.source_count,
            institutional_sources: e.institutional_sources,
            social_score: e.social_score,
            importance: e.importance,
          }),
          description: sanitizeRadarText(e.description ?? ""),
          snippet: sanitizeRadarText(rawWithExtras.snippet ?? ""),
          content: sanitizeRadarText(e.content ?? ""),
          category: sanitizeRadarText(e.category),
          sources: (e.sources ?? []).map((s) => ({ ...s, name: sanitizeRadarText(s.name) })),
        };
      });
      setEvents((prev) => {
        const source = prev.length > clean.length ? prev : clean;
        const seen = new Set(source.map((e) => e.id || `${e.event_date}|${e.title}`));
        const merged = [...source];
        for (const e of clean) {
          const key = e.id || `${e.event_date}|${e.title}`;
          if (!seen.has(key)) merged.push(e);
        }
        setRadarCache(cacheKey, { events: merged, jobId: jobStatus.id, fetchedAt: new Date().toISOString(), eventsCount: jobStatus.events_count });
        return merged;
      });
      if (jobStatus.status === "completed") {
        setLastFetchedAt(new Date());
        if (jobStatus.error) {
          setLastError({ message: friendlyRadarError(jobStatus.error), stack: "" });
          toast.warning(`${nfBR.format(jobStatus.events_count ?? clean.length)} eventos retornados com aviso do processamento`);
        } else {
          setLastError(null);
          toast.success(`${nfBR.format(jobStatus.events_count ?? clean.length)} eventos coletados`);
        }
      }
    } else if (jobStatus.status === "failed") {
      setLastError({ message: jobStatus.error ?? "Job falhou", stack: "" });
      toast.error(jobStatus.error ?? "Job falhou");
    }
  }, [jobStatus, cacheKey]);

  const searchMutation = useMutation({
    mutationFn: async (_force: boolean = true) => {
      // Busca manual SEMPRE força refresh — nunca retorna cache antigo
      const forceRefresh = true;
      console.log("FORCE REFRESH", forceRefresh);
      console.log("CACHE HIT", false);
      console.log("RUNNING NEW SEARCH");

      // Limpa qualquer cache local antes de buscar
      try {
        radarMemoryCache.clear();
        Object.keys(localStorage).filter((k) => /radar|cache|events/i.test(k)).forEach((k) => localStorage.removeItem(k));
        Object.keys(sessionStorage).filter((k) => /radar|cache|events/i.test(k)).forEach((k) => sessionStorage.removeItem(k));
      } catch { /* ignore */ }

      if (candidateId === "all") throw new Error("Selecione um candidato.");
      if (!from || !to) throw new Error("Defina o período (datas inicial e final).");
      setEvents([]);
      setVisibleCount(LOAD_MORE_STEP);
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("radar-job-create", {
        body: {
          candidate_id: candidateId,
          candidate_name: candidateName,
          start_date: from.toISOString().slice(0, 10),
          end_date: to.toISOString().slice(0, 10),
          categories: category === "Todos" ? [] : [category],
          sort: sortBy,
          force_refresh: true,
          ignore_cache: true,
        },
      });
      if (error) {
        const ctx = (error as { context?: Response })?.context;
        const errorBody = ctx?.clone ? await ctx.clone().json().catch(() => null) as { error?: string } | null : null;
        throw new Error(errorBody?.error ?? error.message);
      }
      return data as { job_id?: string | null; status: string; events?: RadarEvent[]; cached?: boolean; events_count?: number };
    },
    onSuccess: (data) => {
      if (Array.isArray(data.events) && data.events.length > 0) {
        setEvents(data.events);
      }
      setJobId(data.job_id ?? null);
      toast.info("Buscando fontes externas...");
    },
    onError: (e: unknown) => {
      const msg = friendlyRadarError(e instanceof Error ? e.message : "Falha ao iniciar job");
      setLastError({ message: msg, stack: "" });
      toast.error(msg);
    },
  });

  const loadMoreMutation = useMutation({
    mutationFn: async () => {
      if (!jobId || jobId === "cache") return [] as RadarEvent[];
      const { data, error } = await supabase.functions.invoke("radar-job-status", {
        body: { job_id: jobId, page_size: BACKEND_FETCH_PAGE, offset: events.length, sort: sortBy },
      });
      if (error) throw error;
      const payload = data as { events?: RadarEvent[] } | null;
      return Array.isArray(payload?.events) ? payload.events : [];
    },
    onSuccess: (next) => {
      if (next.length === 0) return;
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id || `${e.event_date}|${e.title}`));
        const merged = [...prev];
        for (const e of next) {
          const key = e.id || `${e.event_date}|${e.title}`;
          if (!seen.has(key)) merged.push(e);
        }
        setRadarCache(cacheKey, { events: merged, jobId: jobId ?? undefined, fetchedAt: new Date().toISOString(), eventsCount: jobStatus?.events_count });
        return merged;
      });
    },
    onError: (e: unknown) => toast.error(friendlyRadarError(e instanceof Error ? e.message : "Falha ao carregar mais eventos")),
  });

  // Auto-prefetch: quando backend tem mais eventos do que carregamos localmente,
  // baixa o restante em background para que a paginação local cubra todos os 2190+.
  useEffect(() => {
    const backendCount = jobStatus?.events_count ?? 0;
    if (!jobId || jobId === "cache") return;
    if (loadMoreMutation.isPending) return;
    if (backendCount > events.length) {
      const t = setTimeout(() => loadMoreMutation.mutate(), 250);
      return () => clearTimeout(t);
    }
  }, [jobStatus?.events_count, events.length, jobId, loadMoreMutation.isPending]);


  // Filtros locais
  const filtered = useMemo(() => {
    let list = events;
    // Entity resolution: garante que notícias do Jair não vazem para Flávio (e vice-versa)
    if (candidateId !== "all" && candidateName) {
      const before = list.length;
      list = list.filter((e) => isEventRelevantForCandidate(e, candidateName));
      if (before !== list.length) {
        console.log(`[Radar] Entity filter '${candidateName}': ${before} → ${list.length} eventos`);
      }
    }
    if (category !== "Todos") list = list.filter((e) => e.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.title.toLowerCase().includes(q) || (e.summary ?? "").toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      if (sortBy === "importance") return b.importance - a.importance;
      if (sortBy === "social") return b.social_score - a.social_score;
      return new Date(b.event_date).getTime() - new Date(a.event_date).getTime();
    });
    return list;
  }, [events, candidateId, candidateName, category, search, sortBy]);


  useEffect(() => {
    setVisibleCount(LOAD_MORE_STEP);
  }, [cacheKey, search]);

  const visibleEvents = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const backendTotal = jobStatus?.events_count ?? events.length;
  useEffect(() => {
    console.log("TOTAL EVENTS", events.length);
    console.log("BACKEND TOTAL", backendTotal);
    console.log("FILTERED EVENTS", filtered.length);
    console.log("SORTED EVENTS", filtered.length);
    console.log("VISIBLE EVENTS", visibleEvents.length);
    console.log("FIRST EVENT DATE", filtered[0]?.event_date);
    console.log("LAST EVENT DATE", filtered.at(-1)?.event_date);
  }, [backendTotal, filtered, visibleEvents.length, events.length]);

  const rowVirtualizer = useVirtualizer({
    count: visibleEvents.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 108,
    overscan: 8,
  });

  const kpis = useMemo(() => ({
    total: Math.max(backendTotal, filtered.length),
    grandes: filtered.filter((e) => e.importance >= 70).length,
    institucionais: filtered.filter((e) =>
      e.institutional_sources > 0 || e.sources?.some((s) => /\b(STF|TSE|PF|Senado|Câmara|Camara|Planalto|STJ|TCU|CGU|AGU|CNJ)\b/i.test(s.name)),
    ).length,
    altaRepercussao: filtered.filter((e) => e.social_score >= 60).length,
  }), [filtered, backendTotal]);

  const timeline = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      if (!e.event_date) return;
      const d = new Date(e.event_date);
      if (isNaN(d.getTime())) return;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    if (!from || !to) return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    const months: Array<[string, number]> = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cursor <= end && months.length < 120) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      months.push([k, map.get(k) ?? 0]);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [filtered, from, to]);
  const maxMonth = Math.max(1, ...timeline.map(([, v]) => v));

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Radio className="h-5 w-5 text-muted-foreground" /> Radar Político
        </h1>
        <p className="text-sm text-muted-foreground">
          Eventos políticos detectados por IA em fontes externas.
        </p>
      </header>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger className="w-[220px] h-9"><SelectValue placeholder="Candidato" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Selecione um candidato</SelectItem>
                {candidates?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>))}
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as "date" | "importance" | "social")}>
              <SelectTrigger className="w-[170px] h-9">
                <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="importance">Maior importância</SelectItem>
                <SelectItem value="date">Mais recente</SelectItem>
                <SelectItem value="social">Maior repercussão</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar evento..."
                className="pl-8 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Button
              size="sm"
              onClick={() => searchMutation.mutate(false)}
              disabled={searchMutation.isPending || isJobRunning || candidateId === "all"}
              className="h-9"
            >
              {searchMutation.isPending || isJobRunning ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {isJobRunning ? "Buscando..." : "Buscar Radar"}
            </Button>
          </div>

          {/* Chips de período */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                variant={preset === p.id ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </Button>
            ))}
            {preset === "custom" && (
              <>
                <DateField date={customFrom} onChange={setCustomFrom} placeholder="Início" />
                <DateField date={customTo} onChange={setCustomTo} placeholder="Fim" />
              </>
            )}
            {lastFetchedAt && (
              <span className="text-[11px] text-muted-foreground self-center ml-auto">
                Radar · {lastFetchedAt.toLocaleTimeString("pt-BR")}
                {" · "}
                <button
                  className="underline hover:no-underline"
                  onClick={() => searchMutation.mutate(true)}
                  disabled={searchMutation.isPending || isJobRunning}
                >
                  Atualizar
                </button>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Progresso do job em background */}
      {isJobRunning && jobStatus && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Buscando eventos históricos... lote {jobStatus.processed_chunks}/{jobStatus.total_chunks || "?"}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {nfBR.format(jobStatus.events_count)} eventos · {jobProgress}%
              </span>
            </div>
            <Progress value={jobProgress} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground">
              A janela pode ser fechada — o job continua no servidor e será recarregado do cache ao voltar.
            </p>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-1 gap-3">
        <Kpi label="Eventos" value={kpis.total} />
      </section>

      {/* Timeline */}
      {timeline.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Distribuição mensal
            </div>
            <div className="overflow-x-auto pb-1">
            <div className="grid gap-2 items-end h-20 min-w-full" style={{ gridTemplateColumns: `repeat(${timeline.length}, minmax(18px, 1fr))` }}>
              {timeline.map(([k, count]) => {
                const [y, m] = k.split("-");
                return (
                  <div key={k} className="flex flex-col items-center gap-1 h-full justify-end">
                    <div
                      className="w-full bg-foreground/80 rounded-sm transition-all"
                      style={{ height: `${(count / maxMonth) * 100}%`, minHeight: 2 }}
                      title={`${count} eventos`}
                    />
                    <span className="text-[10px] text-muted-foreground">{MONTHS_PT[Number(m) - 1]}/{y.slice(2)}</span>
                  </div>
                );
              })}
            </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      <section className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
          {searchMutation.isPending || isJobRunning
            ? "Buscando eventos históricos..."
            : `${nfBR.format(filtered.length)} eventos`}
        </h2>

        {lastError && !searchMutation.isPending && !isJobRunning && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Falha na busca do Radar
              </div>
              <p className="text-sm text-destructive/90">{lastError.message}</p>
              {lastError.stack && (
                <pre className="max-h-40 overflow-auto rounded border border-destructive/20 bg-background/80 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                  {lastError.stack}
                </pre>
              )}
            </CardContent>
          </Card>
        )}

        {(searchMutation.isPending || isJobRunning) && events.length === 0 ? (
          <div className="border rounded-md bg-card p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando eventos históricos
              {jobStatus ? ` (${jobStatus.processed_chunks}/${jobStatus.total_chunks || "?"} períodos · ${nfBR.format(jobStatus.events_count)} eventos)` : "..."}
            </div>
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="border rounded-md p-4 bg-background animate-pulse h-20" />
              ))}
            </div>
          </div>
        ) : events.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center space-y-2">
              <Sparkles className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Selecione um candidato e período, depois clique em <strong>Buscar Radar</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                O Radar coleta fontes externas e processa lotes históricos em background.
              </p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento corresponde aos filtros.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <div ref={listParentRef} className="border rounded-md bg-card h-[70vh] overflow-y-auto">
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const e = visibleEvents[virtualRow.index];
                  if (!e) return null;
              const b = band(e.importance);
              const entity = candidateId !== "all" && candidateName
                ? analyzeEventEntity(e, candidateName)
                : null;
              return (
                <div
                  key={e.id || `${e.event_date}-${virtualRow.index}`}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full border-b last:border-b-0"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <button
                    onClick={() => setSelected(e)}
                    className="w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1 flex-wrap">
                          <span className="font-mono">{fmtDate(e.event_date)}</span>
                          <span>·</span>
                          <span className="font-medium text-foreground/80">{e.category}</span>
                          <span>·</span>
                          <span>{nfBR.format(e.source_count)} fontes</span>
                          {e.institutional_sources > 0 && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-blue-500/40 text-blue-600 dark:text-blue-400">
                              Institucional
                            </Badge>
                          )}
                          {entity?.matched && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                              ✓ Evento validado por entidade
                            </Badge>
                          )}
                        </div>
                        <h3 className="text-sm font-medium leading-snug break-words [overflow-wrap:anywhere]">{sanitizeRadarText(e.title)}</h3>
                        {(() => {
                          const s = sanitizeRadarText(e.summary);
                          return s ? (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words [overflow-wrap:anywhere]">{s}</p>
                          ) : null;
                        })()}
                        <ImpactSection analysis={analyzeEventImpact({
                          title: e.title, summary: e.summary, category: e.category,
                          social_score: e.social_score, importance: e.importance, source_count: e.source_count,
                        })} compact />
                        {entity && import.meta.env.DEV && (
                          <div className="mt-2 rounded border border-dashed border-amber-500/40 bg-amber-500/5 p-2 text-[10px] font-mono text-amber-700 dark:text-amber-300 space-y-0.5">
                            <div>[debug] primary_entity: {entity.primaryEntity ?? "—"}</div>
                            <div>[debug] match_score: {entity.score.toFixed(2)} ({entity.matched ? "incluído" : "excluído"})</div>
                            <div>[debug] motivo: {entity.reason}</div>
                            {entity.secondaryEntities.length > 0 && (
                              <div>[debug] secondary: {entity.secondaryEntities.join(", ")}</div>
                            )}
                          </div>
                        )}

                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${b.tone}`}>
                          {b.label} · {e.importance}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          social {e.social_score}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              );
                })}
              </div>
            </div>
            {(visibleCount < filtered.length || ((jobStatus?.events_count ?? 0) > events.length && !!jobId && jobId !== "cache")) && (
              <Button
                variant="outline"
                className="w-full"
                disabled={loadMoreMutation.isPending}
                onClick={() => {
                  const nextVisible = visibleCount + LOAD_MORE_STEP;
                  console.log("[Radar] Load more clicked", {
                    visibleCount,
                    nextVisible,
                    filteredLength: filtered.length,
                    eventsLength: events.length,
                    backendTotal: jobStatus?.events_count ?? 0,
                  });
                  // Sempre incrementa a janela visível
                  setVisibleCount(nextVisible);
                  // Se já mostramos tudo que está em memória e backend tem mais, busca próximo lote
                  if (nextVisible > filtered.length && (jobStatus?.events_count ?? 0) > events.length) {
                    loadMoreMutation.mutate();
                  }
                }}
              >
                {loadMoreMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Carregar mais {LOAD_MORE_STEP}
              </Button>
            )}

          </div>
        )}
      </section>

      {/* Detail modal */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base leading-snug break-words [overflow-wrap:anywhere]">{sanitizeRadarText(selected.title)}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-xs flex-wrap">
                  <span>{fmtDate(selected.event_date)}</span>
                  <span>·</span>
                  <Badge variant="outline" className="text-[10px]">{sanitizeRadarText(selected.category)}</Badge>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Importância" value={selected.importance} />
                  <Stat label="Fontes" value={selected.source_count} />
                  <Stat label="Social" value={selected.social_score} />
                </div>
                {(() => {
                  const description =
                    sanitizeRadarText(selected.summary) ||
                    sanitizeRadarText(selected.description) ||
                    sanitizeRadarText(selected.content) ||
                    "Descrição não disponível";
                  return (
                    <div>
                      <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Resumo</h4>
                      <p className="text-sm leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{description}</p>
                    </div>
                  );
                })()}
                <ImpactSection analysis={analyzeEventImpact({
                  title: selected.title, summary: selected.summary, category: selected.category,
                  social_score: selected.social_score, importance: selected.importance, source_count: selected.source_count,
                })} />

                {selected.sources?.length > 0 && (() => {
                  const names = Array.from(
                    new Set(
                      selected.sources
                        .map((s) => sanitizeRadarText(s.name))
                        .filter((n) => n && !/^https?:/i.test(n))
                    )
                  );
                  if (names.length === 0) return null;
                  return (
                    <div>
                      <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                        Fontes ({names.length})
                      </h4>
                      <p className="text-sm text-muted-foreground leading-6 break-words">
                        {names.join(" · ")}
                      </p>
                    </div>
                  );
                })()}

              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DateField({ date, onChange, placeholder }: { date?: Date; onChange: (d?: Date) => void; placeholder: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-7 text-xs justify-start font-normal", !date && "text-muted-foreground")}>
          <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
          {date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={onChange} initialFocus className={cn("p-3 pointer-events-auto")} />
      </PopoverContent>
    </Popover>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">{nfBR.format(value)}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{nfBR.format(value)}</div>
    </div>
  );
}

function ImpactSection({ analysis, compact = false }: { analysis: ImpactAnalysis; compact?: boolean }) {
  const impactTone =
    analysis.impact === "Alto"
      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
      : analysis.impact === "Médio"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  const toneTone =
    analysis.tone === "Desfavorável"
      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
      : analysis.tone === "Favorável"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
      : "bg-muted text-muted-foreground border-border";
  const socialTone =
    analysis.social === "Alta"
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
      : analysis.social === "Moderada"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
      : "bg-muted text-muted-foreground border-border";

  return (
    <div className={cn("mt-2 rounded-md border border-border/60 bg-muted/30 p-2", compact ? "space-y-1.5" : "space-y-2 p-3")}>
      <div className={cn("uppercase tracking-wider text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>
        Análise de impacto
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium", impactTone)}>
          Impacto: {analysis.impact}
        </span>
        <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium", toneTone)}>
          Tom: {analysis.tone}
        </span>
        <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-medium", socialTone)}>
          Social: {analysis.social}
        </span>
      </div>
      <p className={cn("leading-snug text-foreground/80", compact ? "text-[11px] line-clamp-3" : "text-xs leading-6")}>
        {analysis.text}
      </p>
    </div>
  );
}

