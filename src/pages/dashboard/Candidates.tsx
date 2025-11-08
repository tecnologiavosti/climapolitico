import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

// Zod validation schema
const candidateSchema = z.object({
  fullName: z.string()
    .trim()
    .min(3, "Nome deve ter no mínimo 3 caracteres")
    .max(100, "Nome deve ter no máximo 100 caracteres"),
  region: z.string()
    .trim()
    .max(50, "Região deve ter no máximo 50 caracteres")
    .optional()
    .or(z.literal("")),
  socialMedia: z.string()
    .trim()
    .refine((val) => !val || val.startsWith("http://") || val.startsWith("https://"), {
      message: "Link deve começar com http:// ou https://"
    })
    .optional()
    .or(z.literal(""))
});

type CandidateFormData = {
  fullName: string;
  region: string;
  socialMedia: string;
};

export default function Candidates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [candidateToDelete, setCandidateToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    fullName: "",
    region: "",
    socialMedia: "",
  });
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Fetch user's subscription
  const { data: subscription } = useQuery({
    queryKey: ['subscription', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id
  });

  // Fetch candidates
  const { data: candidates = [], isLoading, refetch } = useQuery({
    queryKey: ['candidates', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id
  });

  // Add candidate mutation
  const addCandidateMutation = useMutation({
    mutationFn: async (formData: CandidateFormData) => {
      if (!user?.id) throw new Error('Usuário não autenticado');

      // Validate data
      const validatedData = candidateSchema.parse(formData);

      // Check subscription limits
      if (subscription && candidates.length >= subscription.max_candidates) {
        throw new Error(`Limite de ${subscription.max_candidates} candidatos atingido. Faça upgrade do seu plano.`);
      }

      // Insert into database
      const { data, error } = await supabase
        .from('candidates')
        .insert({
          user_id: user.id,
          full_name: validatedData.fullName,
          region: validatedData.region || null,
          social_media_link: validatedData.socialMedia || null
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Sucesso!",
        description: "Candidato adicionado com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      setDialogOpen(false);
      setFormData({ fullName: "", region: "", socialMedia: "" });
      setValidationErrors({});
    },
    onError: (error: Error) => {
      toast({
        title: "Erro",
        description: error.message || "Erro ao adicionar candidato",
        variant: "destructive"
      });
    }
  });

  // Delete candidate mutation
  const deleteCandidateMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      const { error } = await supabase
        .from('candidates')
        .delete()
        .eq('id', candidateId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Sucesso!",
        description: "Candidato removido com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      setDeleteDialogOpen(false);
      setCandidateToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Erro",
        description: error.message || "Erro ao remover candidato",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErrors({});

    try {
      candidateSchema.parse(formData);
      addCandidateMutation.mutate(formData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors: Record<string, string> = {};
        error.issues.forEach((err) => {
          if (err.path[0]) {
            errors[err.path[0].toString()] = err.message;
          }
        });
        setValidationErrors(errors);
      }
    }
  };

  const handleDelete = (candidateId: string) => {
    setCandidateToDelete(candidateId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (candidateToDelete) {
      deleteCandidateMutation.mutate(candidateToDelete);
    }
  };

  const filteredCandidates = candidates.filter((candidate) =>
    candidate.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (candidate.party && candidate.party.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const isLimitReached = subscription && candidates.length >= subscription.max_candidates;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold">Candidatos</h2>
          <p className="text-muted-foreground">
            Gerencie e monitore candidatos políticos
            {subscription && (
              <span className="ml-2 text-sm">
                ({candidates.length} / {subscription.max_candidates} candidatos)
              </span>
            )}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              className="bg-gradient-primary" 
              disabled={isLimitReached}
              title={isLimitReached ? "Limite de candidatos atingido" : ""}
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Candidato
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Adicionar Novo Político</DialogTitle>
              <DialogDescription>
                Insira as informações do político que deseja monitorar
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nome Completo *</Label>
                <Input
                  id="fullName"
                  placeholder="Ex: João Silva"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  disabled={addCandidateMutation.isPending}
                />
                {validationErrors.fullName && (
                  <p className="text-sm text-destructive">{validationErrors.fullName}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="region">Região / Estado</Label>
                <Input
                  id="region"
                  placeholder="Ex: São Paulo, Rio de Janeiro"
                  value={formData.region}
                  onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                  disabled={addCandidateMutation.isPending}
                />
                {validationErrors.region && (
                  <p className="text-sm text-destructive">{validationErrors.region}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="socialMedia">Link de Rede Social</Label>
                <Input
                  id="socialMedia"
                  placeholder="Ex: https://twitter.com/usuario"
                  value={formData.socialMedia}
                  onChange={(e) => setFormData({ ...formData, socialMedia: e.target.value })}
                  disabled={addCandidateMutation.isPending}
                />
                {validationErrors.socialMedia && (
                  <p className="text-sm text-destructive">{validationErrors.socialMedia}</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setDialogOpen(false)}
                  disabled={addCandidateMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  className="bg-gradient-primary"
                  disabled={addCandidateMutation.isPending}
                >
                  {addCandidateMutation.isPending ? "Adicionando..." : "Adicionar"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou partido..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </Card>

      {/* Candidates Table */}
      <Card>
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidato</TableHead>
                <TableHead>Partido</TableHead>
                <TableHead>Menções</TableHead>
                <TableHead>Sentimento</TableHead>
                <TableHead>Tendência</TableHead>
                <TableHead>Seguidores</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCandidates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    {searchTerm 
                      ? "Nenhum candidato encontrado com esse critério de busca"
                      : "Nenhum candidato cadastrado. Adicione seu primeiro candidato!"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCandidates.map((candidate) => (
                  <TableRow key={candidate.id}>
                    <TableCell className="font-medium">{candidate.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{candidate.party || "N/A"}</Badge>
                    </TableCell>
                    <TableCell>{candidate.mentions.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-full max-w-[100px] bg-muted rounded-full h-2">
                          <div
                            className={`h-full rounded-full ${
                              candidate.sentiment >= 60
                                ? "bg-success"
                                : candidate.sentiment >= 40
                                ? "bg-warning"
                                : "bg-destructive"
                            }`}
                            style={{ width: `${candidate.sentiment}%` }}
                          />
                        </div>
                        <span className="text-sm">{candidate.sentiment}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {candidate.trend === "up" ? (
                        <TrendingUp className="h-4 w-4 text-success" />
                      ) : candidate.trend === "down" ? (
                        <TrendingDown className="h-4 w-4 text-destructive" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{candidate.followers || "N/A"}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          candidate.status === "active"
                            ? "bg-success"
                            : "bg-warning"
                        }
                      >
                        {candidate.status === "active" ? "Ativo" : "Monitorando"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleDelete(candidate.id)}
                        disabled={deleteCandidateMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remover
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Remoção</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover este candidato? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCandidateMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteCandidateMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCandidateMutation.isPending ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
