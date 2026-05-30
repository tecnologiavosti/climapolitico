import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Radio, Sparkles, ExternalLink, Globe2, Newspaper, MessageSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EventSelectorList } from "@/components/dashboard/repercussion/EventSelectorList";
import { RepercussionInsightCards } from "@/components/dashboard/repercussion/RepercussionInsightCards";
import { RegionalSentimentMap } from "@/components/dashboard/repercussion/RegionalSentimentMap";
import { RepercussionTimeline } from "@/components/dashboard/repercussion/RepercussionTimeline";
import { RegionalChat } from "@/components/dashboard/repercussion/RegionalChat";
import { useEventRepercussion } from "@/hooks/useEventRepercussion";

export default function EventRepercussion() {
  const { user } = useAuth();
  const [candidateId, setCandidateId] = useState<string>("");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [detectProgress, setDetectProgress] = useState(0);
  const [detectStep, setDetectStep] = useState<string>("");

  const { data: candidates } = useQuery({
    queryKey: ["candidates-min", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("candidates").select("id, full_name").eq("status", "active").order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!candidateId && candidates && candidates.length) setCandidateId(candidates[0].id);
  }, [candidates, candidateId]);

  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } = useQuery({
    queryKey: ["political-events", candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("political_events")
        .select("id, event_name, event_type, event_date, description, keywords, metadata, low_coverage, confidence_score, importance_score, distinct_outlets, publications_count, themes, narratives")
        .eq("candidate_id", candidateId)
        .eq("low_coverage", false)
        .gte("publications_count", 3)
        .order("event_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!candidateId,
  });

  const detectMutation = useMutation({
    mutationFn: async () => {
      setDetectProgress(8); setDetectStep("Buscando fontes externas (Google News, GDELT, YouTube)");
      const timers: number[] = [];
      timers.push(window.setTimeout(() => { setDetectProgress(28); setDetectStep("Coletando publicações de CNN, G1, Folha, Metrópoles…"); }, 1200));
      timers.push(window.setTimeout(() => { setDetectProgress(50); setDetectStep("Identificando acontecimentos reais"); }, 3000));
      timers.push(window.setTimeout(() => { setDetectProgress(72); setDetectStep("Agrupando fontes por evento"); }, 5200));
      timers.push(window.setTimeout(() => { setDetectProgress(88); setDetectStep("Calculando alcance e distribuição regional"); }, 7400));
      try {
        const { data, error } = await supabase.functions.invoke("detect-candidate-events", {
          body: { candidateId, monthsBack: 1 },
        });
        if (error) throw error;
        return data;
      } finally {
        timers.forEach(clearTimeout);
        setDetectProgress(100); setDetectStep("Finalizando");
      }
    },
    onSuccess: async (data: any) => {
      const count = data?.events?.length || 0;
      toast({
        title: count > 0 ? `${count} acontecimento(s) identificado(s)` : "Nenhum evento encontrado",
        description: count > 0
          ? `Coletadas ${data?.publications_collected || 0} publicações externas (Firecrawl + GDELT).`
          : "Nenhuma publicação externa relevante no período. Tente novamente em alguns minutos.",
      });
      const res = await refetchEvents();
      const list = res.data || [];
      const first = list.sort((a: any, b: any) => (b.metadata?.importance_score || 0) - (a.metadata?.importance_score || 0))[0];
      if (first) setSelectedEvent(first.id);
      setTimeout(() => { setDetectProgress(0); setDetectStep(""); }, 800);
    },
    onError: (e: any) => {
      setDetectProgress(0); setDetectStep("");
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!selectedEvent && events && events.length === 1) setSelectedEvent(events[0].id);
  }, [events, selectedEvent]);

  const { data: analysis, isLoading: analysisLoading } = useEventRepercussion(selectedEvent);

  const filteredSources = useMemo(() => {
    if (!analysis) return [];
    const all = analysis.externalRepercussion.sources || [];
    return selectedRegion ? all.filter((s) => s.region === selectedRegion) : all;
  }, [analysis, selectedRegion]);

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto w-full min-w-0">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Radio className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
            <span className="truncate">Repercussão por Região</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Acompanhamento de repercussão externa (mídia, web, redes) de acontecimentos políticos.</p>
        </div>
        <div className="grid grid-cols-2 md:flex md:items-center gap-2 md:flex-wrap">
          <Select value={candidateId} onValueChange={(v) => { setCandidateId(v); setSelectedEvent(null); }}>
            <SelectTrigger className="w-full md:w-[240px] bg-card/40 border-border/60"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>{candidates?.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
          </Select>
          {/* Seletor de período removido: análise sempre considera os eventos mais recentes detectados */}
          <Button onClick={() => detectMutation.mutate()} disabled={!candidateId || detectMutation.isPending} variant="outline" className="col-span-2 md:col-auto w-full md:w-auto">
            {detectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Detectar eventos
          </Button>
        </div>
      </div>

      {detectMutation.isPending && (
        <Card className="bg-card/40 border-border/40">
          <CardContent className="py-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="flex items-center gap-2 text-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Detectando eventos… <span className="text-muted-foreground">{detectStep}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">{detectProgress}%</span>
            </div>
            <div className="h-1.5 w-full bg-background/60 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500" style={{ width: `${detectProgress}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <div>
          <EventSelectorList
            events={events || []}
            loading={eventsLoading || detectMutation.isPending}
            selectedId={selectedEvent}
            onSelect={(id) => { setSelectedEvent(id); setSelectedRegion(null); }}
            onRetry={() => detectMutation.mutate()}
            retrying={detectMutation.isPending}
          />
        </div>

        <div className="space-y-4 min-w-0">
          {!selectedEvent && (
            <Card className="bg-card/40 border-border/40">
              <CardContent className="py-16 text-center">
                <Radio className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Selecione um evento na lista ao lado, ou clique em "Detectar eventos" para identificá-los automaticamente.</p>
              </CardContent>
            </Card>
          )}

          {selectedEvent && analysisLoading && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
              </div>
              <Skeleton className="h-[400px] rounded-lg" />
              <Skeleton className="h-[240px] rounded-lg" />
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Coletando publicações externas e calculando repercussão nacional…</span>
              </div>
            </div>
          )}

          {selectedEvent && analysis && (
            <>
              {/* Event header */}
              <Card className="bg-card/40 border-border/40">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-lg">{analysis.event.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(analysis.event.date).toLocaleString("pt-BR")}
                        {analysis.event.location && <> • {analysis.event.location}</>}
                        {analysis.event.importanceScore != null && <> • Importância {analysis.event.importanceScore}/100</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {analysis.confidence && (
                        <Badge variant="outline" className={
                          analysis.confidence.level === "Alta" ? "border-green-500/40 text-green-300"
                          : analysis.confidence.level === "Média" ? "border-amber-500/40 text-amber-200"
                          : "border-red-500/40 text-red-300"
                        }>Confiança: {analysis.confidence.level}</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {analysis.event.description && (
                  <CardContent className="pt-0">
                    <p className="text-sm text-foreground/80 leading-relaxed">{analysis.event.description}</p>
                  </CardContent>
                )}
              </Card>

              {/* External repercussion KPI cards */}
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Globe2 className="h-3.5 w-3.5" /> Repercussão externa (mídia + web)
              </div>
              <RepercussionInsightCards data={analysis} />

              {/* Sentiment signals bar */}
              <Card className="bg-card/40 border-border/40">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Tom geral das publicações</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex h-3 rounded-full overflow-hidden">
                    <div className="bg-green-500/70" style={{ width: `${analysis.externalRepercussion.positiveSignals}%` }} title={`Positivo ${analysis.externalRepercussion.positiveSignals}%`} />
                    <div className="bg-amber-500/70" style={{ width: `${analysis.externalRepercussion.neutralSignals}%` }} title={`Neutro ${analysis.externalRepercussion.neutralSignals}%`} />
                    <div className="bg-red-500/70" style={{ width: `${analysis.externalRepercussion.negativeSignals}%` }} title={`Negativo ${analysis.externalRepercussion.negativeSignals}%`} />
                  </div>
                  <div className="flex justify-between mt-2 text-[11px] text-muted-foreground">
                    <span className="text-green-400">Positivo {analysis.externalRepercussion.positiveSignals}%</span>
                    <span className="text-amber-300">Neutro {analysis.externalRepercussion.neutralSignals}%</span>
                    <span className="text-red-400">Negativo {analysis.externalRepercussion.negativeSignals}%</span>
                  </div>
                </CardContent>
              </Card>

              {/* Map */}
              <RegionalSentimentMap data={analysis} selected={selectedRegion} onSelect={setSelectedRegion} />

              {/* Topics + Narratives */}
              <div className="grid lg:grid-cols-2 gap-4">
                <Card className="bg-card/40 border-border/40">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Temas dominantes</CardTitle></CardHeader>
                  <CardContent>
                    {analysis.externalRepercussion.majorTopics.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum tema identificado.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.externalRepercussion.majorTopics.map((t) => (
                          <span key={t} className="text-xs bg-background/60 border border-border/40 rounded-full px-2.5 py-1">{t}</span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card className="bg-card/40 border-border/40">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Narrativas detectadas</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {(["apoio", "criticas", "debates"] as const).map((k) => {
                      const items = analysis.externalRepercussion.narratives[k] || [];
                      if (!items.length) return null;
                      const label = k === "apoio" ? "Apoio" : k === "criticas" ? "Críticas" : "Debates";
                      const color = k === "apoio" ? "text-green-400" : k === "criticas" ? "text-red-400" : "text-amber-300";
                      return (
                        <div key={k}>
                          <p className={`text-[11px] uppercase tracking-wide font-semibold ${color} mb-1`}>{label}</p>
                          <ul className="space-y-1">
                            {items.map((s, i) => <li key={i} className="text-xs text-foreground/85 leading-snug">• {s}</li>)}
                          </ul>
                        </div>
                      );
                    })}
                    {Object.values(analysis.externalRepercussion.narratives).every((arr) => arr.length === 0) && (
                      <p className="text-xs text-muted-foreground">Nenhuma narrativa identificada nas publicações.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Sources list */}
              <Card className="bg-card/40 border-border/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Newspaper className="h-4 w-4" />
                    Fontes coletadas {selectedRegion && <Badge variant="outline" className="text-[10px]">Filtro: {selectedRegion}</Badge>}
                    <span className="text-xs text-muted-foreground font-normal">({filteredSources.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {filteredSources.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma publicação para o filtro atual.</p>
                  ) : (
                    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                      {filteredSources.slice(0, 30).map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="block p-2.5 rounded-md border border-border/40 bg-background/30 hover:border-primary/40 transition">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">{s.title}</p>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                            <span className="font-medium">{s.outlet}</span>
                            <span>•</span>
                            <span>{s.region}</span>
                            {s.publishedAt && (<><span>•</span><span>{new Date(s.publishedAt).toLocaleDateString("pt-BR")}</span></>)}
                          </div>
                          {s.snippet && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{s.snippet}</p>}
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Timeline */}
              <RepercussionTimeline data={analysis} />

              {/* Internal reaction (complement) */}
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground pt-2">
                <MessageSquare className="h-3.5 w-3.5" /> Reação da plataforma (complemento)
              </div>
              <Card className="bg-card/40 border-border/40">
                <CardContent className="p-4">
                  {analysis.internalReaction.mentions === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum comentário interno relacionado a este evento foi encontrado na janela analisada.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-4 gap-3 text-center">
                        <div><p className="text-xl font-bold">{analysis.internalReaction.mentions.toLocaleString("pt-BR")}</p><p className="text-[11px] text-muted-foreground">Menções</p></div>
                        <div><p className="text-xl font-bold text-green-400">{analysis.internalReaction.positive}</p><p className="text-[11px] text-muted-foreground">Positivos</p></div>
                        <div><p className="text-xl font-bold text-red-400">{analysis.internalReaction.negative}</p><p className="text-[11px] text-muted-foreground">Negativos</p></div>
                        <div><p className="text-xl font-bold">{analysis.internalReaction.engagement.toLocaleString("pt-BR")}</p><p className="text-[11px] text-muted-foreground">Engajamento</p></div>
                      </div>
                      {analysis.internalReaction.sample.length > 0 && (
                        <div className="space-y-1.5">
                          {analysis.internalReaction.sample.slice(0, 4).map((c, i) => (
                            <div key={i} className="text-xs bg-background/40 border border-border/40 rounded p-2">
                              <p className="leading-snug">{c.text}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{c.network} • {c.sentiment} • {c.likes} curtidas</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* AI chat */}
              <RegionalChat eventId={analysis.event.id} region={selectedRegion} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
