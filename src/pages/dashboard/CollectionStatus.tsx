import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Play, 
  Pause,
  Youtube,
  Info,
  Loader2,
  RefreshCw,
  Settings2
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GlobalConfig {
  id: string;
  frequency: 'hourly' | 'every_6_hours' | 'every_12_hours' | 'daily';
  analysisPeriodDays: number;
  status: 'active' | 'paused';
  lastCollectionAt: string | null;
  nextCollectionAt: string | null;
  totalCommentsCollected: number;
}

const FREQUENCY_OPTIONS = [
  { value: 'hourly', label: 'A cada hora', description: 'Coleta intensiva para monitoramento em tempo real' },
  { value: 'every_6_hours', label: 'A cada 6 horas', description: 'Balanço entre atualização e uso de API' },
  { value: 'every_12_hours', label: 'A cada 12 horas', description: 'Coleta moderada' },
  { value: 'daily', label: 'Diária', description: 'Uma coleta por dia' },
];

const PERIOD_OPTIONS = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 14, label: 'Últimos 14 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 60, label: 'Últimos 60 dias' },
  { value: 90, label: 'Últimos 90 dias' },
];

export default function CollectionStatus() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [frequency, setFrequency] = useState<string>('daily');
  const [analysisPeriodDays, setAnalysisPeriodDays] = useState<number>(30);
  const [isActive, setIsActive] = useState(true);
  const [stats, setStats] = useState({
    totalComments: 0,
    candidatesWithData: 0,
    lastCollection: null as string | null,
  });

  useEffect(() => {
    fetchConfigAndStats();
  }, []);

  const fetchConfigAndStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Buscar configuração global existente ou criar uma padrão
      const { data: configs, error: configError } = await supabase
        .from("collection_configs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (configError) throw configError;

      if (configs && configs.length > 0) {
        const existingConfig = configs[0];
        const configData = existingConfig.config as Record<string, unknown> | null;
        const configFrequency = (configData?.frequency as string) || 'daily';
        const configPeriodDays = (configData?.analysisPeriodDays as number) || 30;
        
        setFrequency(configFrequency);
        setAnalysisPeriodDays(configPeriodDays);
        setIsActive(existingConfig.status === 'active');
        setConfig({
          id: existingConfig.id,
          frequency: configFrequency as GlobalConfig['frequency'],
          analysisPeriodDays: configPeriodDays,
          status: existingConfig.status as 'active' | 'paused',
          lastCollectionAt: (configData?.lastCollectionAt as string) || null,
          nextCollectionAt: (configData?.nextCollectionAt as string) || null,
          totalCommentsCollected: (configData?.totalCommentsCollected as number) || 0,
        });
      }

      // Buscar estatísticas reais
      const { count: commentsCount } = await supabase
        .from("social_interactions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("social_network", "YouTube");

      const { data: latestComment } = await supabase
        .from("social_interactions")
        .select("collected_at")
        .eq("user_id", user.id)
        .eq("social_network", "YouTube")
        .order("collected_at", { ascending: false })
        .limit(1)
        .single();

      const { data: candidatesData } = await supabase
        .from("candidates")
        .select("id")
        .eq("user_id", user.id);

      // Contar candidatos com dados
      let candidatesWithDataCount = 0;
      if (candidatesData) {
        for (const candidate of candidatesData) {
          const { count } = await supabase
            .from("social_interactions")
            .select("*", { count: "exact", head: true })
            .eq("candidate_id", candidate.id);
          if (count && count > 0) candidatesWithDataCount++;
        }
      }

      setStats({
        totalComments: commentsCount || 0,
        candidatesWithData: candidatesWithDataCount,
        lastCollection: latestComment?.collected_at || null,
      });

    } catch (error) {
      console.error("Error fetching config:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar a configuração.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const configData = {
        frequency,
        analysisPeriodDays,
        networks: ['youtube'],
        source: 'youtube',
        lastUpdatedAt: new Date().toISOString(),
      };

      if (config?.id) {
        // Atualizar configuração existente
        const { error } = await supabase
          .from("collection_configs")
          .update({
            config: configData,
            status: isActive ? 'active' : 'paused',
            updated_at: new Date().toISOString(),
          })
          .eq("id", config.id);

        if (error) throw error;
      } else {
        // Criar nova configuração global
        const { error } = await supabase
          .from("collection_configs")
          .insert({
            user_id: user.id,
            config: configData,
            status: isActive ? 'active' : 'paused',
          });

        if (error) throw error;
      }

      toast({
        title: "Configuração Salva",
        description: "As configurações de coleta foram atualizadas com sucesso.",
      });

      fetchConfigAndStats();
    } catch (error) {
      console.error("Error saving config:", error);
      toast({
        title: "Erro",
        description: "Não foi possível salvar a configuração.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    const newStatus = !isActive;
    setIsActive(newStatus);

    if (config?.id) {
      try {
        const { error } = await supabase
          .from("collection_configs")
          .update({ status: newStatus ? 'active' : 'paused' })
          .eq("id", config.id);

        if (error) throw error;

        toast({
          title: newStatus ? "Coleta Ativada" : "Coleta Pausada",
          description: newStatus 
            ? "A coleta de dados do YouTube foi ativada." 
            : "A coleta de dados do YouTube foi pausada.",
        });
      } catch (error) {
        setIsActive(!newStatus); // Reverter
        toast({
          title: "Erro",
          description: "Não foi possível alterar o status.",
          variant: "destructive",
        });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <HelpTooltip text="Veja se a coleta de dados de cada rede social está rodando direitinho.">
        <h1 className="text-3xl font-bold">Configuração de Coleta</h1>
      </HelpTooltip>
          <p className="text-muted-foreground">
            Configure a coleta automática de dados do YouTube
          </p>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando configuração...
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Configuração de Coleta</h1>
          <p className="text-muted-foreground">
            Configure a coleta automática de dados do YouTube
          </p>
        </div>
        <div className="flex items-center gap-3">
          <HelpTooltip text="Mostra se a coleta automática está ligada (verde) ou pausada (cinza).">
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? (
                <><CheckCircle2 className="mr-1 h-3 w-3" /> Ativa</>
              ) : (
                <><Pause className="mr-1 h-3 w-3" /> Pausada</>
              )}
            </Badge>
          </HelpTooltip>
        </div>
      </div>

      {/* Fontes de Dados */}
      <Card>
        <CardHeader>
          <HelpTooltip text="As redes sociais de onde estamos pegando os comentários sobre seus candidatos.">
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Fontes de Dados
            </CardTitle>
          </HelpTooltip>
          <CardDescription>
            Plataformas de onde os dados são coletados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="w-12 h-12 rounded-full bg-destructive flex items-center justify-center">
              <Youtube className="h-6 w-6 text-destructive-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">YouTube</p>
              <p className="text-sm text-muted-foreground">
                Comentários públicos de vídeos relacionados aos candidatos
              </p>
            </div>
            <Badge variant="outline">Conectado</Badge>
          </div>
          <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold">Twitter/X</p>
              <p className="text-sm text-muted-foreground">
                Tweets e menções públicas sobre os candidatos
              </p>
            </div>
            <Badge variant="outline">Conectado</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Status e Controle */}
      <Card>
        <CardHeader>
          <HelpTooltip text="Liga ou desliga a coleta automática. Quando desligado, nada novo é coletado.">
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Status da Coleta
            </CardTitle>
          </HelpTooltip>
          <CardDescription>
            Ative ou pause a coleta automática de dados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <Label className="text-base font-medium">Coleta Automática</Label>
              <p className="text-sm text-muted-foreground">
                {isActive 
                  ? "A coleta está ativa e será executada conforme a frequência configurada" 
                  : "A coleta está pausada. Nenhum dado novo será coletado automaticamente."}
              </p>
            </div>
            <HelpTooltip text="Aperta pra ligar ou desligar a coleta automática de comentários.">
              <Switch
                checked={isActive}
                onCheckedChange={handleToggleStatus}
              />
            </HelpTooltip>
          </div>

          {/* Estatísticas Atuais */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <HelpTooltip text="Total de comentários e posts já coletados pela plataforma.">
              <div className="p-4 border rounded-lg text-center">
                <p className="text-2xl font-bold">{stats.totalComments.toLocaleString('pt-BR')}</p>
                <p className="text-sm text-muted-foreground">Comentários Coletados</p>
              </div>
            </HelpTooltip>
            <HelpTooltip text="Quantos dos seus candidatos já têm dados coletados.">
              <div className="p-4 border rounded-lg text-center">
                <p className="text-2xl font-bold">{stats.candidatesWithData}</p>
                <p className="text-sm text-muted-foreground">Candidatos com Dados</p>
              </div>
            </HelpTooltip>
            <HelpTooltip text="Quando o sistema buscou comentários novos pela última vez.">
              <div className="p-4 border rounded-lg text-center">
                <p className="text-2xl font-bold">
                  {stats.lastCollection 
                    ? format(new Date(stats.lastCollection), "dd/MM HH:mm", { locale: ptBR })
                    : "—"}
                </p>
                <p className="text-sm text-muted-foreground">Última Coleta</p>
              </div>
            </HelpTooltip>
          </div>
        </CardContent>
      </Card>

      {/* Configuração de Frequência */}
      <Card>
        <CardHeader>
          <HelpTooltip text="De quanto em quanto tempo o sistema vai buscar comentários novos.">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Frequência de Coleta
            </CardTitle>
          </HelpTooltip>
          <CardDescription>
            Define com que frequência os dados do YouTube serão atualizados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup 
            value={frequency} 
            onValueChange={setFrequency}
            className="grid grid-cols-1 md:grid-cols-2 gap-3"
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <div
                key={option.value}
                className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                  frequency === option.value 
                    ? 'border-primary bg-primary/5' 
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => setFrequency(option.value)}
              >
                <RadioGroupItem value={option.value} id={option.value} className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor={option.value} className="cursor-pointer font-medium">
                    {option.label}
                  </Label>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Período de Análise */}
      <Card>
        <CardHeader>
          <HelpTooltip text="O quão pra trás no tempo a gente vai pegar comentários em cada coleta.">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Período de Análise
            </CardTitle>
          </HelpTooltip>
          <CardDescription>
            Define o intervalo de tempo para buscar comentários em cada coleta
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Select
              value={analysisPeriodDays.toString()}
              onValueChange={(value) => setAnalysisPeriodDays(Number(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value.toString()}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground mt-2">
              Ao coletar, buscamos comentários publicados dentro deste período.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <p className="font-medium">Como funciona a Coleta</p>
              <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                <li>Os dados são coletados automaticamente do YouTube e Twitter/X</li>
                <li>YouTube: busca comentários em vídeos que mencionam candidatos</li>
                <li>Twitter/X: busca tweets públicos e menções sobre candidatos</li>
                <li>Cada comentário/tweet passa por análise de sentimento via IA</li>
                <li>A coleta manual pode ser iniciada na tela de Candidatos</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Botão Salvar */}
      <div className="flex justify-end">
        <HelpTooltip text="Salva as alterações que você fez aqui na página.">
          <Button onClick={handleSaveConfig} disabled={isSaving} size="lg">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar Configuração"
            )}
          </Button>
        </HelpTooltip>
      </div>
    </div>
  );
}
