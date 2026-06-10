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
  volume_available?: boolean;
  sentiment_available?: boolean;
  evidence_level?: string;
  sentiment_positive: number;
  sentiment_negative: number;
  sentiment_neutral: number;
  sources_count?: number;
  outlet_names?: string[];
  internal_mentions?: number;
  internal_authors?: number;
  internal_engagement?: number;
  internal_by_network?: Record<string, number>;
  internal_window_days?: number;
}

const NETWORK_LABEL: Record<string, string> = {
  youtube: "YouTube", twitter: "Twitter / X", telegram: "Telegram", tiktok: "TikTok",
  facebook: "Facebook", google_news: "Google News", reddit: "Reddit", bluesky: "Bluesky",
  linkedin: "LinkedIn", instagram: "Instagram", mastodon: "Mastodon", lemmy: "Lemmy",
  wikipedia: "Wikipedia", pinterest: "Pinterest", gdelt: "GDELT", "4chan": "4chan",
};

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
  // timeline retornado pelo backend não é exibido — foco em eventos relevantes.

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
          Inteligência política histórica. Detecta apenas acontecimentos com repercussão nacional documentada — crises, escândalos, operações, decisões do STF, CPIs, julgamentos, prisões, impeachments, eleições e debates. Comícios, agendas e visitas de rotina são automaticamente descartados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pesquisar picos</CardTitle>
          <CardDescription>Escolha o candidato e o período. A relevância é calculada a partir da diversidade de veículos, da duração da repercussão e do impacto político.</CardDescription>
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

      {/* Linha do tempo agregada removida — exibimos apenas acontecimentos com relevância política comprovada. */}

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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="text-[11px] uppercase text-muted-foreground">Citações</div>
                      <div className="text-xl font-bold">Indisponível</div>
                      <div className="text-[11px] text-muted-foreground">não estimamos volume</div>
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

                  <div>
                    <div className="text-[11px] uppercase text-muted-foreground mb-1.5">Sentimento agregado</div>
                    {ev.sentiment_available ? (
                      <>
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
                      </>
                    ) : (
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Dados insuficientes para análise de sentimento.
                      </div>
                    )}
                  </div>

                  <p className="text-sm leading-relaxed">{ev.description}</p>

                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                    Cobertura detectada em <span className="font-semibold text-foreground">{ev.distinct_outlets}</span> veículo{ev.distinct_outlets === 1 ? "" : "s"} · <span className="font-semibold text-foreground">{ev.publications_count}</span> evidência{ev.publications_count === 1 ? "" : "s"} externa{ev.publications_count === 1 ? "" : "s"}.
                  </div>

                  {(ev.internal_mentions ?? 0) > 0 ? (
                    <div className="rounded-md border bg-primary/5 px-3 py-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Repercussão observada nas redes monitoradas (±{ev.internal_window_days ?? 14}d)
                      </p>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-lg font-bold text-foreground">{formatNumber(ev.internal_mentions ?? 0)}</p>
                          <p className="text-[11px] text-muted-foreground">menções</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-foreground">{formatNumber(ev.internal_authors ?? 0)}</p>
                          <p className="text-[11px] text-muted-foreground">autores únicos</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-foreground">{formatNumber(ev.internal_engagement ?? 0)}</p>
                          <p className="text-[11px] text-muted-foreground">engajamento</p>
                        </div>
                      </div>
                      {ev.internal_by_network && Object.keys(ev.internal_by_network).length > 0 ? (
                        <div className="pt-2 border-t space-y-1.5">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Distribuição por rede</p>
                          {Object.entries(ev.internal_by_network)
                            .map(([n, v]) => [n, Number(v) || 0] as [string, number])
                            .sort((a, b) => b[1] - a[1])
                            .filter(([, v]) => v > 0)
                            .map(([net, v]) => {
                              const pct = Math.round((v / Math.max(1, ev.internal_mentions ?? 1)) * 100);
                              return (
                                <div key={net} className="flex items-center gap-2 text-xs">
                                  <span className="w-24 shrink-0 text-muted-foreground">{NETWORK_LABEL[net] ?? net}</span>
                                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                                  </div>
                                  <span className="w-20 text-right tabular-nums text-foreground">{formatNumber(v)} <span className="text-muted-foreground">({pct}%)</span></span>
                                </div>
                              );
                            })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {ev.outlet_names && ev.outlet_names.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Veículos que repercutiram</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ev.outlet_names.map((o, i) => (
                          <Badge key={`${key}-out-${i}`} variant="outline" className="font-normal">{o}</Badge>
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
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cobertura analisada</p>
                        <p className="text-sm text-muted-foreground">
                          Análise produzida a partir de <span className="font-semibold text-foreground">{ev.publications_count}</span> evidência{ev.publications_count === 1 ? "" : "s"} externa{ev.publications_count === 1 ? "" : "s"} em <span className="font-semibold text-foreground">{ev.distinct_outlets}</span> veículo{ev.distinct_outlets === 1 ? "" : "s"} distintos.
                        </p>
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
