import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { 
  Twitter, 
  Youtube, 
  Facebook, 
  Music2, 
  Newspaper, 
  BookOpen,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  RefreshCw,
  Key,
  Globe,
  Rss
} from "lucide-react";

interface ApiConfig {
  id: string;
  platform: string;
  api_key: string | null;
  api_secret: string | null;
  access_token: string | null;
  is_active: boolean;
  last_verified_at: string | null;
  verified_status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const platformConfig = {
  twitter: {
    name: "Twitter/X",
    icon: Twitter,
    color: "bg-sky-500",
    fields: [{ key: "api_key", label: "Bearer Token", placeholder: "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwI..." }],
    description: "API v2 para buscar menções e tweets sobre candidatos"
  },
  youtube: {
    name: "YouTube",
    icon: Youtube,
    color: "bg-red-500",
    fields: [{ key: "api_key", label: "API Key", placeholder: "AIzaSy..." }],
    description: "Data API para buscar vídeos e comentários"
  },
  meta: {
    name: "Meta (Facebook/Instagram)",
    icon: Facebook,
    color: "bg-blue-600",
    fields: [
      { key: "api_key", label: "App ID", placeholder: "123456789012345" },
      { key: "access_token", label: "Access Token", placeholder: "EAAG..." }
    ],
    description: "Graph API para acessar posts e comentários"
  },
  tiktok: {
    name: "TikTok",
    icon: Music2,
    color: "bg-black",
    fields: [{ key: "access_token", label: "Access Token", placeholder: "act...." }],
    description: "Research API para análise de conteúdo"
  },
  reddit: {
    name: "Reddit",
    icon: Globe,
    color: "bg-orange-500",
    fields: [
      { key: "api_key", label: "Client ID", placeholder: "..." },
      { key: "api_secret", label: "Client Secret", placeholder: "..." }
    ],
    description: "API para buscar discussões políticas"
  }
};

const freeSourcesConfig = [
  {
    id: "google_news",
    name: "Google News",
    icon: Newspaper,
    color: "bg-green-500",
    description: "Notícias em tempo real via RSS feed",
    endpoint: "https://news.google.com/rss/search?q={candidato}"
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    icon: BookOpen,
    color: "bg-gray-600",
    description: "Informações biográficas e contextuais",
    endpoint: "https://pt.wikipedia.org/api/rest_v1/"
  },
  {
    id: "rss_feeds",
    name: "Portais de Notícias (RSS)",
    icon: Rss,
    color: "bg-purple-500",
    description: "Feeds RSS de portais como G1, UOL, Folha",
    endpoint: "Múltiplos feeds configuráveis"
  }
];

const AdminApiSettings = () => {
  const { isAdmin, isLoading: adminLoading } = useAdminCheck();
  const queryClient = useQueryClient();
  const [editingPlatform, setEditingPlatform] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);

