import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, CalendarDays, Newspaper, ChevronDown, ChevronUp,
  Landmark, Vote, Gavel, Mic, Users, TrendingUp, Video, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

interface HistoricalSource {
  name: string;
  url: string;
  region?: string;
  publishedAt?: string | null;
  title?: string;
  kind?: "news" | "video" | "post";
}

interface HistoricalEvent {
  name: string;
  type: string;
  start_date: string;
  end_date: string;
  description: string;
  motivo?: string;
  what_happened?: string;
  why_happened?: string;
  participants?: string[];
  political_impact?: string;
  electoral_impact?: string;
  aftermath?: string;
  keywords?: string[];
  relevance_score: number;
  publications_count: number;
  distinct_outlets: number;
  coverage_days?: number;
  news_count: number;
  videos_count: number;
  posts_count: number;
  estimated_volume: number;
  sentiment_positive: number;
  sentiment_negative: number;
  sentiment_neutral: number;
  sources_count?: number;
}

interface ExternalTimelinePoint {
  date: string; total: number; news: number; videos: number; posts: number;
}

interface HistoricalResponse {
  events: HistoricalEvent[];
  publications_collected: number;
  estimated_reach?: number;
  external_timeline?: ExternalTimelinePoint[];
}

const typeIcon: Record<string, JSX.Element> = {
  eleicao: <Vote className="h-4 w-4" />,
  votacao: <Vote className="h-4 w-4" />,
  cpi: <Landmark className="h-4 w-4" />,
  decisao_judicial: <Gavel className="h-4 w-4" />,
  operacao: <Gavel className="h-4 w-4" />,
  debate: <Mic className="h-4 w-4" />,
  entrevista: <Mic className="h-4 w-4" />,
  discurso: <Mic className="h-4 w-4" />,
  coletiva: <Mic className="h-4 w-4" />,
  agenda: <CalendarDays className="h-4 w-4" />,
  noticia: <Newspaper className="h-4 w-4" />,
};

function formatDate(date: string): string {
  try { return new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return date; }
}
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const YEAR_PRESETS = [
  { label: "Eleição 2018", start: "2018-01-01", end: "2018-12-31" },
  { label: "Mandato 2019-2022", start: "2019-01-01", end: "2022-12-31" },
  { label: "Eleição 2022", start: "2022-01-01", end: "2022-12-31" },
  { label: "Mandato 2023-2026", start: "2023-01-01", end: "2026-12-31" },
  { label: "Eleição 2024", start: "2024-01-01", end: "2024-12-31" },
  { label: "Eleição 2026", start: "2026-01-01", end: "2026-12-31" },
];

