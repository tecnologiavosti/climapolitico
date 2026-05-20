import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useRealTimeAnalytics } from "@/hooks/useRealTimeAnalytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw, Radio, Clock } from "lucide-react";
// Componente temporariamente oculto (mantido para uso futuro)
// import { ConnectionStatus } from "@/components/dashboard/realtime/ConnectionStatus";
import { RealTimeKPIs } from "@/components/dashboard/realtime/RealTimeKPIs";
import { RealTimeSentimentChart } from "@/components/dashboard/realtime/RealTimeSentimentChart";
// Componente temporariamente oculto (mantido para uso futuro)
// import { RealTimeMentionsChart } from "@/components/dashboard/realtime/RealTimeMentionsChart";
import { RealTimeSentimentGauge } from "@/components/dashboard/realtime/RealTimeSentimentGauge";
import { RealTimeCommentsFeed } from "@/components/dashboard/realtime/RealTimeCommentsFeed";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface Candidate {
  id: string;
  full_name: string;
}

const RealTimeMonitor = () => {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const { metrics, comments, isLoading, error, refreshMetrics } = useRealTimeAnalytics(
    selectedCandidateId ? [selectedCandidateId] : [],
    60000 // 1 minute refresh
  );

  // Fetch candidates
  useEffect(() => {
    const fetchCandidates = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('full_name');

      if (!error && data) {
        setCandidates(data);
        if (data.length > 0 && !selectedCandidateId) {
          setSelectedCandidateId(data[0].id);
        }
      }
      setLoadingCandidates(false);
    };

    fetchCandidates();
  }, [user]);

  // Track last update time
  useEffect(() => {
    if (!isLoading && metrics) {
      setLastUpdate(new Date());
    }
  }, [metrics, isLoading]);

  const handleRefresh = async () => {
    await refreshMetrics();
    setLastUpdate(new Date());
  };

  const selectedCandidate = candidates.find(c => c.id === selectedCandidateId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-row justify-between items-center gap-3 flex-wrap">
        <div>
          <HelpTooltip text="Acompanhe os comentários chegando ao vivo, na hora em que o povo posta nas redes.">
        <h1 className="text-3xl font-bold flex items-center gap-2">
            <Radio className="h-8 w-8 text-primary" />
            Monitor de Comentários
          </h1>
      </HelpTooltip>
          <p className="text-muted-foreground mt-1">
            Acompanhe menções e sentimentos dos comentários coletados
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Indicador de última atualização */}
          <HelpTooltip text="Hora em que os dados foram atualizados pela última vez aqui na tela.">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-muted/50 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Atualizado: {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </HelpTooltip>

          <HelpTooltip text="Clica pra buscar os comentários mais novos agora mesmo.">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </HelpTooltip>
        </div>
      </div>

      {/* Candidate Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-row items-center gap-3 flex-wrap">
            <label className="text-sm font-medium">Monitorar candidato:</label>
            {loadingCandidates ? (
              <Skeleton className="h-10 w-64" />
            ) : (
              <HelpTooltip text="Escolha qual candidato você quer ficar de olho ao vivo.">
                <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
                  <SelectTrigger className="w-[180px] sm:w-64">
                    <SelectValue placeholder="Selecione um candidato" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </HelpTooltip>
            )}
            {selectedCandidate && (
              <span className="text-sm text-muted-foreground">
                Monitorando: <strong>{selectedCandidate.full_name}</strong>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedCandidateId ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Radio className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
            <h3 className="text-lg font-medium mb-2">Selecione um candidato</h3>
            <p className="text-muted-foreground">
              Escolha um candidato acima para visualizar os comentários coletados
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {error && (
            <Card className="border-destructive">
              <CardContent className="py-4">
                <p className="text-destructive text-sm">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* KPIs */}
          <RealTimeKPIs metrics={metrics} />

          {/* Charts Grid - apenas sentimento ao longo do tempo */}
          <div className="grid grid-cols-1 gap-6">
            <RealTimeSentimentChart metrics={metrics} />
          </div>

          {/* Gauge and Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <RealTimeSentimentGauge metrics={metrics} />
            <div className="lg:col-span-2">
              <RealTimeCommentsFeed comments={comments} />
            </div>
          </div>

          {/* Info footer */}
          <Card className="bg-muted/30">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>
                  Métricas atualizadas automaticamente a cada 1 minuto.
                  Dados baseados nas interações coletadas, incluindo Twitter/X.
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default RealTimeMonitor;
