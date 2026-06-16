import { useState, useEffect } from "react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageCircle, Ban, Megaphone, Shield, Sparkles, Target, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface TopicToAvoid {
  topic: string;
  reason: string;
  urgency: 'imediata' | 'alta' | 'moderada';
}

interface TopicToReinforce {
  topic: string;
  reason: string;
  suggested_approach: string;
}

interface ResponseToCriticism {
  criticism: string;
  suggested_response: string;
  tone: 'firme' | 'conciliador' | 'educativo' | 'empático';
}

interface CommunicationAction {
  action: string;
  channel: string;
  priority: 'critica' | 'alta' | 'media' | 'baixa';
  expected_impact: string;
}

interface NarrativeRecommendations {
  situation_summary: string;
  topics_to_avoid: TopicToAvoid[];
  topics_to_reinforce: TopicToReinforce[];
  responses_to_criticism: ResponseToCriticism[];
  communication_plan: CommunicationAction[];
  key_message: string;
}

interface RecommendationResult {
  recommendations: NarrativeRecommendations | null;
  message?: string;
  error?: string;
  fallback?: boolean;
  ai_provider?: string;
  stats?: { total: number; positive: number; negative: number; neutral: number };
  candidate?: { full_name: string; party: string; region: string };
  period?: { daysBack: number; startDate: string; endDate: string };
}

const PERIOD_OPTIONS = [
  { value: "1", label: "Últimas 24 horas" },
  { value: "3", label: "Últimos 3 dias" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "14", label: "Últimos 14 dias" },
  { value: "30", label: "Últimos 30 dias" },
];

