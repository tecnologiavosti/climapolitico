import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, TrendingUp, Users, Activity } from "lucide-react";
import { brazilStates, getColorForScore, noDataColor } from "@/lib/brazilMapSvg";
import { StateOpportunityData, getDataQualityLabel, getScoreLabel } from "@/lib/opportunityCalculator";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface OpportunityMapProps {
  candidateId?: string;
}

export const OpportunityMap = ({ candidateId: initialCandidateId }: OpportunityMapProps) => {
  const [selectedCandidate, setSelectedCandidate] = useState<string>(initialCandidateId || "all");
  const [hoveredState, setHoveredState] = useState<StateOpportunityData | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const { data: candidates } = useQuery({
    queryKey: ["candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id, full_name")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: opportunityData, isLoading } = useQuery({
    queryKey: ["opportunity-map", selectedCandidate],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("calculate-opportunity-map", {
        body: { 
          candidateId: selectedCandidate === "all" ? undefined : selectedCandidate,
          daysBack: 30 
        },
      });
      if (error) throw error;
      return data;
    },
  });

  const handleMouseMove = (e: React.MouseEvent, stateData: StateOpportunityData) => {
    setHoveredState(stateData);
    setTooltipPosition({ x: e.clientX, y: e.clientY });
  };

  const handleMouseLeave = () => {
    setHoveredState(null);
  };

  const getStateColor = (stateCode: string): string => {
    if (!opportunityData?.states) return noDataColor;
    const stateData = opportunityData.states.find((s: StateOpportunityData) => s.stateCode === stateCode);
    if (!stateData || stateData.dataQuality === "none") return noDataColor;
    return getColorForScore(stateData.opportunityScore);
  };

  const getStateData = (stateCode: string): StateOpportunityData | undefined => {
    return opportunityData?.states?.find((s: StateOpportunityData) => s.stateCode === stateCode);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Mapa de Oportunidades por Região
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="w-full h-[500px]" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Mapa de Oportunidades por Região
        </CardTitle>
        <CardDescription>
          Estados com maior potencial de conversão de eleitores indecisos
        </CardDescription>
        <div className="flex gap-4 items-center mt-4">
          <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Selecionar candidato" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Candidatos</SelectItem>
              {candidates?.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {!opportunityData?.states || opportunityData.states.length === 0 ? (
          <Alert>
            <AlertDescription>
              Não há dados suficientes para gerar o mapa de oportunidades. Execute análises de candidatos e análises de indecisos para visualizar os dados.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="relative">
              <svg
                viewBox="0 0 600 650"
                className="w-full h-auto"
                style={{ maxHeight: "500px" }}
              >
                {brazilStates.map((state) => {
                  const stateData = getStateData(state.code);
                  return (
                    <path
                      key={state.code}
                      d={state.path}
                      fill={getStateColor(state.code)}
                      stroke="hsl(var(--border))"
                      strokeWidth="1"
                      className="transition-all duration-200 hover:opacity-80 cursor-pointer"
                      onMouseMove={(e) => stateData && handleMouseMove(e, stateData)}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
              </svg>

              {hoveredState && (
                <div
                  className="fixed z-50 pointer-events-none"
                  style={{
                    left: `${tooltipPosition.x + 10}px`,
                    top: `${tooltipPosition.y + 10}px`,
                  }}
                >
                  <Card className="w-[300px] shadow-lg">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{hoveredState.state}</CardTitle>
                      <CardDescription className="text-xs">
                        {getDataQualityLabel(hoveredState.dataQuality)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Score de Oportunidade:</span>
                        <span className="font-bold text-lg">{hoveredState.opportunityScore}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {getScoreLabel(hoveredState.opportunityScore)}
                      </div>
                      <div className="pt-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <Users className="h-3 w-3" />
                          <span className="text-xs">Indecisos: {hoveredState.undecidedPercentage.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Activity className="h-3 w-3" />
                          <span className="text-xs">Sentimento: {hoveredState.avgSentiment.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-3 w-3" />
                          <span className="text-xs">Menções: {hoveredState.totalMentions}</span>
                        </div>
                      </div>
                      {hoveredState.recommendedActions.length > 0 && (
                        <div className="pt-2 border-t">
                          <p className="text-xs font-semibold mb-1">Ações Recomendadas:</p>
                          <ul className="text-xs space-y-1">
                            {hoveredState.recommendedActions.slice(0, 2).map((action, idx) => (
                              <li key={idx} className="text-muted-foreground">• {action}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-semibold">Legenda:</span>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: "hsl(142, 76%, 36%)" }} />
                  <span className="text-xs">80-100: Alto</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: "hsl(78, 92%, 45%)" }} />
                  <span className="text-xs">60-79: Bom</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: "hsl(43, 96%, 56%)" }} />
                  <span className="text-xs">40-59: Médio</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: "hsl(25, 95%, 53%)" }} />
                  <span className="text-xs">20-39: Baixo</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: noDataColor }} />
                  <span className="text-xs">Sem Dados</span>
                </div>
              </div>

              {opportunityData.topStates && opportunityData.topStates.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Top 3 Estados de Oportunidade:</h4>
                  <div className="space-y-2">
                    {opportunityData.topStates.slice(0, 3).map((state: StateOpportunityData, idx: number) => (
                      <div key={state.stateCode} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                        <span>{idx + 1}. {state.state}</span>
                        <span className="font-bold">Score {state.opportunityScore} 📈</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
