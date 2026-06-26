import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Users, ChevronLeft, ChevronRight, Sparkles, Search, Loader2 } from "lucide-react";
import { useCatalogSearch, PAGE_SIZE, type CatalogFilters as Filters, type PoliticianRow } from "@/hooks/useCatalogSearch";
import { CatalogFilters } from "@/components/dashboard/CatalogFilters";
import { CandidateCatalogCard } from "@/components/dashboard/CandidateCatalogCard";

// Cargos que exigem estado + município
const REQUIRES_MUNICIPIO = new Set(["prefeito", "vice_prefeito", "vereador"]);
// Cargos estaduais que exigem estado
const REQUIRES_ESTADO = new Set([
  "governador", "vice_governador", "senador",
  "deputado_federal", "deputado_estadual", "deputado_distrital",
]);

function validate(f: Filters): { ok: boolean; message?: string } {
  // Busca por nome ignora filtros mínimos
  if (f.q?.trim()) return { ok: true };
  const cargo = f.cargo?.[0];
  if (!cargo) {
    return { ok: false, message: "Selecione ao menos o cargo ou informe um nome." };
  }
  if (REQUIRES_MUNICIPIO.has(cargo)) {
    if (!f.estado?.[0] || !f.municipio?.trim()) {
      const label = cargo === "vereador" ? "vereadores" : "prefeitos";
      return { ok: false, message: `Para buscar ${label}, selecione estado e município.` };
    }
  }
  if (REQUIRES_ESTADO.has(cargo) && !f.estado?.[0]) {
    return { ok: false, message: "Para buscar este cargo, selecione um estado." };
  }
  return { ok: true };
}

export default function CandidatesCatalog() {
  const queryClient = useQueryClient();
  // Filtros editáveis (UI). NÃO disparam busca.
  const [pendingFilters, setPendingFilters] = useState<Filters>({});
  // Filtros aplicados — só estes disparam a query.
  const [appliedFilters, setAppliedFilters] = useState<Filters | null>(null);

  const { data, isLoading, isFetching, isSuccess, isError, error } = useCatalogSearch(appliedFilters);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const suggestions = data?.suggestions ?? [];
  const lastUpdated = data?.lastUpdated ?? null;
  const partial = data?.partial ?? false;
  const sources = data?.sources ?? [];
  const page = appliedFilters?.page ?? 0;
  const exactTotal = data?.exactTotal !== false;
  const hasNext = data?.hasMore ?? (page < Math.max(1, Math.ceil(total / PAGE_SIZE)) - 1);
  const totalPages = exactTotal ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : page + (hasNext ? 2 : 1);
  const busy = !!appliedFilters && (isLoading || isFetching);

  const handleSearch = () => {
    console.log("SEARCH BUTTON CLICKED");
    console.log("Search query (q):", pendingFilters.q);
    const v = validate(pendingFilters);
    console.log("Validation", v);
    if (!v.ok) {
      toast.error(v.message ?? "Filtros inválidos.");
      return;
    }
    const next = { ...pendingFilters, page: 0 };
    console.log("TSE Query", next);
    setAppliedFilters(next);
  };

  // Quando o usuário muda o cargo, esconder resultados antigos.
  const handleFiltersChange = (next: Filters) => {
    const prevCargo = pendingFilters.cargo?.[0];
    const newCargo = next.cargo?.[0];
    setPendingFilters(next);
    if (prevCargo !== newCargo && appliedFilters) {
      setAppliedFilters(null);
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ["candidates-overview"] });
      toast.success("Candidato adicionado à sua conta!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const goPage = (p: number) => {
    if (!appliedFilters) return;
    const target = Math.max(0, exactTotal ? Math.min(p, totalPages - 1) : p);
    setAppliedFilters({ ...appliedFilters, page: target });
  };

  const sourceLabel = useMemo(() => {
    if (!sources.length) return null;
    const hasTse = sources.some((s) => s.startsWith("tse"));
    const hasWeb = sources.includes("firecrawl");
    if (hasTse && hasWeb) return "TSE + Web";
    if (hasTse) return "TSE";
    return "Web";
  }, [sources]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="h-8 w-8 text-primary" />
          Catálogo de Candidatos
        </h1>
        <p className="text-muted-foreground mt-1">
          Base eleitoral oficial — TSE 2024 (municipal) + 2022 (federal/estadual).
        </p>
      </div>

      <CatalogFilters
        filters={pendingFilters}
        onChange={handleFiltersChange}
        onSubmit={handleSearch}
        disabled={busy}
        totalResults={appliedFilters && isSuccess && exactTotal && !busy ? total : undefined}
      />

      <Button
        size="lg"
        className="w-full"
        onClick={handleSearch}
        disabled={busy}
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Buscando candidatos...
          </>
        ) : (
          <>
            <Search className="h-4 w-4 mr-2" />
            Buscar candidatos
          </>
        )}
      </Button>

      {appliedFilters && sourceLabel && !busy && isSuccess && (
        <div className="flex flex-wrap items-center gap-2 text-xs bg-primary/5 text-primary border border-primary/20 rounded-md px-3 py-2">
          <Sparkles className="h-3 w-3" />
          <span className="font-medium">
            {total.toLocaleString("pt-BR")} candidato(s) encontrado(s). Fonte: {sourceLabel}
          </span>
          {lastUpdated && (
            <span className="text-muted-foreground">
              · {new Date(lastUpdated).toLocaleTimeString("pt-BR")}
            </span>
          )}
        </div>
      )}

      {partial && (
        <div className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 rounded-md px-3 py-2">
          Resultado parcial — o crawler atingiu o tempo limite. Refine pelo município ou estado para coleta completa.
        </div>
      )}

      {!appliedFilters ? (
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <Search className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-medium">Defina os filtros e clique em Buscar candidatos</p>
            <p className="text-xs text-muted-foreground">
              Para prefeito e vereador, selecione estado e município. Para deputado, governador e senador, selecione um estado.
            </p>
          </CardContent>
        </Card>
      ) : busy ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
              <div>
                <p className="text-sm font-semibold">Buscando candidatos no TSE...</p>
                <p className="text-xs text-muted-foreground">Consultando base oficial eleitoral</p>
                <p className="text-xs text-muted-foreground">Isso pode levar alguns segundos</p>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
          </div>
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <p className="text-sm font-medium text-destructive">Erro ao consultar TSE. Tente novamente.</p>
            <p className="text-xs text-muted-foreground">{(error as Error)?.message}</p>
          </CardContent>
        </Card>
      ) : isSuccess && rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">Nenhum candidato encontrado para os filtros selecionados.</p>
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
                      onClick={() => {
                        const next = { ...pendingFilters, q: s.nome, page: 0 };
                        setPendingFilters(next);
                        setAppliedFilters(next);
                      }}
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
              {exactTotal
                ? `Página ${page + 1} de ${totalPages.toLocaleString("pt-BR")}`
                : `Página ${page + 1} · 50 por página${hasNext ? " · há mais resultados" : ""}`}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0 || busy} onClick={() => goPage(page - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={!hasNext || busy} onClick={() => goPage(page + 1)}>
                Próxima <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