  const { data: apiConfigs, isLoading } = useQuery({
    queryKey: ["api-configurations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_configurations")
        .select("*")
        .order("platform");
      
      if (error) throw error;
      return data as ApiConfig[];
    },
    enabled: isAdmin
  });

  const upsertConfigMutation = useMutation({
    mutationFn: async ({ platform, values }: { platform: string; values: Record<string, string> }) => {
      const existingConfig = apiConfigs?.find(c => c.platform === platform);
      
      if (existingConfig) {
        const { error } = await supabase
          .from("api_configurations")
          .update({
            api_key: values.api_key || null,
            api_secret: values.api_secret || null,
            access_token: values.access_token || null,
            verified_status: "pending",
            updated_at: new Date().toISOString()
          })
          .eq("id", existingConfig.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("api_configurations")
          .insert({
            platform,
            api_key: values.api_key || null,
            api_secret: values.api_secret || null,
            access_token: values.access_token || null,
            verified_status: "pending"
          });
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-configurations"] });
      toast.success("Configuração salva com sucesso!");
      setEditingPlatform(null);
      setFormData({});
    },
    onError: (error) => {
      toast.error("Erro ao salvar configuração: " + error.message);
    }
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("api_configurations")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-configurations"] });
      toast.success("Status atualizado!");
    }
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (platform: string) => {
      setTestingPlatform(platform);
      
      const { data, error } = await supabase.functions.invoke("validate-api-key", {
        body: { platform }
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data, platform) => {
      queryClient.invalidateQueries({ queryKey: ["api-configurations"] });
      if (data.valid) {
        toast.success(`Conexão com ${platformConfig[platform as keyof typeof platformConfig]?.name} validada!`);
      } else {
        toast.error(`Falha na validação: ${data.message}`);
      }
      setTestingPlatform(null);
    },
    onError: (error) => {
      toast.error("Erro ao testar conexão: " + error.message);
      setTestingPlatform(null);
    }
  });

  const getConfigForPlatform = (platform: string) => {
    return apiConfigs?.find(c => c.platform === platform);
  };

  const getStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case "valid":
        return <Badge className="bg-green-500/20 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Válido</Badge>;
      case "invalid":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Inválido</Badge>;
      case "expired":
        return <Badge className="bg-yellow-500/20 text-yellow-600"><AlertCircle className="h-3 w-3 mr-1" />Expirado</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="h-3 w-3 mr-1" />Pendente</Badge>;
    }
  };

  const maskToken = (token: string | null) => {
    if (!token) return "Não configurado";
    return "●".repeat(Math.min(20, token.length)) + token.slice(-4);
  };

  if (adminLoading || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="p-8 text-center">
          <XCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h2 className="text-xl font-semibold">Acesso Negado</h2>
          <p className="text-muted-foreground">Você não tem permissão para acessar esta página.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Key className="h-8 w-8 text-primary" />
          Configuração de APIs
        </h1>
        <p className="text-muted-foreground mt-1">
          Gerencie as integrações com redes sociais e fontes de dados
        </p>
      </div>

      {/* Free Sources Section */}
      <section>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          Fontes Gratuitas (Sem Token Necessário)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {freeSourcesConfig.map((source) => (
            <Card key={source.id} className="border-green-500/30 bg-green-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${source.color}`}>
                      <source.icon className="h-5 w-5 text-white" />
                    </div>
                    <CardTitle className="text-lg">{source.name}</CardTitle>
                  </div>
                  <Badge className="bg-green-500/20 text-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Ativo
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{source.description}</p>
                <p className="text-xs text-muted-foreground/70 mt-2 font-mono truncate">
                  {source.endpoint}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Authenticated APIs Section */}
      <section>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          Redes com Autenticação
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Object.entries(platformConfig).map(([platform, config]) => {
            const existingConfig = getConfigForPlatform(platform);
            const isEditing = editingPlatform === platform;
            const isTesting = testingPlatform === platform;
            
            return (
              <Card key={platform} className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 right-0 h-1 ${config.color}`} />
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${config.color}`}>
                        <config.icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{config.name}</CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {config.description}
                        </CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(existingConfig?.verified_status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isEditing ? (
                    <div className="space-y-4">
                      {config.fields.map((field) => (
                        <div key={field.key} className="space-y-2">
                          <Label>{field.label}</Label>
                          <div className="relative">
                            <Input
                              type={showTokens[field.key] ? "text" : "password"}
                              placeholder={field.placeholder}
                              value={formData[field.key] || ""}
                              onChange={(e) => setFormData({...formData, [field.key]: e.target.value})}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-2 top-1/2 -translate-y-1/2"
                              onClick={() => setShowTokens({...showTokens, [field.key]: !showTokens[field.key]})}
                            >
                              {showTokens[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Button 
                          onClick={() => upsertConfigMutation.mutate({ platform, values: formData })}
                          disabled={upsertConfigMutation.isPending}
                        >
                          {upsertConfigMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Salvar
                        </Button>
                        <Button variant="outline" onClick={() => { setEditingPlatform(null); setFormData({}); }}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {config.fields.map((field) => (
                        <div key={field.key} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{field.label}:</span>
                          <span className="font-mono text-xs">
                            {maskToken(existingConfig?.[field.key as keyof ApiConfig] as string)}
                          </span>
                        </div>
                      ))}
                      
                      {existingConfig?.error_message && (
                        <div className="p-2 bg-destructive/10 rounded text-xs text-destructive">
                          {existingConfig.error_message}
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={existingConfig?.is_active || false}
                            onCheckedChange={(checked) => {
                              if (existingConfig) {
                                toggleActiveMutation.mutate({ id: existingConfig.id, isActive: checked });
                              }
                            }}
                            disabled={!existingConfig || existingConfig.verified_status !== "valid"}
                          />
                          <span className="text-sm text-muted-foreground">
                            {existingConfig?.is_active ? "Ativo" : "Inativo"}
                          </span>
                        </div>
                        
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => testConnectionMutation.mutate(platform)}
                            disabled={!existingConfig || isTesting}
                          >
                            {isTesting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                            <span className="ml-1 hidden sm:inline">Testar</span>
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              setEditingPlatform(platform);
                              if (existingConfig) {
                                setFormData({
                                  api_key: existingConfig.api_key || "",
                                  api_secret: existingConfig.api_secret || "",
                                  access_token: existingConfig.access_token || ""
                                });
                              }
                            }}
                          >
                            {existingConfig ? "Editar" : "Configurar"}
                          </Button>
                        </div>
                      </div>
                      
                      {existingConfig?.last_verified_at && (
                        <p className="text-xs text-muted-foreground">
                          Última verificação: {new Date(existingConfig.last_verified_at).toLocaleString("pt-BR")}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Collection Stats */}
      <section>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" />
          Resumo de Coleta
        </h2>
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-primary">
                  {apiConfigs?.filter(c => c.is_active).length || 0}
                </p>
                <p className="text-sm text-muted-foreground">APIs Ativas</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-500">3</p>
                <p className="text-sm text-muted-foreground">Fontes Gratuitas</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-500">
                  {apiConfigs?.filter(c => c.verified_status === "pending").length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Pendentes</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-destructive">
                  {apiConfigs?.filter(c => c.verified_status === "invalid").length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Com Erro</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

export default AdminApiSettings;