import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useToast } from "@/hooks/use-toast";
import { Brain, Share2, FileText, Trash2, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";
import { useTokenValidator } from "@/hooks/useTokenValidator";
import { DateRange } from "react-day-picker";

export default function SpeechAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const [analysisMode, setAnalysisMode] = useState<'temporal' | 'social_media' | 'manual'>('temporal');
  const [speechTitle, setSpeechTitle] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [selectedAnalysisId, setSelectedAnalysisId] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date()
  });

  const { data: candidates } = useQuery({
    queryKey: ['candidates'],
    queryFn: async () => {
      const { data } = await supabase.from('candidates').select('*').order('full_name');
      return data || [];
    }
  });

  const { data: candidateAnalyses } = useQuery({
    queryKey: ['candidate-analyses', selectedCandidateId],
    queryFn: async () => {
      if (!selectedCandidateId) return [];
      const { data } = await supabase.from('candidate_analyses')
        .select('*').eq('candidate_id', selectedCandidateId).eq('analysis_status', 'completed');
      return data || [];
    },
    enabled: !!selectedCandidateId && analysisMode === 'social_media'
  });

  const { data: periodAnalyses } = useQuery({
    queryKey: ['period-analyses', selectedCandidateId, dateRange],
    queryFn: async () => {
      if (!selectedCandidateId || !dateRange?.from || !dateRange?.to) return [];
      const { data } = await supabase.from('candidate_analyses')
        .select('*')
        .eq('candidate_id', selectedCandidateId)
        .eq('analysis_status', 'completed')
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString());
      return data || [];
    },
    enabled: !!selectedCandidateId && !!dateRange?.from && !!dateRange?.to && analysisMode === 'temporal'
  });

  const { data: speechAnalyses } = useQuery({
    queryKey: ['speech-analyses'],
    queryFn: async () => {
      const { data } = await supabase.from('speech_analyses').select('*, candidates(full_name)').order('created_at', { ascending: false });
      return data || [];
    }
  });

  const { validateToken } = useTokenValidator();
  
  const analyzeMutation = useMutation({
    mutationFn: async (payload: any) => {
      // 🔥 PRE-FLIGHT TOKEN VALIDATION
      const isTokenValid = await validateToken();
      if (!isTokenValid) {
        throw new Error('Token inválido. Redirecionando para login...');
      }
      
      const { data, error } = await supabase.functions.invoke('analyze-speech', { body: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Análise concluída!" });
      queryClient.invalidateQueries({ queryKey: ['speech-analyses'] });
      setSpeechTitle(""); setSpeechText(""); setSelectedAnalysisId("");
    },
    onError: (error: any) => {
      console.error('Analysis error:', error);
      
      // 🔥 AGGRESSIVE AUTH ERROR DETECTION
      const authErrorKeywords = ['Unauthorized', 'JWT', 'authorization', '401', 'session', 'token', 'expired', 'Invalid'];
      const isAuthError = authErrorKeywords.some(keyword => 
        error.message?.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isAuthError) {
        toast({
          title: "Sessão Inválida 🔒",
          description: "Sua sessão está corrompida. Redirecionando para login...",
          variant: "destructive",
        });
        
        setTimeout(async () => {
          await supabase.auth.signOut();
          window.location.href = '/auth';
        }, 1500);
        return;
      }
      
      toast({
        title: "Erro na análise",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const analyzeTemporalMutation = useMutation({
    mutationFn: async (payload: any) => {
      // 🔥 PRE-FLIGHT TOKEN VALIDATION
      const isTokenValid = await validateToken();
      if (!isTokenValid) {
        throw new Error('Token inválido. Redirecionando para login...');
      }
      
      const { data, error } = await supabase.functions.invoke('analyze-speeches-temporal', { body: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Análise temporal concluída!" });
      queryClient.invalidateQueries({ queryKey: ['speech-analyses'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro na análise", 
        description: error.message || "Erro desconhecido",
        variant: "destructive"
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('speech_analyses').delete().eq('id', id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['speech-analyses'] })
  });

  const handleAnalyze = () => {
    if (analysisMode === 'manual') {
      analyzeMutation.mutate({ mode: 'manual', speechText, speechTitle, candidateId: selectedCandidateId });
    } else {
      const analysis = candidateAnalyses?.find(a => a.id === selectedAnalysisId);
      analyzeMutation.mutate({
        mode: 'social_media',
        candidateId: selectedCandidateId,
        analysisId: selectedAnalysisId,
        keywords: analysis?.keywords,
        postsAnalyzed: analysis?.posts_analyzed,
        sentimentLabel: analysis?.sentiment_label
      });
    }
  };

  const handleTemporalAnalysis = () => {
    if (!selectedCandidateId || !dateRange?.from || !dateRange?.to) {
      toast({ 
        title: "Dados incompletos", 
        description: "Selecione um candidato e período",
        variant: "destructive"
      });
      return;
    }

    analyzeTemporalMutation.mutate({
      candidateId: selectedCandidateId,
      startDate: dateRange.from.toISOString(),
      endDate: dateRange.to.toISOString()
    });
  };

  const totalPostsInPeriod = periodAnalyses?.reduce((sum, a) => sum + (a.posts_analyzed || 0), 0) || 0;
  const socialNetworksInPeriod = [...new Set(periodAnalyses?.map(a => a.social_network).filter(Boolean))];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Análise Inteligente de Fala</h1>
      <Tabs defaultValue="new">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="new">Nova Análise</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="new">
          <Card>
            <CardHeader>
              <CardTitle>Criar Nova Análise</CardTitle>
              <CardDescription>Escolha o tipo de análise que deseja realizar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Modo de Análise</Label>
                <RadioGroup value={analysisMode} onValueChange={(v: any) => setAnalysisMode(v)}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="temporal" id="temporal" />
                    <Label htmlFor="temporal" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        <span>Análise Temporal (Período)</span>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6">
                        Analisa falas identificadas nas redes sociais durante um período específico
                      </p>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="social_media" id="social" />
                    <Label htmlFor="social" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Share2 className="h-4 w-4" />
                        <span>Análise de Redes Sociais</span>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6">
                        Analisa dados agregados de uma análise de candidato existente
                      </p>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="manual" id="manual" />
                    <Label htmlFor="manual" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span>Análise Manual (Texto)</span>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6">
                        Insira manualmente o texto de uma fala específica para análise
                      </p>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {analysisMode === 'temporal' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Candidato</Label>
                    <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um candidato" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Período de Análise</Label>
                    <DateRangePicker 
                      dateRange={dateRange}
                      onDateRangeChange={setDateRange}
                    />
                  </div>

                  {selectedCandidateId && dateRange?.from && dateRange?.to && (
                    <Card className="bg-muted/50 border-primary/20">
                      <CardHeader>
                        <CardTitle className="text-sm">Preview do Período</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Análises disponíveis:</span>
                          <span className="font-semibold">{periodAnalyses?.length || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Posts coletados:</span>
                          <span className="font-semibold">{totalPostsInPeriod}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Redes sociais:</span>
                          <span className="font-semibold">{socialNetworksInPeriod.join(', ') || 'N/A'}</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Button 
                    onClick={handleTemporalAnalysis}
                    disabled={!selectedCandidateId || !dateRange?.from || !dateRange?.to || analyzeTemporalMutation.isPending}
                    className="w-full"
                  >
                    <Brain className="mr-2 h-4 w-4" />
                    {analyzeTemporalMutation.isPending ? 'Analisando...' : 'Analisar Falas no Período'}
                  </Button>
                </div>
              )}

              {analysisMode === 'social_media' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Candidato</Label>
                    <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um candidato" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedCandidateId && (
                    <div className="space-y-2">
                      <Label>Análise de Candidato</Label>
                      <Select value={selectedAnalysisId} onValueChange={setSelectedAnalysisId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma análise" />
                        </SelectTrigger>
                        <SelectContent>
                          {candidateAnalyses?.map(a => (
                            <SelectItem key={a.id} value={a.id}>
                              {format(new Date(a.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} - {a.sentiment_label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <Button 
                    onClick={handleAnalyze}
                    disabled={!selectedAnalysisId || analyzeMutation.isPending}
                    className="w-full"
                  >
                    <Brain className="mr-2 h-4 w-4" />
                    {analyzeMutation.isPending ? 'Analisando...' : 'Analisar'}
                  </Button>
                </div>
              )}

              {analysisMode === 'manual' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Candidato (Opcional)</Label>
                    <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um candidato" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Título da Fala</Label>
                    <Input 
                      value={speechTitle}
                      onChange={(e) => setSpeechTitle(e.target.value)}
                      placeholder="Ex: Discurso sobre educação"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Texto da Fala</Label>
                    <Textarea 
                      value={speechText}
                      onChange={(e) => setSpeechText(e.target.value)}
                      placeholder="Cole aqui o texto completo da fala ou discurso..."
                      rows={8}
                    />
                  </div>

                  <Button 
                    onClick={handleAnalyze}
                    disabled={!speechText || !speechTitle || analyzeMutation.isPending}
                    className="w-full"
                  >
                    <Brain className="mr-2 h-4 w-4" />
                    {analyzeMutation.isPending ? 'Analisando...' : 'Analisar Fala'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="history">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {speechAnalyses?.map(a => (
                    <TableRow key={a.id}>
                      <TableCell>{a.speech_title}</TableCell>
                      <TableCell>
                        <Badge variant={a.source_type === 'social_media' ? 'default' : 'secondary'}>
                          {a.source_type === 'social_media' ? <Share2 className="h-3 w-3 mr-1" /> : <FileText className="h-3 w-3 mr-1" />}
                          {a.source_type === 'social_media' ? 'Redes Sociais' : 'Manual'}
                        </Badge>
                      </TableCell>
                      <TableCell>{format(new Date(a.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</TableCell>
                      <TableCell><Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(a.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
