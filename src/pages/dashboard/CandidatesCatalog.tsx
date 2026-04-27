import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, Plus, Check, Users, Loader2, ShieldCheck } from "lucide-react";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { HelpTooltip } from "@/components/ui/help-tooltip";

export default function CandidatesCatalog() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const { isAdmin } = useAdminCheck();
  const [addOpen, setAddOpen] = useState(false);
  const [newCand, setNewCand] = useState({
    full_name: "",
    party: "",
    region: "",
    description: "",
    social_media_link: "",
  });

  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ["public-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_candidates_catalog")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: myCandidates = [] } = useQuery({
    queryKey: ["my-candidates-names"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("candidates")
        .select("full_name")
        .eq("user_id", user.id);
      if (error) throw error;
      return data.map((c) => c.full_name.toLowerCase());
    },
  });

  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .single();
      return data;
    },
  });

  const adoptMutation = useMutation({
    mutationFn: async (candidate: typeof catalog[number]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      const { data: existing } = await supabase
        .from("candidates")
        .select("id")
        .eq("user_id", user.id);

      if (subscription && existing && existing.length >= subscription.max_candidates) {
        throw new Error(`Limite de ${subscription.max_candidates} candidatos atingido. Faça upgrade do plano.`);
      }

      const { error } = await supabase.from("candidates").insert({
        user_id: user.id,
        full_name: candidate.full_name,
        party: candidate.party,
        region: candidate.region,
        social_media_link: candidate.social_media_link,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-candidates-names"] });
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      toast.success("Candidato adicionado à sua conta!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Admin-only: adicionar novo candidato ao catálogo público
  const createCatalogMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error("Apenas administradores podem adicionar ao catálogo");
      if (!newCand.full_name.trim()) throw new Error("Nome é obrigatório");
      const { error } = await supabase.from("public_candidates_catalog").insert({
        full_name: newCand.full_name.trim(),
        party: newCand.party.trim() || null,
        region: newCand.region.trim() || null,
        description: newCand.description.trim() || null,
        social_media_link: newCand.social_media_link.trim() || null,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-catalog"] });
      toast.success("Candidato adicionado ao catálogo público!");
      setAddOpen(false);
      setNewCand({ full_name: "", party: "", region: "", description: "", social_media_link: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = catalog.filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.party && c.party.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (c.region && c.region.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8 text-primary" />
            Catálogo de Candidatos
          </h1>
          <p className="text-muted-foreground mt-1">
            Adicione candidatos do catálogo público à sua conta para iniciar o monitoramento
          </p>
        </div>
        {isAdmin && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <HelpTooltip text="Apenas administradores: cadastra um novo candidato no catálogo público para todos os usuários verem.">
                <Button>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Adicionar ao catálogo
                </Button>
              </HelpTooltip>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo candidato no catálogo público</DialogTitle>
                <DialogDescription>
                  Apenas administradores podem incluir candidatos visíveis a todos os usuários.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="cat-name">Nome completo *</Label>
                  <Input
                    id="cat-name"
                    value={newCand.full_name}
                    onChange={(e) => setNewCand({ ...newCand, full_name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cat-party">Partido</Label>
                    <Input
                      id="cat-party"
                      value={newCand.party}
                      onChange={(e) => setNewCand({ ...newCand, party: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cat-region">Região</Label>
                    <Input
                      id="cat-region"
                      value={newCand.region}
                      onChange={(e) => setNewCand({ ...newCand, region: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="cat-social">Link de rede social</Label>
                  <Input
                    id="cat-social"
                    value={newCand.social_media_link}
                    onChange={(e) => setNewCand({ ...newCand, social_media_link: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="cat-desc">Descrição</Label>
                  <Textarea
                    id="cat-desc"
                    value={newCand.description}
                    onChange={(e) => setNewCand({ ...newCand, description: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => createCatalogMutation.mutate()}
                  disabled={createCatalogMutation.isPending}
                >
                  {createCatalogMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <HelpTooltip text="Filtra os candidatos do catálogo por nome, partido ou região conforme você digita.">
              <Input
                placeholder="Buscar por nome, partido ou região..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </HelpTooltip>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum candidato encontrado.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const alreadyAdded = myCandidates.includes(c.full_name.toLowerCase());
            return (
              <Card key={c.id} className="hover-lift transition-all">
                <CardHeader>
                  <CardTitle className="text-lg">{c.full_name}</CardTitle>
                  <CardDescription className="flex flex-wrap gap-2">
                    {c.party && <Badge variant="secondary">{c.party}</Badge>}
                    {c.region && <Badge variant="outline">{c.region}</Badge>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {c.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                  )}
                  <HelpTooltip text={alreadyAdded ? "Esse candidato já está na sua conta. Vá em Candidatos para gerenciá-lo." : "Adiciona o candidato à sua conta para começar a coletar dados e analisar o sentimento."}>
                    <Button
                      className="w-full"
                      variant={alreadyAdded ? "outline" : "default"}
                      disabled={alreadyAdded || adoptMutation.isPending}
                      onClick={() => adoptMutation.mutate(c)}
                    >
                      {adoptMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : alreadyAdded ? (
                        <Check className="h-4 w-4 mr-2" />
                      ) : (
                        <Plus className="h-4 w-4 mr-2" />
                      )}
                      {alreadyAdded ? "Já adicionado" : "Adicionar à minha conta"}
                    </Button>
                  </HelpTooltip>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
