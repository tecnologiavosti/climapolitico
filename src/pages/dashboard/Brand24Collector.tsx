import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  Rss, Play, CheckCircle, AlertCircle, Globe, Loader2,
  RefreshCw, Clock, Trash2, Plus
} from "lucide-react";

interface CollectionResult {
  success: boolean;
  imported: number;
  skipped: number;
  networks: Record<string, number>;
  sentiment?: { positive: number; negative: number; neutral: number; none: number };
  ai_analyzed?: number;
  message?: string;
}

interface RSSConfig {
  id: string;
  candidate_id: string;
  candidate_name: string;
  rss_url: string;
  last_collected_at: string | null;
  last_result: CollectionResult | null;
}

const networkLabels: Record<string, string> = {
  twitter: "Twitter/X", facebook: "Facebook", instagram: "Instagram",
  youtube: "YouTube", tiktok: "TikTok", reddit: "Reddit",
  linkedin: "LinkedIn", web: "Web/Notícias", tumblr: "Tumblr",
  pinterest: "Pinterest",
};

export default function Brand24Collector() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newCandidateId, setNewCandidateId] = useState("");
  const [newRssUrl, setNewRssUrl] = useState("");
  const [collectingId, setCollectingId] = useState<string | null>(null);

  const { data: candidates } = useQuery({
    queryKey: ['candidates-list', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('id, full_name, party')
        .order('full_name');
      return data || [];
    },
    enabled: !!user,
  });

  // Load saved RSS configs from collection_configs
  const { data: rssConfigs, refetch: refetchConfigs } = useQuery({
    queryKey: ['brand24-rss-configs', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('collection_configs')
        .select('id, candidate_id, config, updated_at')
        .eq('status', 'brand24_rss')
        .order('updated_at', { ascending: false });

      if (!data) return [];

      // Enrich with candidate names
      const configs: RSSConfig[] = [];
      for (const item of data) {
        const candidate = candidates?.find(c => c.id === item.candidate_id);
        const cfg = item.config as any;
        configs.push({
          id: item.id,
          candidate_id: item.candidate_id || '',
          candidate_name: candidate?.full_name || 'Candidato desconhecido',
          rss_url: cfg?.rss_url || '',
          last_collected_at: cfg?.last_collected_at || null,
          last_result: cfg?.last_result || null,
        });
      }
      return configs;
    },
    enabled: !!user && !!candidates,
  });

  const addConfigMutation = useMutation({
    mutationFn: async ({ candidateId, rssUrl }: { candidateId: string; rssUrl: string }) => {
      const { error } = await supabase.from('collection_configs').insert({
        user_id: user!.id,
        candidate_id: candidateId,
        status: 'brand24_rss',
        config: { rss_url: rssUrl, last_collected_at: null, last_result: null },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Feed RSS adicionado!" });
      setNewCandidateId("");
      setNewRssUrl("");
      refetchConfigs();
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('collection_configs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Feed removido" });
      refetchConfigs();
    },
  });

  const collectMutation = useMutation({
    mutationFn: async (config: RSSConfig) => {
      setCollectingId(config.id);
      const { data, error } = await supabase.functions.invoke('collect-brand24-rss', {
        body: { rss_url: config.rss_url, candidate_id: config.candidate_id },
      });
      if (error) throw error;
      if (!data.success && data.error) throw new Error(data.error);

      // Update config with last result
      await supabase.from('collection_configs').update({
        config: {
          rss_url: config.rss_url,
          last_collected_at: new Date().toISOString(),
          last_result: data,
        },
      }).eq('id', config.id);

      return data as CollectionResult;
    },
    onSuccess: (data, config) => {
      setCollectingId(null);
      refetchConfigs();
      if (data.imported > 0) {
        toast({
          title: `${data.imported} menções coletadas!`,
          description: `Redes: ${Object.keys(data.networks).map(n => networkLabels[n] || n).join(', ')}`,
        });
      } else {
        toast({
          title: "Nenhuma menção nova",
          description: data.message || `${data.skipped} já coletadas anteriormente`,
        });
      }
    },
    onError: (err: any) => {
      setCollectingId(null);
      toast({ title: "Erro na coleta", description: err.message, variant: "destructive" });
    },
  });

  const collectAll = async () => {
    if (!rssConfigs?.length) return;
    for (const config of rssConfigs) {
      await collectMutation.mutateAsync(config).catch(() => {});
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <HelpTooltip text="Liga a coleta automática do Brand24, que pega menções de várias redes ao mesmo tempo.">
            <h2 className="text-3xl font-bold">Brand24 — Coleta Automática</h2>
          </HelpTooltip>
          <p className="text-muted-foreground mt-1">
            Configure os feeds RSS do Brand24 para coletar menções automaticamente de todas as redes sociais.
          </p>
        </div>
        {rssConfigs && rssConfigs.length > 0 && (
          <HelpTooltip text="Roda a coleta de todos os feeds configurados de uma vez só.">
            <Button onClick={collectAll} disabled={!!collectingId} size="lg">
              <RefreshCw className={`h-4 w-4 mr-2 ${collectingId ? 'animate-spin' : ''}`} />
              Coletar Todos
            </Button>
          </HelpTooltip>
        )}
      </div>

      {/* Add new RSS config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Adicionar Feed RSS
          </CardTitle>
          <CardDescription>
            No Brand24, acesse seu projeto → ícone de engrenagem → RSS Feed → copie a URL do feed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Candidato</Label>
              <Select value={newCandidateId} onValueChange={setNewCandidateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {candidates?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name} {c.party ? `(${c.party})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 flex gap-2">
              <div className="flex-1">
                <Label>URL do Feed RSS do Brand24</Label>
                <Input
                  value={newRssUrl}
                  onChange={e => setNewRssUrl(e.target.value)}
                  placeholder="https://app.brand24.com/rss/..."
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => addConfigMutation.mutate({ candidateId: newCandidateId, rssUrl: newRssUrl })}
                  disabled={!newCandidateId || !newRssUrl || addConfigMutation.isPending}
                >
                  Adicionar
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RSS Feeds configured */}
      {rssConfigs && rssConfigs.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {rssConfigs.map(config => (
            <Card key={config.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <Rss className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold text-lg">{config.candidate_name}</h3>
                      {config.last_collected_at && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Última: {new Date(config.last_collected_at).toLocaleString('pt-BR')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate max-w-xl">{config.rss_url}</p>

                    {/* Last result */}
                    {config.last_result && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="outline">
                          {config.last_result.imported} importadas
                        </Badge>
                        {config.last_result.skipped > 0 && (
                          <Badge variant="outline">
                            {config.last_result.skipped} duplicadas
                          </Badge>
                        )}
                        {config.last_result.networks && Object.entries(config.last_result.networks).map(([net, count]) => (
                          <Badge key={net} variant="secondary">
                            {networkLabels[net] || net}: {count}
                          </Badge>
                        ))}
                        {config.last_result.sentiment && (
                          <>
                            {config.last_result.sentiment.positive > 0 && (
                              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                                👍 {config.last_result.sentiment.positive}
                              </Badge>
                            )}
                            {config.last_result.sentiment.negative > 0 && (
                              <Badge className="bg-red-500/10 text-red-600 border-red-200">
                                👎 {config.last_result.sentiment.negative}
                              </Badge>
                            )}
                            {config.last_result.sentiment.neutral > 0 && (
                              <Badge className="bg-gray-500/10 text-gray-600 border-gray-200">
                                😐 {config.last_result.sentiment.neutral}
                              </Badge>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => collectMutation.mutate(config)}
                      disabled={collectingId === config.id}
                    >
                      {collectingId === config.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      <span className="ml-1">Coletar</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteConfigMutation.mutate(config.id)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Rss className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-center font-medium">Nenhum feed RSS configurado</p>
            <p className="text-sm text-center mt-1">
              Adicione a URL do feed RSS do seu projeto Brand24 acima
            </p>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Como obter o feed RSS do Brand24</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Acesse <strong>app.brand24.com</strong> e entre no seu projeto</li>
            <li>Na aba <strong>Mentions</strong>, clique no ícone de <strong>engrenagem</strong> (⚙️)</li>
            <li>Selecione <strong>"RSS Feed"</strong></li>
            <li>Copie a URL do feed e cole aqui</li>
            <li>Clique em <strong>"Coletar"</strong> para importar as menções</li>
          </ol>
          <div className="mt-4 p-3 bg-muted rounded space-y-2">
            <p>💡 <strong>Dica:</strong> Crie um projeto no Brand24 para cada candidato com as keywords dele (nome, apelido, partido).</p>
            <p>📡 <strong>Redes coletadas:</strong> Twitter/X, Facebook, Instagram, YouTube, TikTok, Reddit, LinkedIn, blogs, fóruns e notícias — tudo automaticamente pelo Brand24.</p>
            <p>🤖 <strong>Sentimento:</strong> A IA do Clima Político reanálise cada menção para o contexto político brasileiro.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
