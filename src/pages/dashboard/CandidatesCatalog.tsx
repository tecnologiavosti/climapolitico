import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Users, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useCatalogSearch, PAGE_SIZE, type CatalogFilters as Filters, type PoliticianRow } from "@/hooks/useCatalogSearch";
import { CatalogFilters } from "@/components/dashboard/CatalogFilters";
import { CandidateCatalogCard } from "@/components/dashboard/CandidateCatalogCard";

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
  const [rawFilters, setRawFilters] = useState<Filters>({});
  const debouncedQ = useDebounced(rawFilters.q ?? "", 350);
  const debouncedMuni = useDebounced(rawFilters.municipio ?? "", 350);
  const filters = useMemo<Filters>(
    () => ({ ...rawFilters, q: debouncedQ, municipio: debouncedMuni }),
    [rawFilters, debouncedQ, debouncedMuni]
  );

  const { data, isLoading, isFetching, isSuccess } = useCatalogSearch(filters);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const suggestions = data?.suggestions ?? [];
  const normalized = data?.normalized ?? {};
  const notice = data?.notice ?? null;
  const page = filters.page ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const busy = isLoading || isFetching;

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
    mutationFn: async (p: PoliticianRow) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const { data: existing } = await supabase.from("candidates").select("id").eq("user_id", user.id);
      if (subscription && existing && existing.length >= subscription.max_candidates) {
        throw new Error(`Limite de ${subscription.max_candidates} candidatos atingido. Faça upgrade do plano.`);
      }
      const region = [p.municipio, p.estado].filter(Boolean).join(", ") || p.regiao || p.estado || null;
      const social = p.redes_sociais ? (Object.values(p.redes_sociais)[0] as string | undefined) : undefined;
      const { error } = await supabase.from("candidates").insert({
        user_id: user.id,
        full_name: p.nome,
        party: p.partido_sigla,
        region,
        social_media_link: social ?? null,
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

  const goPage = (p: number) => setRawFilters((f) => ({ ...f, page: Math.max(0, Math.min(p, totalPages - 1)) }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="h-8 w-8 text-primary" />
          Catálogo de Candidatos
        </h1>
        <p className="text-muted-foreground mt-1">
          Base nacional de políticos do Brasil — dados oficiais do TSE, atualizados diariamente.
        </p>
      </div>

      <CatalogFilters
        filters={rawFilters}
        onChange={setRawFilters}
        totalResults={isLoading ? undefined : total}
      />

      {Object.keys(normalized).length > 0 && (
        <div className="text-xs text-muted-foreground bg-muted/50 border rounded-md px-3 py-2 flex items-center gap-2">
          <Sparkles className="h-3 w-3 text-primary" />
          IA corrigiu sua busca para:
          {normalized.q && <span className="font-medium text-foreground">"{normalized.q}"</span>}
          {normalized.municipio && <span className="font-medium text-foreground">{normalized.municipio}</span>}
        </div>
      )}


      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">Nenhum político encontrado com esses filtros.</p>
            {suggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm flex items-center justify-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Você quis dizer:
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      variant="outline"
                      onClick={() => setRawFilters({ q: s.nome, page: 0 })}
                    >
                      {s.nome}
                      {s.partido_sigla && <span className="ml-1 text-xs text-muted-foreground">({s.partido_sigla})</span>}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((c) => (
              <CandidateCatalogCard
                key={c.id}
                candidate={c}
                alreadyAdded={myCandidates.includes(c.nome.toLowerCase())}
                isAdding={adoptMutation.isPending && adoptMutation.variables?.id === c.id}
                onAdd={(cand) => adoptMutation.mutate(cand)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              Página {page + 1} de {totalPages.toLocaleString("pt-BR")}
              {isFetching && " · atualizando…"}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0 || isFetching} onClick={() => goPage(page - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages - 1 || isFetching} onClick={() => goPage(page + 1)}>
                Próxima <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