const urgencyConfig: Record<string, string> = {
  imediata: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  alta: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  moderada: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

const priorityConfig: Record<string, { class: string; label: string }> = {
  critica: { class: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", label: "Crítica" },
  alta: { class: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300", label: "Alta" },
  media: { class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", label: "Média" },
  baixa: { class: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", label: "Baixa" },
};

const toneConfig: Record<string, { class: string; label: string }> = {
  firme: { class: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300", label: "Firme" },
  conciliador: { class: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300", label: "Conciliador" },
  educativo: { class: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", label: "Educativo" },
  empático: { class: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300", label: "Empático" },
};

const NarrativeRecommendationsPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("7");
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) { setSlowLoading(false); return; }
    const t = setTimeout(() => setSlowLoading(true), 3000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const { data: candidates = [] } = useQuery({
    queryKey: ['candidates-for-narrative', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name, party')
        .order('full_name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleGenerate = async () => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    setIsLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-narrative-recommendations', {
        body: { candidateId: selectedCandidate, daysBack: parseInt(selectedPeriod) },
      });
      if (error) throw error;

      const payload = data as RecommendationResult;
      setResult(payload);

      if (payload.fallback || payload.error) {
        toast.error(payload.message || "Serviço de IA temporariamente indisponível.");
      } else if (!payload.recommendations) {
        toast.info(payload.message || "Nenhum comentário encontrado.");
      } else {
        toast.success("Recomendações geradas com sucesso!");
      }
    } catch (err: any) {
      console.error('Error:', err);
      toast.error(err.message || "Erro ao gerar recomendações");
    } finally {
      setIsLoading(false);
    }
  };

  const rec = result?.recommendations;

  return (
    <div className="space-y-6">
      <div>
        <HelpTooltip text="Aqui a IA te dá ideias de fala e postura pro seu candidato, baseadas no que o povo está comentando.">
        <h1 className="text-3xl font-bold">Recomendações de Narrativa</h1>
      </HelpTooltip>
        <p className="text-muted-foreground mt-1">
          Orientações práticas de comunicação baseadas nos comentários reais coletados.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-row flex-wrap gap-3 items-end">
            <HelpTooltip text="Escolha pra qual candidato você quer receber as dicas de comunicação.">
              <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
                <SelectTrigger className="w-[160px] sm:w-[280px]">
                  <SelectValue placeholder="Selecione um candidato" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}{c.party ? ` (${c.party})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </HelpTooltip>

            <HelpTooltip text="De quantos dias atrás a IA vai considerar os comentários.">
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-[120px] sm:w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </HelpTooltip>

            <HelpTooltip text="Clica aqui pra IA gerar dicas de o que falar e como agir nos próximos dias.">
              <Button onClick={handleGenerate} disabled={isLoading || !selectedCandidate}>
                {isLoading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" />Gerar Recomendações</>
                )}
              </Button>
            </HelpTooltip>
          </div>
        </CardContent>
      </Card>

      {/* No data / fallback */}
      {result && !rec && (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {result.fallback ? "Serviço temporariamente indisponível" : "Sem dados suficientes"}
            </h3>
            <p className="text-muted-foreground">{result.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {rec && (
        <div className="space-y-6">
          {/* Key Message */}
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="pt-6">
              <HelpTooltip text="A frase principal que seu candidato deveria estar repetindo agora pra conquistar o povo.">
                <div className="flex items-start gap-3">
                  <Target className="h-6 w-6 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-primary mb-1">Mensagem-Chave</p>
                    <p className="text-lg font-semibold text-foreground">{rec.key_message}</p>
                  </div>
                </div>
              </HelpTooltip>
            </CardContent>
          </Card>

          {/* Situation Summary */}
          <Card>
            <CardHeader>
              <HelpTooltip text="Resumão de como está a situação do seu candidato hoje, em poucas linhas.">
                <CardTitle>Diagnóstico da Situação</CardTitle>
              </HelpTooltip>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">{rec.situation_summary}</p>
              {result.stats && (
                <div className="flex gap-4 mt-4 text-sm">
                  <span className="text-green-600 dark:text-green-400">✅ {result.stats.positive} positivos</span>
                  <span className="text-red-600 dark:text-red-400">❌ {result.stats.negative} negativos</span>
                  <span className="text-muted-foreground">⚪ {result.stats.neutral} neutros</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Topics to Avoid */}
          <Card className="border-destructive/30">
            <CardHeader>
              <HelpTooltip text="Assuntos que seu candidato deve EVITAR falar nos próximos dias.">
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <Ban className="h-5 w-5" />
                  Temas a Evitar
                </CardTitle>
              </HelpTooltip>
              <CardDescription>Assuntos que devem ser evitados nas próximas falas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rec.topics_to_avoid.map((item, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold text-foreground">{item.topic}</h4>
                      <Badge variant="outline" className={urgencyConfig[item.urgency]}>
                        {item.urgency}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.reason}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Topics to Reinforce */}
          <Card className="border-green-500/30">
            <CardHeader>
              <HelpTooltip text="Assuntos que seu candidato DEVE falar mais, porque o povo está gostando.">
                <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Megaphone className="h-5 w-5" />
                  Temas a Reforçar
                </CardTitle>
              </HelpTooltip>
              <CardDescription>Narrativas que devem ser amplificadas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rec.topics_to_reinforce.map((item, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <h4 className="font-semibold text-foreground mb-1">{item.topic}</h4>
                    <p className="text-sm text-muted-foreground mb-2">{item.reason}</p>
                    <div className="flex items-start gap-2 bg-muted/50 rounded p-2">
                      <ArrowRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-foreground">{item.suggested_approach}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Responses to Criticism */}
          <Card>
            <CardHeader>
              <HelpTooltip text="Respostas prontas pras críticas que mais aparecem nos comentários.">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Respostas a Críticas
                </CardTitle>
              </HelpTooltip>
              <CardDescription>Como endereçar as críticas mais recorrentes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rec.responses_to_criticism.map((item, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-destructive">Crítica:</span>
                      <span className="text-sm text-foreground">{item.criticism}</span>
                    </div>
                    <div className="bg-muted/50 rounded p-3 mb-2">
                      <p className="text-sm text-foreground">{item.suggested_response}</p>
                    </div>
                    <Badge variant="outline" className={toneConfig[item.tone]?.class}>
                      Tom: {toneConfig[item.tone]?.label || item.tone}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Communication Plan */}
          <Card className="border-primary/30">
            <CardHeader>
              <HelpTooltip text="Lista de coisas pra fazer agora, em ordem do que dá mais resultado.">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Target className="h-5 w-5" />
                  Plano de Comunicação
                </CardTitle>
              </HelpTooltip>
              <CardDescription>Ações concretas priorizadas por impacto</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rec.communication_plan.map((item, i) => {
                  const prio = priorityConfig[item.priority] || priorityConfig.media;
                  return (
                    <div key={i} className="border rounded-lg p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0">
                          {i + 1}
                        </span>
                        <h4 className="font-semibold text-foreground flex-1">{item.action}</h4>
                        <Badge variant="outline" className={prio.class}>
                          {prio.label}
                        </Badge>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 text-sm">
                        <span className="text-muted-foreground">📡 Canal: <strong className="text-foreground">{item.channel}</strong></span>
                        <span className="text-muted-foreground">📈 Impacto: {item.expected_impact}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default NarrativeRecommendationsPage;