export default function EventReport() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("");
  const [startDate, setStartDate] = useState("2022-01-01");
  const [endDate, setEndDate] = useState("2022-12-31");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: candidates } = useQuery({
    queryKey: ["candidates-mine", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates").select("id, full_name, party")
        .eq("user_id", user!.id).order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["external-peaks", candidateId, startDate, endDate],
    queryFn: async (): Promise<HistoricalResponse> => {
      const { data, error } = await supabase.functions.invoke("detect-historical-peaks", {
        body: { candidateId, startDate, endDate },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as HistoricalResponse;
    },
    enabled: false,
  });

  const events = useMemo(() => data?.events || [], [data]);
  const timeline = useMemo(() => data?.external_timeline || [], [data]);

  const handleSearch = () => {
    if (!candidateId) { toast.error("Selecione um candidato"); return; }
    if (!startDate || !endDate || new Date(startDate) > new Date(endDate)) {
      toast.error("Período inválido"); return;
    }
    refetch();
  };

  return (
    <div className="space-y-6 p-2 md:p-4">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-7 w-7 text-primary" /> Picos de Menções
        </h1>
        <p className="text-muted-foreground text-sm">
          Detecção de picos a partir do volume real coletado na internet — notícias, vídeos e posts em Google News, YouTube, TikTok, X, Facebook, Instagram, Telegram, Bluesky, portais e sites governamentais. Sem dependência de registros internos.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pesquisar picos</CardTitle>
          <CardDescription>Escolha o candidato e o período. Os picos são calculados a partir do volume externo encontrado nas fontes coletadas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Candidato</label>
              <Select value={candidateId} onValueChange={setCandidateId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {candidates?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name}{c.party ? ` (${c.party})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Início</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fim</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {YEAR_PRESETS.map((p) => (
              <Button key={p.label} variant="outline" size="sm"
                onClick={() => { setStartDate(p.start); setEndDate(p.end); }}>
                {p.label}
              </Button>
            ))}
          </div>
          <Button onClick={handleSearch} disabled={isFetching || !candidateId} className="w-full md:w-auto">
            {isFetching ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Pesquisando volume externo...</> : "Detectar picos"}
          </Button>
          {error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : null}
        </CardContent>
      </Card>

      {isFetching ? (
        <Card><CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Coletando publicações externas em portais, redes e plataformas de vídeo...</p>
        </CardContent></Card>
      ) : null}

      {!isFetching && data && events.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground space-y-2">
          <Newspaper className="h-10 w-10 mx-auto opacity-50" />
          <p className="font-medium">Nenhum pico externo identificado no período.</p>
          <p className="text-sm">Tente ampliar o intervalo ou selecionar outro candidato. A detecção exige volume real em fontes externas.</p>
        </CardContent></Card>
      ) : null}

      {timeline.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Volume externo agregado</CardTitle>
            <CardDescription>Publicações encontradas por dia em fontes externas — notícias, vídeos e posts.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline}>
                <defs>
                  <linearGradient id="gNews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                <Area type="monotone" dataKey="news" stackId="1" stroke="hsl(var(--primary))" fill="url(#gNews)" name="Notícias" />
                <Area type="monotone" dataKey="videos" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.35} name="Vídeos" />
                <Area type="monotone" dataKey="posts" stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.35} name="Posts" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}

      {events.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Picos detectados ({events.length})</h2>
          {events.sort((a, b) => a.start_date.localeCompare(b.start_date)).map((ev, idx) => {
            const key = `${idx}-${ev.start_date}`;
            const isOpen = !!expanded[key];
            const icon = typeIcon[ev.type] || <Newspaper className="h-4 w-4" />;
            return (
              <Card key={key} className="border-l-4 border-l-primary/60">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" />
                        <span>{formatDate(ev.start_date)}{ev.end_date && ev.end_date !== ev.start_date ? ` → ${formatDate(ev.end_date)}` : ""}</span>
                      </div>
                      <CardTitle className="text-base md:text-lg leading-snug flex items-start gap-2">
                        <span className="text-primary mt-0.5">{icon}</span>
                        <span>{ev.name}</span>
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  {/* Volume estimado */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="text-[11px] uppercase text-muted-foreground">Repercussão estimada</div>
                      <div className="text-xl font-bold">{formatNumber(ev.estimated_volume)}</div>
                      <div className="text-[11px] text-muted-foreground">citações</div>
                    </div>
                    <div className="rounded-md border p-3 flex items-start gap-2">
                      <Newspaper className="h-4 w-4 text-primary mt-0.5" />
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Notícias</div>
                        <div className="text-xl font-bold">{formatNumber(ev.news_count)}</div>
                      </div>
                    </div>
                    <div className="rounded-md border p-3 flex items-start gap-2">
                      <Video className="h-4 w-4 text-red-500 mt-0.5" />
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Vídeos</div>
                        <div className="text-xl font-bold">{formatNumber(ev.videos_count)}</div>
                      </div>
                    </div>
                    <div className="rounded-md border p-3 flex items-start gap-2">
                      <MessageSquare className="h-4 w-4 text-green-600 mt-0.5" />
                      <div>
                        <div className="text-[11px] uppercase text-muted-foreground">Posts</div>
                        <div className="text-xl font-bold">{formatNumber(ev.posts_count)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Sentimento agregado */}
                  <div>
                    <div className="text-[11px] uppercase text-muted-foreground mb-1.5">Sentimento agregado</div>
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
                      <div className="bg-green-500" style={{ width: `${ev.sentiment_positive}%` }} />
                      <div className="bg-zinc-400" style={{ width: `${ev.sentiment_neutral}%` }} />
                      <div className="bg-red-500" style={{ width: `${ev.sentiment_negative}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                      <span className="text-green-600">{ev.sentiment_positive}% positivo</span>
                      <span>{ev.sentiment_neutral}% neutro</span>
                      <span className="text-red-600">{ev.sentiment_negative}% negativo</span>
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed">{ev.description}</p>

                  {ev.sources.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Veículos que repercutiram ({ev.distinct_outlets})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(new Set(ev.sources.map((s) => s.name))).slice(0, 12).map((name) => (
                          <Badge key={name} variant="outline" className="text-[11px]">{name}</Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <Button variant="ghost" size="sm" className="gap-2"
                    onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}>
                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {isOpen ? "Recolher análise IA" : "Análise IA do pico"}
                  </Button>

                  {isOpen ? (
                    <div className="space-y-4 pt-2 border-t">
                      {ev.what_happened ? <Section title="O que aconteceu" body={ev.what_happened} /> : null}
                      {ev.why_happened ? <Section title="Por que gerou repercussão" body={ev.why_happened} /> : null}
                      {ev.participants && ev.participants.length > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Quem participou</p>
                          <div className="flex flex-wrap gap-1.5">
                            {ev.participants.map((p, i) => <Badge key={i} variant="secondary">{p}</Badge>)}
                          </div>
                        </div>
                      ) : null}
                      {ev.political_impact ? <Section title="Impacto político" body={ev.political_impact} /> : null}
                      {ev.electoral_impact ? <Section title="Impacto eleitoral" body={ev.electoral_impact} /> : null}
                      {ev.aftermath ? <Section title="Desdobramentos" body={ev.aftermath} /> : null}

                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Fontes ({ev.sources.length})</p>
                        <ul className="space-y-1.5">
                          {ev.sources.slice(0, 30).map((s, i) => (
                            <li key={i} className="text-sm flex items-start gap-2">
                              <ExternalLink className="h-3.5 w-3.5 mt-1 text-muted-foreground flex-shrink-0" />
                              <a href={s.url} target="_blank" rel="noreferrer"
                                className="hover:underline text-primary line-clamp-2">
                                <span className="font-medium">{s.name}</span>
                                {s.kind ? <span className="text-[10px] uppercase ml-1 text-muted-foreground">[{s.kind}]</span> : null}
                                {s.title ? <span className="text-muted-foreground"> — {s.title}</span> : null}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{title}</p>
      <p className="text-sm leading-relaxed">{body}</p>
    </div>
  );
}
