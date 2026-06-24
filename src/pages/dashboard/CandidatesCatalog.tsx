import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, Loader2, ShieldCheck, Plus } from "lucide-react";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useCatalogSearch, type CatalogFilters as Filters, type CatalogRow } from "@/hooks/useCatalogSearch";
import { CatalogFilters } from "@/components/dashboard/CatalogFilters";
import { CandidateCatalogCard } from "@/components/dashboard/CandidateCatalogCard";

const POSITIONS: [string, string][] = [
  ["presidente", "Presidente"], ["vice_presidente", "Vice-presidente"],
  ["ministro", "Ministro"], ["governador", "Governador"], ["vice_governador", "Vice-governador"],
  ["senador", "Senador"], ["deputado_federal", "Deputado Federal"],
  ["deputado_estadual", "Deputado Estadual"], ["deputado_distrital", "Deputado Distrital"],
  ["prefeito", "Prefeito"], ["vice_prefeito", "Vice-prefeito"], ["vereador", "Vereador"],
  ["presidente_partido", "Presidente de Partido"], ["ex_candidato", "Ex-candidato"],
];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function CandidatesCatalog() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminCheck();
  const [rawFilters, setRawFilters] = useState<Filters>({ order: "relevance" });
  const debouncedQ = useDebounced(rawFilters.q ?? "", 300);
  const filters = useMemo<Filters>(() => ({ ...rawFilters, q: debouncedQ }), [rawFilters, debouncedQ]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useCatalogSearch(filters);
  const rows = useMemo(() => data?.pages.flatMap((p) => p.rows) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;

  const { data: myCandidates = [] } = useQuery({
    queryKey: ["my-candidates-names"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase.from("candidates").select("full_name").eq("user_id", user.id);
      if (error) throw error;
      return data.map((c) => c.full_name.toLowerCase());
    },
  });

  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("subscriptions").select("*").eq("user_id", user.id).single();
      return data;
    },
  });

  const adoptMutation = useMutation({
    mutationFn: async (candidate: CatalogRow) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const { data: existing } = await supabase.from("candidates").select("id").eq("user_id", user.id);
      if (subscription && existing && existing.length >= subscription.max_candidates) {
        throw new Error(`Limite de ${subscription.max_candidates} candidatos atingido. Faça upgrade do plano.`);
      }
      const region = [candidate.city, candidate.state].filter(Boolean).join(", ") || candidate.region || candidate.state || null;
      const { error } = await supabase.from("candidates").insert({
        user_id: user.id,
        full_name: candidate.full_name,
        party: candidate.party,
        region,
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

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Admin create
  const [addOpen, setAddOpen] = useState(false);
  const [newCand, setNewCand] = useState({
    full_name: "", party: "", party_number: "", position: "", state: "", city: "",
    photo_url: "", description: "", social_media_link: "",
  });

  const createCatalogMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error("Apenas administradores podem adicionar ao catálogo");
      if (!newCand.full_name.trim()) throw new Error("Nome é obrigatório");
      const { error } = await supabase.from("public_candidates_catalog").insert({
        full_name: newCand.full_name.trim(),
        party: newCand.party.trim() || null,
        party_number: newCand.party_number.trim() || null,
        position: newCand.position || null,
        state: newCand.state.trim().toUpperCase() || null,
        city: newCand.city.trim() || null,
        photo_url: newCand.photo_url.trim() || null,
        description: newCand.description.trim() || null,
        social_media_link: newCand.social_media_link.trim() || null,
        is_active: true,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-search"] });
      toast.success("Candidato adicionado ao catálogo público!");
      setAddOpen(false);
      setNewCand({ full_name: "", party: "", party_number: "", position: "", state: "", city: "", photo_url: "", description: "", social_media_link: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8 text-primary" />
            Catálogo de Candidatos
          </h1>
          <p className="text-muted-foreground mt-1">
            Base política nacional — busque, filtre e adicione candidatos ao seu monitoramento
          </p>
        </div>
        {isAdmin && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <ShieldCheck className="h-4 w-4 mr-2" />
                Adicionar ao catálogo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Novo candidato no catálogo público</DialogTitle>
                <DialogDescription>
                  Apenas administradores podem incluir candidatos visíveis a todos os usuários.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nome completo *</Label>
                  <Input value={newCand.full_name} onChange={(e) => setNewCand({ ...newCand, full_name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Cargo</Label>
                    <Select value={newCand.position} onValueChange={(v) => setNewCand({ ...newCand, position: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Partido</Label>
                    <Input value={newCand.party} onChange={(e) => setNewCand({ ...newCand, party: e.target.value })} />
                  </div>
                  <div>
                    <Label>Número do partido</Label>
                    <Input value={newCand.party_number} onChange={(e) => setNewCand({ ...newCand, party_number: e.target.value })} />
                  </div>
                  <div>
                    <Label>UF</Label>
                    <Input maxLength={2} value={newCand.state} onChange={(e) => setNewCand({ ...newCand, state: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <Label>Município</Label>
                    <Input value={newCand.city} onChange={(e) => setNewCand({ ...newCand, city: e.target.value })} />
                  </div>
                  <div>
                    <Label>Foto (URL)</Label>
                    <Input value={newCand.photo_url} onChange={(e) => setNewCand({ ...newCand, photo_url: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Link rede social</Label>
                  <Input value={newCand.social_media_link} onChange={(e) => setNewCand({ ...newCand, social_media_link: e.target.value })} />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Textarea value={newCand.description} onChange={(e) => setNewCand({ ...newCand, description: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
                <Button onClick={() => createCatalogMutation.mutate()} disabled={createCatalogMutation.isPending}>
                  {createCatalogMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <CatalogFilters filters={rawFilters} onChange={setRawFilters} totalResults={isLoading ? undefined : total} />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum candidato encontrado com esses filtros.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((c) => (
              <CandidateCatalogCard
                key={c.id}
                candidate={c}
                alreadyAdded={myCandidates.includes(c.full_name.toLowerCase())}
                isAdding={adoptMutation.isPending && adoptMutation.variables?.id === c.id}
                onAdd={(cand) => adoptMutation.mutate(cand)}
              />
            ))}
          </div>
          <div ref={sentinelRef} className="h-12 flex items-center justify-center">
            {isFetchingNextPage && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            {!hasNextPage && rows.length > 0 && (
              <span className="text-xs text-muted-foreground">Fim dos resultados</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
