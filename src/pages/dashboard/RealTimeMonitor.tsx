import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CandidateSelector } from "@/components/dashboard/realtime/CandidateSelector";
import {
  RefreshCw, BrainCircuit, TrendingUp, TrendingDown, ShieldAlert,
  Trophy, Megaphone, AlertTriangle, ExternalLink, Sparkles, Activity, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Candidate { id: string; full_name: string; party?: string | null; }

interface KeyEvent {
  title: string;
  date: string;
  impact: "positivo" | "negativo" | "neutro" | string;
  summary: string;
  source?: string;
  url?: string;
}
interface Analysis {
  status: string;
  reputation_risk: string;
  election_strength: string;
  dominant_narrative: string;
  key_events: KeyEvent[];
  narrative_shifts: string[];
  emerging_risks: string[];
  strategic_analysis: string;
  confidence: string;
  evidence_count: number;
}
interface Intensity {
  score: number;
  label: string;
  volume1h?: number;
  volume6h: number;
  volume24h: number;
  growthPct: number;
}
interface Brief {
  candidate_name: string;
  fetched_at: string;
  window_hours: number;
  sources_count: number;
  provider?: string;
  intensity: Intensity;
  analysis?: Analysis;
  raw_items: { source: string; title: string; url: string; published_at: string }[];
}

const REFRESH_MS = 5 * 60 * 1000; // 5 min
const CACHE_PREFIX = "pol-intel-v1:";

function cleanFeedContent(text?: string | null): string {
  if (!text) return "";
  let s = String(text);
  // Decodifica entidades primeiro para revelar tags escapadas
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  // Remove anchor tags (abertura, fechamento, mesmo se truncadas)
  s = s.replace(/<\s*a\b[^>]*>?/gi, "");
  s = s.replace(/<\s*\/\s*a\s*>?/gi, "");
  // Remove qualquer outra tag (mesmo truncada no fim)
  s = s.replace(/<\/?[a-z][^>]*>?/gi, "");
  // Remove atributos órfãos que sobram quando o '<' foi removido antes
  s = s.replace(/\b(?:href|target|rel|src|alt|title|class|style)\s*=\s*"[^"]*"/gi, "");
  s = s.replace(/\b(?:href|target|rel|src|alt|title|class|style)\s*=\s*'[^']*'/gi, "");
  s = s.replace(/\b(?:href|target|rel)\s*=\s*\S+/gi, "");
  // Remove URLs cruas
  s = s.replace(/https?:\/\/\S+/gi, "");
  // Remove restos de "a " ou "/a" no começo
  s = s.replace(/^\s*\/?\s*a\b\s*/i, "");
  return s.replace(/\s+/g, " ").trim();
}

function isBrokenSummary(s: string): boolean {
  if (!s) return true;
  if (s.length < 20) return true;
  if (/href\s*=|<\s*a\b|target\s*=|rel\s*=/i.test(s)) return true;
  return false;
}

const statusTone = (s: string) => {
  const k = (s || "").toLowerCase();
  if (k.includes("crise")) return { ring: "border-destructive/40", bg: "bg-destructive/10", text: "text-destructive", label: "Crise" };
  if (k.includes("queda")) return { ring: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-500", label: "Em queda" };
  if (k.includes("alta")) return { ring: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-500", label: "Em alta" };
  if (k.includes("estável")) return { ring: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-500", label: "Estável" };
  return { ring: "border-muted-foreground/30", bg: "bg-muted/40", text: "text-muted-foreground", label: s || "—" };
};

const riskTone = (r: string) => {
  const k = (r || "").toLowerCase();
  if (k.includes("crít")) return { text: "text-destructive", bg: "bg-destructive/10", label: "Crítico", pct: 100 };
  if (k.includes("alto")) return { text: "text-red-500", bg: "bg-red-500/10", label: "Alto", pct: 75 };
  if (k.includes("moder")) return { text: "text-amber-500", bg: "bg-amber-500/10", label: "Moderado", pct: 50 };
  return { text: "text-emerald-500", bg: "bg-emerald-500/10", label: "Baixo", pct: 20 };
};

const strengthTone = (s: string) => {
  const k = (s || "").toLowerCase();
  if (k.includes("domin")) return { text: "text-emerald-500", bg: "bg-emerald-500/10", label: "Dominante", pct: 100 };
  if (k.includes("forte")) return { text: "text-emerald-500", bg: "bg-emerald-500/10", label: "Forte", pct: 80 };
  if (k.includes("moder")) return { text: "text-amber-500", bg: "bg-amber-500/10", label: "Moderada", pct: 55 };
  return { text: "text-red-500", bg: "bg-red-500/10", label: "Fraca", pct: 25 };
};

const impactTone = (i: string) => {
  const k = (i || "").toLowerCase();
  if (k.startsWith("pos")) return { text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-500" };
  if (k.startsWith("neg")) return { text: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30", dot: "bg-red-500" };
  return { text: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-500" };
};

const RealTimeMonitor = () => {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === selectedId) || null,
    [candidates, selectedId]
  );

  // Load user's tracked candidates
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("candidates")
        .select("id, full_name, party")
        .eq("user_id", user.id)
        .order("full_name");
      const list = (data || []) as Candidate[];
      setCandidates(list);
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    })();
  }, [user]);

  const fetchBrief = useCallback(async (name: string, force = false) => {
    const cacheKey = `${CACHE_PREFIX}${name}`;
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as Brief | null;
        if (cached && Date.now() - +new Date(cached.fetched_at) < REFRESH_MS) {
          setBrief(cached);
          return;
        }
      } catch { /* ignore */ }
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("political-intelligence", {
        body: { candidate_name: name },
      });
      if (fnError) throw fnError;
      if (!data) throw new Error("Resposta inválida do servidor");
      setBrief(data as Brief);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* ignore */ }
    } catch (e: any) {
      console.error("[Intel] fetch failed", e);
      setError(e?.message || "Falha ao consultar inteligência política");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial + on candidate change
  useEffect(() => {
    if (!selectedCandidate) { setBrief(null); return; }
    fetchBrief(selectedCandidate.full_name, false);
  }, [selectedCandidate?.id, fetchBrief]);

  // Polling 5min
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!selectedCandidate) return;
    timerRef.current = setInterval(() => {
      fetchBrief(selectedCandidate.full_name, true);
    }, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [selectedCandidate?.id, fetchBrief]);

  const analysis = brief?.analysis;
  const intensity = brief?.intensity;
  const st = statusTone(analysis?.status || "");
  const risk = riskTone(analysis?.reputation_risk || "");
  const strength = strengthTone(analysis?.election_strength || "");

  // Sanity check: bloqueia eventos fora das últimas 24h + sanitiza HTML/URLs + filtra irrelevantes.
  const visibleEvents = useMemo(() => {
    if (!analysis?.key_events) return [];
    const now = Date.now();
    const candidateName = (selectedCandidate?.full_name || "").toLowerCase().trim();
    const candidateTokens = candidateName
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    return analysis.key_events
      .map((ev) => ({
        ...ev,
        title: cleanFeedContent(ev.title),
        summary: cleanFeedContent(ev.summary),
        source: cleanFeedContent(ev.source),
      }))
      .filter((ev) => {
        if (!ev?.date) return false;
        const t = new Date(ev.date).getTime();
        if (Number.isNaN(t)) return false;
        const ageHours = (now - t) / 3600000;
        if (ageHours > 24) {
          console.warn("OLD EVENT BLOCKED", ev);
          return false;
        }
        if (!ev.title && !ev.summary) return false;
        if (candidateTokens.length > 0) {
          const haystack = `${ev.title} ${ev.summary}`.toLowerCase();
          const hits = candidateTokens.some((tok) => haystack.includes(tok));
          if (!hits) {
            console.warn("IRRELEVANT EVENT BLOCKED", ev);
            return false;
          }
        }
        return true;
      });
  }, [analysis?.key_events, selectedCandidate?.full_name]);


  const intensityTone =
    !intensity ? { text: "text-muted-foreground", bg: "bg-muted/40" }
    : intensity.score > 80 ? { text: "text-destructive", bg: "bg-destructive/10" }
    : intensity.score > 60 ? { text: "text-red-500", bg: "bg-red-500/10" }
    : intensity.score > 40 ? { text: "text-amber-500", bg: "bg-amber-500/10" }
    : intensity.score > 20 ? { text: "text-sky-500", bg: "bg-sky-500/10" }
    : { text: "text-muted-foreground", bg: "bg-muted/40" };

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 mt-0.5">
            <BrainCircuit className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Centro de Inteligência Política</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Análise estratégica gerada por IA a partir de fontes externas (Google News, portais, STF, TSE, Congresso, PF, YouTube).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CandidateSelector
            candidates={candidates}
            value={selectedId}
            onChange={setSelectedId}
            disabled={loading}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => selectedCandidate && fetchBrief(selectedCandidate.full_name, true)}
            disabled={loading || !selectedCandidate}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} />
            Atualizar IA
          </Button>
        </div>
      </div>

      {/* Meta bar */}
      {brief && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            ao vivo · atualiza a cada 5 min
          </Badge>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />
            atualizado {formatDistanceToNow(new Date(brief.fetched_at), { addSuffix: true, locale: ptBR })}
          </span>
          <span>·</span>
          <span>{brief.sources_count} fontes externas analisadas</span>
          <span>·</span>
          <span className="capitalize">confiança: {analysis?.confidence}</span>
          {brief.provider && (<><span>·</span><span>modelo: {brief.provider}</span></>)}
        </div>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      {!selectedCandidate ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground text-sm">
          Selecione um candidato para iniciar a análise política por IA.
        </CardContent></Card>
      ) : loading && !brief ? (
        <LoadingState />
      ) : brief ? (
        <>
          {/* Intensidade sempre visível (calculada das fontes, não da IA) */}
          {intensity && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card className="lg:col-span-1 border-border/60">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("rounded-md p-1.5", intensityTone.bg, intensityTone.text)}>
                      <Activity className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                      Intensidade de Movimento Público
                    </span>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className={cn("text-3xl font-bold tabular-nums", intensityTone.text)}>{intensity.score}</div>
                    <div className={cn("text-sm font-medium pb-1", intensityTone.text)}>{intensity.label}</div>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full transition-all", intensityTone.text.replace("text-", "bg-"))}
                         style={{ width: `${Math.min(100, intensity.score)}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums pt-1">
                    <span>{intensity.volume6h} nas últimas 6h</span>
                    <span>{intensity.volume24h} em 24h</span>
                    <span className={intensity.growthPct >= 0 ? "text-emerald-500" : "text-red-500"}>
                      {intensity.growthPct >= 0 ? "+" : ""}{intensity.growthPct}% vs 6h ant.
                    </span>
                  </div>
                </CardContent>
              </Card>
              {analysis && (
                <>
                  <KpiCard
                    icon={<Activity className="h-4 w-4" />}
                    label="Status político"
                    valueNode={<span className={cn("text-lg font-bold", st.text)}>{st.label}</span>}
                    tone={st}
                  />
                  <KpiCard
                    icon={<ShieldAlert className="h-4 w-4" />}
                    label="Risco reputacional"
                    valueNode={
                      <div className="space-y-1">
                        <div className={cn("text-lg font-bold", risk.text)}>{risk.label}</div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full", risk.text.replace("text-", "bg-"))} style={{ width: `${risk.pct}%` }} />
                        </div>
                      </div>
                    }
                    tone={risk}
                  />
                </>
              )}
            </div>
          )}

          {analysis ? (
            <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <KpiCard
              icon={<Trophy className="h-4 w-4" />}
              label="Força Política Atual"
              valueNode={
                <div className="space-y-1">
                  <div className={cn("text-lg font-bold", strength.text)}>{strength.label}</div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full", strength.text.replace("text-", "bg-"))} style={{ width: `${strength.pct}%` }} />
                  </div>
                </div>
              }
              tone={strength}
            />
            <KpiCard
              icon={<Megaphone className="h-4 w-4" />}
              label="Principal Narrativa nas Últimas 24h"
              valueNode={<p className="text-xs leading-snug font-medium line-clamp-4">{analysis.dominant_narrative}</p>}
              tone={{ text: "text-primary", bg: "bg-primary/10" }}
            />
          </div>


          {/* Executive Summary + Risks/Shifts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> Leitura Estratégica de Curto Prazo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                  {analysis.strategic_analysis}
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {analysis.emerging_risks?.length > 0 && (
                <Card className="border-red-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-red-500">
                      <AlertTriangle className="h-4 w-4" /> Riscos emergentes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-1.5 text-xs">
                      {analysis.emerging_risks.map((r, i) => (
                        <li key={i} className="flex gap-2"><span className="text-red-500">•</span><span>{r}</span></li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {analysis.narrative_shifts?.length > 0 && (
                <Card className="border-amber-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-500">
                      <TrendingUp className="h-4 w-4" /> Mudanças de narrativa
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-1.5 text-xs">
                      {analysis.narrative_shifts.map((r, i) => (
                        <li key={i} className="flex gap-2"><span className="text-amber-500">•</span><span>{r}</span></li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* AI Timeline */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Timeline · eventos críticos nas últimas 24h
              </CardTitle>
            </CardHeader>
            <CardContent>
              {visibleEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">Nenhum evento crítico identificado nas últimas 24h.</p>
              ) : (
                <ol className="relative border-l border-border/60 ml-2 space-y-4">
                  {visibleEvents.map((ev, i) => {
                    const tone = impactTone(ev.impact);
                    return (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="ml-4"
                      >
                        <span className={cn("absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-background", tone.dot)} />
                        <div className={cn("rounded-lg border p-3", tone.border, tone.bg.replace("/10", "/5"))}>
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <h4 className="text-sm font-semibold">{ev.title}</h4>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 border", tone.border, tone.text)}>
                                <span className={cn("h-1 w-1 rounded-full", tone.dot)} />
                                {ev.impact}
                              </span>
                              <span>{ev.date}</span>
                              {ev.source && <span>· {ev.source}</span>}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{isBrokenSummary(ev.summary) ? "Resumo indisponível. IA não encontrou conteúdo textual suficiente nesta fonte." : ev.summary}</p>


                        </div>
                      </motion.li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
            </>
          ) : null}

          {/* Sources fed to AI */}
          {brief && brief.raw_items.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Fontes consumidas pela IA ({brief.raw_items.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                  {brief.raw_items.map((it, i) => (
                    <a
                      key={i}
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs p-2 rounded border border-border/40 hover:border-border hover:bg-muted/30 transition"
                    >
                      <div className="text-[10px] text-muted-foreground mb-0.5">{it.source} · {it.published_at.slice(0, 10)}</div>
                      <div className="line-clamp-2 font-medium">{it.title}</div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <LoadingState />
      )}
    </div>
  );
};

const KpiCard = ({
  icon, label, valueNode, tone,
}: {
  icon: React.ReactNode;
  label: string;
  valueNode: React.ReactNode;
  tone: { text: string; bg: string };
}) => (
  <Card className="border-border/60">
    <CardContent className="p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className={cn("rounded-md p-1.5", tone.bg, tone.text)}>{icon}</div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <div>{valueNode}</div>
    </CardContent>
  </Card>
);

const LoadingState = () => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i}><CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-full" />
        </CardContent></Card>
      ))}
    </div>
    <Card><CardContent className="p-6 space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-4/6" />
    </CardContent></Card>
  </div>
);

export default RealTimeMonitor;
