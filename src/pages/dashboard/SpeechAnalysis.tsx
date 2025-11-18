import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mic, AlertTriangle, TrendingUp, Brain, Target, MessageSquare, Trash2 } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";

export default function SpeechAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminCheck();
  const { user } = useAuth();

  // FASE 2.3: Loading state defensivo
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando usuário...</p>
        </div>
      </div>
    );
  }
  
  const [speechTitle, setSpeechTitle] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [speechDate, setSpeechDate] = useState("");
  const [speechType, setSpeechType] = useState("discurso");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedAnalysis, setSelectedAnalysis] = useState<any>(null);

  // Fetch candidates with error handling
  const { data: candidates, isLoading: candidatesLoading, error: candidatesError } = useQuery({
    queryKey: ['candidates', isAdmin, user?.id],
    queryFn: async () => {
      try {
        let query = supabase
          .from('candidates')
          .select('id, full_name, region, party')
          .order('full_name');
        
        if (!isAdmin && user) {
          query = query.eq('user_id', user.id);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error('❌ Error fetching candidates:', error);
        throw error;
      }
    },
    enabled: !!user,
  });

  // Fetch speech analyses
  const { data: analyses, isLoading: analysesLoading } = useQuery({
    queryKey: ['speech-analyses', isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('speech_analyses')
        .select('*, candidates(full_name)')
        .order('created_at', { ascending: false });
      
      if (!isAdmin && user) {
        query = query.eq('user_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Analyze speech mutation with retry logic
  const analyzeMutation = useMutation({
    mutationFn: async (payload: any) => {
      let retries = 2;
      
      while (retries > 0) {
        // FASE 1.2: Token debugging antes de chamar edge function
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        console.log('🔑 Token status before speech analysis:', {
          hasSession: !!session,
          hasAccessToken: !!session?.access_token,
          tokenExpiry: session?.expires_at,
          isExpired: session?.expires_at ? new Date(session.expires_at * 1000) < new Date() : true,
          retriesLeft: retries
        });
        
        if (sessionError || !session) {
          throw new Error('Sessão inválida. Por favor, faça login novamente.');
        }

        try {
          const { data, error } = await supabase.functions.invoke('analyze-speech', {
            body: payload,
          });

          // FASE 1.3: Implementar retry automático com refresh em caso de 401
          if (error) {
            const isAuthError = error.message?.includes('Unauthorized') || 
                               error.message?.includes('JWT') ||
                               error.message?.includes('authorization') ||
                               error.message?.includes('401');
            
            if (isAuthError && retries > 1) {
              console.log('🔄 Authentication error detected, attempting token refresh...');
              const { error: refreshError } = await supabase.auth.refreshSession();
              
              if (refreshError) {
                console.error('❌ Token refresh failed:', refreshError);
                throw new Error('Sessão expirada. Por favor, faça login novamente.');
              }
              
              console.log('✅ Token refreshed successfully, retrying...');
              retries--;
              continue;
            }
            
            if (isAuthError) {
              console.error('🔒 Authentication error after retry');
              throw new Error('Sessão expirada. Por favor, faça login novamente.');
            }
            
            throw error;
          }
          
          console.log('✅ Speech analysis completed successfully');
          return data;
        } catch (e: any) {
          if (retries === 1) throw e;
          retries--;
        }
      }
      
      throw new Error('Falha ao analisar após múltiplas tentativas');
    },
    onSuccess: (data) => {
      toast({
        title: "Análise concluída!",
        description: "A fala foi analisada com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['speech-analyses'] });
      setSelectedAnalysis(data.analysis);
      // Clear form
      setSpeechTitle("");
      setSpeechText("");
      setSpeechDate("");
      setSpeechType("discurso");
    },
    onError: (error: any) => {
      console.error('Speech analysis error:', error);
      
      // If authentication error, force logout
      if (error.message?.includes('Sessão expirada')) {
        toast({
          title: "Sessão Expirada 🔒",
          description: "Sua sessão expirou. Redirecionando para login...",
          variant: "destructive",
        });
        
        setTimeout(async () => {
          await supabase.auth.signOut();
          window.location.href = '/auth';
        }, 2000);
        return;
      }
      
      toast({
        title: "Erro na análise",
        description: error.message || "Não foi possível analisar a fala.",
        variant: "destructive",
      });
    },
  });

  // Delete analysis mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('speech_analyses')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Análise excluída",
        description: "A análise foi removida com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['speech-analyses'] });
      if (selectedAnalysis?.id === deleteMutation.variables) {
        setSelectedAnalysis(null);
      }
    },
  });

  const handleAnalyze = () => {
    if (!speechTitle.trim() || !speechText.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Por favor, preencha o título e o texto da fala.",
        variant: "destructive",
      });
      return;
    }

    analyzeMutation.mutate({
      speechTitle,
      speechText,
      candidateId: selectedCandidateId || null,
      speechDate: speechDate || null,
      speechType,
    });
  };

  const getRiskColor = (level: number) => {
    if (level >= 8) return "text-red-600";
    if (level >= 5) return "text-yellow-600";
    return "text-green-600";
  };

  const getRiskLabel = (level: number) => {
    if (level >= 8) return "Alto Risco";
    if (level >= 5) return "Risco Moderado";
    return "Baixo Risco";
  };

  // Prepare emotional data for radar chart
  const getEmotionalChartData = (emotionalAnalysis: any) => {
    if (!emotionalAnalysis) return [];
    return [
      { emotion: 'Raiva', value: emotionalAnalysis.anger || 0 },
      { emotion: 'Medo', value: emotionalAnalysis.fear || 0 },
      { emotion: 'Desconfiança', value: emotionalAnalysis.distrust || 0 },
      { emotion: 'Esperança', value: emotionalAnalysis.hope || 0 },
      { emotion: 'Alegria', value: emotionalAnalysis.joy || 0 },
      { emotion: 'Tristeza', value: emotionalAnalysis.sadness || 0 },
    ];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Mic className="h-8 w-8" />
            Análise Inteligente de Fala
          </h1>
          <p className="text-muted-foreground mt-2">
            Analise discursos, entrevistas e falas políticas para identificar gatilhos e impactos
          </p>
        </div>
      </div>

      <Tabs defaultValue="new" className="space-y-4">
        <TabsList>
          <TabsTrigger value="new">Nova Análise</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Dados da Fala</CardTitle>
              <CardDescription>
                Preencha as informações sobre a fala a ser analisada
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Título da Fala *</Label>
                  <Input
                    id="title"
                    placeholder="Ex: Discurso sobre economia"
                    value={speechTitle}
                    onChange={(e) => setSpeechTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="candidate">Candidato</Label>
                  <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um candidato" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Nenhum</SelectItem>
                      {candidates?.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="date">Data da Fala</Label>
                  <Input
                    id="date"
                    type="date"
                    value={speechDate}
                    onChange={(e) => setSpeechDate(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Tipo de Fala</Label>
                  <Select value={speechType} onValueChange={setSpeechType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discurso">Discurso</SelectItem>
                      <SelectItem value="entrevista">Entrevista</SelectItem>
                      <SelectItem value="debate">Debate</SelectItem>
                      <SelectItem value="video">Vídeo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="text">Texto da Fala *</Label>
                <Textarea
                  id="text"
                  placeholder="Cole aqui o texto completo da fala a ser analisada..."
                  value={speechText}
                  onChange={(e) => setSpeechText(e.target.value)}
                  rows={10}
                  className="font-mono text-sm"
                />
              </div>

              <Button
                onClick={handleAnalyze}
                disabled={analyzeMutation.isPending}
                className="w-full"
                size="lg"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Brain className="mr-2 h-4 w-4 animate-pulse" />
                    Analisando com IA...
                  </>
                ) : (
                  <>
                    <Brain className="mr-2 h-4 w-4" />
                    Analisar Fala
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {selectedAnalysis && (
            <div className="space-y-4">
              {/* KPIs Header */}
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Nível de Risco
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-3xl font-bold ${getRiskColor(selectedAnalysis.risk_level)}`}>
                      {selectedAnalysis.risk_level}/10
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {getRiskLabel(selectedAnalysis.risk_level)}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Percepção Negativa
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {selectedAnalysis.negative_perception_score?.toFixed(1) || 0}/10
                    </div>
                    <Progress 
                      value={(selectedAnalysis.negative_perception_score || 0) * 10} 
                      className="mt-2"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Confiança da Análise
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-600">
                      {Math.round((selectedAnalysis.analysis_confidence || 0) * 100)}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Alta confiança
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Gatilhos Detectados
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-red-600">
                      {selectedAnalysis.trigger_words?.length || 0}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Palavras críticas
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Main Analysis Content */}
              <div className="grid grid-cols-3 gap-4">
                {/* Left Column - Triggers and Segments */}
                <div className="col-span-2 space-y-4">
                  {/* Trigger Words */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                        Gatilhos Críticos
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[200px]">
                        <div className="space-y-2">
                          {selectedAnalysis.trigger_words?.map((trigger: any, index: number) => (
                            <Alert key={index} variant="destructive">
                              <AlertTitle className="flex items-center justify-between">
                                <span className="font-bold">"{trigger.word}"</span>
                                <Badge variant="destructive">
                                  Severidade: {trigger.severity}/10
                                </Badge>
                              </AlertTitle>
                              <AlertDescription className="mt-2 space-y-1">
                                <p><strong>Posição:</strong> {trigger.position}</p>
                                <p><strong>Motivo:</strong> {trigger.reason}</p>
                              </AlertDescription>
                            </Alert>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  {/* Problematic Segments */}
                  {selectedAnalysis.problematic_segments && selectedAnalysis.problematic_segments.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <MessageSquare className="h-5 w-5" />
                          Trechos Problemáticos
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-3">
                            {selectedAnalysis.problematic_segments.map((segment: any, index: number) => (
                              <div key={index} className="border-l-4 border-red-500 pl-3 py-2">
                                <p className="text-sm italic mb-2">"{segment.text}"</p>
                                <div className="space-y-1 text-xs">
                                  <p><strong>Problema:</strong> {segment.issue}</p>
                                  <Badge variant="outline">{segment.emotion}</Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {/* Psychological Impact */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5" />
                        Análise Psicológica
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed">{selectedAnalysis.psychological_impact}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Column - Charts and Profiles */}
                <div className="space-y-4">
                  {/* Emotional Radar Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Análise Emocional</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={200}>
                        <RadarChart data={getEmotionalChartData(selectedAnalysis.emotional_analysis)}>
                          <PolarGrid />
                          <PolarAngleAxis dataKey="emotion" tick={{ fontSize: 10 }} />
                          <Radar
                            name="Intensidade"
                            dataKey="value"
                            stroke="hsl(var(--primary))"
                            fill="hsl(var(--primary))"
                            fillOpacity={0.6}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Affected Voter Profiles */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Eleitores Afetados
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {selectedAnalysis.affected_voter_profiles?.map((profile: string, index: number) => (
                          <Badge key={index} variant="secondary">
                            {profile}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Recommended Actions */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Ações Recomendadas
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ol className="space-y-2 text-sm">
                        {selectedAnalysis.recommended_actions?.map((action: string, index: number) => (
                          <li key={index} className="flex gap-2">
                            <Badge variant="outline" className="shrink-0">{index + 1}</Badge>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>

                  {/* Communication Suggestions */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Sugestões de Comunicação</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        {selectedAnalysis.communication_suggestions?.map((suggestion: string, index: number) => (
                          <li key={index} className="flex items-start gap-2">
                            <span className="text-green-500">✓</span>
                            <span>{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Análises</CardTitle>
              <CardDescription>
                Visualize e compare análises anteriores
              </CardDescription>
            </CardHeader>
            <CardContent>
              {analysesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : analyses && analyses.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Candidato</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Risco</TableHead>
                      <TableHead>Gatilhos</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyses.map((analysis: any) => (
                      <TableRow key={analysis.id}>
                        <TableCell className="font-medium">{analysis.speech_title}</TableCell>
                        <TableCell>
                          {analysis.candidates?.full_name || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{analysis.speech_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getRiskColor(analysis.risk_level)}>
                            {analysis.risk_level}/10
                          </Badge>
                        </TableCell>
                        <TableCell>{analysis.trigger_words?.length || 0}</TableCell>
                        <TableCell>
                          {format(new Date(analysis.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedAnalysis(analysis)}
                            >
                              Ver
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteMutation.mutate(analysis.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  Nenhuma análise encontrada
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
