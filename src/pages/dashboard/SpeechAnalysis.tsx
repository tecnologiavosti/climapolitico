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
import { useToast } from "@/hooks/use-toast";
import { Brain, Share2, FileText, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";

export default function SpeechAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const [analysisMode, setAnalysisMode] = useState<'social_media' | 'manual'>('social_media');
  const [speechTitle, setSpeechTitle] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [selectedAnalysisId, setSelectedAnalysisId] = useState("");

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

  const { data: speechAnalyses } = useQuery({
    queryKey: ['speech-analyses'],
    queryFn: async () => {
      const { data } = await supabase.from('speech_analyses').select('*, candidates(full_name)').order('created_at', { ascending: false });
      return data || [];
    }
  });

  const analyzeMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.functions.invoke('analyze-speech', { body: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Análise concluída!" });
      queryClient.invalidateQueries({ queryKey: ['speech-analyses'] });
      setSpeechTitle(""); setSpeechText(""); setSelectedAnalysisId("");
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
            <CardContent className="pt-6 space-y-4">
              <RadioGroup value={analysisMode} onValueChange={(v: any) => setAnalysisMode(v)}>
                <div className="flex items-center space-x-2 p-4 border rounded-lg">
                  <RadioGroupItem value="social_media" />
                  <Label className="flex-1"><Share2 className="inline h-4 w-4 mr-2" />Análise Automática (Redes Sociais)</Label>
                </div>
                <div className="flex items-center space-x-2 p-4 border rounded-lg">
                  <RadioGroupItem value="manual" />
                  <Label className="flex-1"><FileText className="inline h-4 w-4 mr-2" />Análise Manual (Texto)</Label>
                </div>
              </RadioGroup>

              {analysisMode === 'social_media' ? (
                <>
                  <Select value={selectedCandidateId} onValueChange={setSelectedCandidateId}>
                    <SelectTrigger><SelectValue placeholder="Candidato" /></SelectTrigger>
                    <SelectContent>
                      {candidates?.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedCandidateId && (
                    <Select value={selectedAnalysisId} onValueChange={setSelectedAnalysisId}>
                      <SelectTrigger><SelectValue placeholder="Análise" /></SelectTrigger>
                      <SelectContent>
                        {candidateAnalyses?.map(a => <SelectItem key={a.id} value={a.id}>{format(new Date(a.created_at), 'dd/MM/yyyy')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </>
              ) : (
                <>
                  <Input placeholder="Título" value={speechTitle} onChange={e => setSpeechTitle(e.target.value)} />
                  <Textarea placeholder="Texto da fala" value={speechText} onChange={e => setSpeechText(e.target.value)} rows={6} />
                </>
              )}
              <Button onClick={handleAnalyze} disabled={analyzeMutation.isPending} className="w-full">
                <Brain className="mr-2 h-4 w-4" />{analyzeMutation.isPending ? 'Analisando...' : 'Analisar'}
              </Button>
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
