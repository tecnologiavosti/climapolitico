import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CollectionConfigComponent } from "@/components/dashboard/CollectionConfig";
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Play, 
  Pause, 
  Settings, 
  Trash2,
  Plus
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface CollectionConfigData {
  id: string;
  candidate_id: string | null;
  config: any;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function CollectionStatus() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<CollectionConfigData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewConfig, setShowNewConfig] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      const { data, error } = await supabase
        .from("collection_configs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setConfigs(data || []);
    } catch (error) {
      console.error("Error fetching configs:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar as configurações.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("collection_configs")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Status Atualizado",
        description: `A configuração foi ${newStatus === 'active' ? 'ativada' : 'pausada'}.`,
      });

      fetchConfigs();
    } catch (error) {
      console.error("Error updating status:", error);
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o status.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const { error } = await supabase
        .from("collection_configs")
        .delete()
        .eq("id", deleteId);

      if (error) throw error;

      toast({
        title: "Configuração Excluída",
        description: "A configuração foi removida com sucesso.",
      });

      fetchConfigs();
    } catch (error) {
      console.error("Error deleting config:", error);
      toast({
        title: "Erro",
        description: "Não foi possível excluir a configuração.",
        variant: "destructive",
      });
    } finally {
      setDeleteId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500"><CheckCircle2 className="mr-1 h-3 w-3" />Ativa</Badge>;
      case "paused":
        return <Badge variant="secondary"><Pause className="mr-1 h-3 w-3" />Pausada</Badge>;
      case "error":
        return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Erro</Badge>;
      default:
        return <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />Pendente</Badge>;
    }
  };

  if (showNewConfig) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Nova Configuração de Coleta</h1>
            <p className="text-muted-foreground">
              Configure os parâmetros para coleta de dados das redes sociais
            </p>
          </div>
          <Button variant="outline" onClick={() => setShowNewConfig(false)}>
            Voltar
          </Button>
        </div>

        <CollectionConfigComponent
          onSave={() => {
            fetchConfigs();
            setShowNewConfig(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Status das Coletas</h1>
          <p className="text-muted-foreground">
            Gerencie as configurações de coleta de dados das redes sociais
          </p>
        </div>
        <Button onClick={() => setShowNewConfig(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Configuração
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              Carregando configurações...
            </div>
          </CardContent>
        </Card>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <Settings className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">Nenhuma Configuração</h3>
                <p className="text-muted-foreground">
                  Crie sua primeira configuração de coleta para começar a analisar dados
                </p>
              </div>
              <Button onClick={() => setShowNewConfig(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Criar Configuração
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {configs.map((config) => (
            <Card key={config.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">
                      Configuração #{config.id.slice(0, 8)}
                    </CardTitle>
                    <CardDescription>
                      Criada em {format(new Date(config.created_at), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                    </CardDescription>
                  </div>
                  {getStatusBadge(config.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Período:</span>
                    <p className="text-muted-foreground">
                      {config.config.periodStart && format(new Date(config.config.periodStart), "dd/MM/yyyy")} - {config.config.periodEnd && format(new Date(config.config.periodEnd), "dd/MM/yyyy")}
                    </p>
                  </div>
                  <div>
                    <span className="font-medium">Redes Sociais:</span>
                    <p className="text-muted-foreground">
                      {config.config.networks?.length || 0} selecionada(s)
                    </p>
                  </div>
                  <div>
                    <span className="font-medium">Estados:</span>
                    <p className="text-muted-foreground">
                      {config.config.regions?.length || 0} selecionado(s)
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {config.config.networks?.map((network: string) => (
                    <Badge key={network} variant="outline">
                      {network}
                    </Badge>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-4 border-t">
                  {config.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(config.id, "paused")}
                    >
                      <Pause className="mr-2 h-3 w-3" />
                      Pausar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleStatusChange(config.id, "active")}
                    >
                      <Play className="mr-2 h-3 w-3" />
                      Ativar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteId(config.id)}
                  >
                    <Trash2 className="mr-2 h-3 w-3" />
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A configuração de coleta será permanentemente excluída.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
