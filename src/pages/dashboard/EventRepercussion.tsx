import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Radio, RefreshCw, Sparkles } from "lucide-react";
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
  const [rangeDays, setRangeDays] = useState(7);
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
        .select("id, event_name, event_type, event_date, description, keywords, metadata")
        .eq("candidate_id", candidateId)
        .order("event_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!candidateId,
  });

  const detectMutation = useMutation({
    mutationFn: async () => {
      setDetectProgress(15); setDetectStep("Buscando fontes");
      const timers: number[] = [];
      timers.push(window.setTimeout(() => { setDetectProgress(40); setDetectStep("Extraindo entrevistas"); }, 1200));
      timers.push(window.setTimeout(() => { setDetectProgress(65); setDetectStep("Agrupando eventos semelhantes"); }, 3000));
      timers.push(window.setTimeout(() => { setDetectProgress(85); setDetectStep("Finalizando"); }, 5200));
      try {
        const { data, error } = await supabase.functions.invoke("detect-candidate-events", {
          body: { candidateId, monthsBack: 3 },
        });
        if (error) throw error;
        return data;
      } finally {
        timers.forEach(clearTimeout);
        setDetectProgress(100); setDetectStep("Concluído");
      }
    },
    onSuccess: async (data: any) => {
      const count = data?.events?.length || 0;
      toast({
        title: count > 0 ? "Eventos detectados" : "Nenhum evento encontrado",
        description: count > 0 ? `${count} evento(s) identificados e salvos.` : "Tente novamente ou aumente a janela de coleta.",
      });
      const res = await refetchEvents();
      const list = res.data || [];
      if (list.length === 1) setSelectedEvent(list[0].id);
      setTimeout(() => { setDetectProgress(0); setDetectStep(""); }, 800);
    },
    onError: (e: any) => {
      setDetectProgress(0); setDetectStep("");
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  // Auto-select when list contains a single event
  useEffect(() => {
    if (!selectedEvent && events && events.length === 1) setSelectedEvent(events[0].id);
  }, [events, selectedEvent]);

  const { data: analysis, isLoading: analysisLoading } = useEventRepercussion(selectedEvent, rangeDays);

  const selectedEventObj = useMemo(() => events?.find((e) => e.id === selectedEvent), [events, selectedEvent]);

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" />
            Repercussão por Região
          </h1>
          <p className="text-sm text-muted-foreground">Detecte eventos do candidato e veja como cada região do Brasil reagiu.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={candidateId} onValueChange={(v) => { setCandidateId(v); setSelectedEvent(null); }}>
            <SelectTrigger className="w-[240px] bg-card/40 border-border/60"><SelectValue placeholder="Selecionar candidato" /></SelectTrigger>
            <SelectContent>
              {candidates?.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v))}>
            <SelectTrigger className="w-[140px] bg-card/40 border-border/60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">24 horas</SelectItem>
              <SelectItem value="2">48 horas</SelectItem>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => detectMutation.mutate()} disabled={!candidateId || detectMutation.isPending} variant="outline">
            {detectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Detectar eventos
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <div>
          <EventSelectorList
            events={events || []}
            loading={eventsLoading}
            selectedId={selectedEvent}
            onSelect={(id) => { setSelectedEvent(id); setSelectedRegion(null); }}
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
              <Skeleton className="h-[280px] rounded-lg" />
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Analisando comentários reais por região do Brasil...</span>
              </div>
            </div>
          )}

          {selectedEvent && analysis && (
            <>
              <Card className="bg-card/40 border-border/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{analysis.event.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {new Date(analysis.event.date).toLocaleString("pt-BR")} • {analysis.totals.mentions.toLocaleString("pt-BR")} menções • {analysis.totals.coverage}% mapeadas geograficamente
                  </p>
                </CardHeader>
                {analysis.insights.aiSummary && (
                  <CardContent className="pt-0">
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                      <p className="text-sm leading-relaxed flex gap-2">
                        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span>{analysis.insights.aiSummary}</span>
                      </p>
                    </div>
                  </CardContent>
                )}
              </Card>

              <RepercussionInsightCards data={analysis} />
              <RegionalSentimentMap data={analysis} selected={selectedRegion} onSelect={setSelectedRegion} />

              {selectedRegion && analysis.regions[selectedRegion] && (
                <Card className="bg-card/40 border-border/40">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Detalhe: {selectedRegion}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Palavras mais citadas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.regions[selectedRegion].topWords.map((w) => (
                          <span key={w} className="text-xs bg-background/60 border border-border/40 rounded-full px-2.5 py-1">{w}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Comentários relevantes</p>
                      <div className="space-y-2">
                        {analysis.regions[selectedRegion].topComments.map((c, i) => (
                          <div key={i} className="text-sm bg-background/40 border border-border/40 rounded-lg p-3">
                            <p className="leading-snug">{c.text}</p>
                            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                              <span>{c.network}</span>
                              <span>•</span>
                              <span className={c.sentiment === "Positivo" ? "text-green-400" : c.sentiment === "Negativo" ? "text-red-400" : ""}>{c.sentiment || "—"}</span>
                              <span>•</span>
                              <span>{c.likes} curtidas</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <RepercussionTimeline data={analysis} />
              <RegionalChat eventId={analysis.event.id} region={selectedRegion} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
