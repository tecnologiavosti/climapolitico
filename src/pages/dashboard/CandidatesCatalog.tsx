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

  const filtered = catalog.filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.party && c.party.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (c.region && c.region.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="h-8 w-8 text-primary" />
          Catálogo de Candidatos
        </h1>
        <p className="text-muted-foreground mt-1">
          Adicione candidatos do catálogo público à sua conta para iniciar o monitoramento
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, partido ou região..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
