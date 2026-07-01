import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Users, ChevronLeft, ChevronRight, Sparkles, Search, Loader2, UserPlus, UserSearch } from "lucide-react";
import { useCatalogSearch, PAGE_SIZE, type CatalogFilters as Filters, type PoliticianRow } from "@/hooks/useCatalogSearch";
import { CatalogFilters } from "@/components/dashboard/CatalogFilters";
import { CandidateCatalogCard } from "@/components/dashboard/CandidateCatalogCard";
import { AddCandidateDialog, type AddCandidatePayload } from "@/components/dashboard/AddCandidateDialog";

// Mapeia enum interno do catálogo -> label aceito pelo AddCandidateDialog
const CARGO_TO_POSITION: Record<string, string> = {
  presidente: "Presidente",
  vice_presidente: "Vice-presidente",
  governador: "Governador",
  vice_governador: "Vice-governador",
  senador: "Senador",
  deputado_federal: "Deputado Federal",
  deputado_estadual: "Deputado Estadual",
  deputado_distrital: "Deputado Distrital",
  prefeito: "Prefeito",
  vice_prefeito: "Vice-prefeito",
  vereador: "Vereador",
};

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
  const [searchQuery, setSearchQuery] = useState("");
  // Filtros aplicados — só estes disparam a query.
  const [appliedFilters, setAppliedFilters] = useState<Filters | null>(null);
  // Paginação client-side (20 por página) sobre as linhas retornadas pelo backend.
  const [clientPage, setClientPage] = useState(0);
  const CLIENT_PAGE_SIZE = 20;

  const { data, isLoading, isFetching, isSuccess, isError, error } = useCatalogSearch(appliedFilters);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const suggestions = data?.suggestions ?? [];
  const lastUpdated = data?.lastUpdated ?? null;
  const partial = data?.partial ?? false;
  const sources = data?.sources ?? [];
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const page = appliedFilters?.page ?? 0;
  const exactTotal = data?.exactTotal !== false;
  const hasNext = data?.hasMore ?? (page < Math.max(1, Math.ceil(total / PAGE_SIZE)) - 1);
  const totalPages = exactTotal ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : page + (hasNext ? 2 : 1);
  const busy = !!appliedFilters && (isLoading || isFetching);

  const handleSearch = () => {
    console.log("SEARCH CLICK");
    console.log("SEARCH QUERY:", searchQuery);
    const nextFilters = { ...pendingFilters, q: searchQuery.trim(), page: 0 };
    const v = validate(nextFilters);
    console.log("Validation", v);
    if (!v.ok) {
      toast.error(v.message ?? "Filtros inválidos.");
      return;
    }
    const next: Filters = { ...nextFilters, candidateType: nextFilters.candidateType ?? "both" };
    console.log("CATALOG REQUEST:", { candidateType: next.candidateType, cargo: next.cargo, estado: next.estado, municipio: next.municipio, q: next.q });
    setClientPage(0);
    setAppliedFilters(next);
  };

  const handleSearchQueryChange = (value: string) => {
    setSearchQuery(value);
    setPendingFilters((current) => ({ ...current, page: 0, q: value }));
  };

  // Quando o usuário muda o cargo, esconder resultados antigos.
  const handleFiltersChange = (next: Filters) => {
    const prevCargo = pendingFilters.cargo?.[0];
    const newCargo = next.cargo?.[0];
    if ((next.q ?? "") !== searchQuery) {
      setSearchQuery(next.q ?? "");
    }
    setPendingFilters(next);
    setClientPage(0);
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
      const used = (subscription as any)?.candidates_created_total ?? (existing?.length ?? 0);
      if (subscription && used >= subscription.max_candidates) {
        throw new Error(`Limite vitalício de ${subscription.max_candidates} candidatos atingido. Excluir candidatos não restaura créditos — faça upgrade do plano.`);
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
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast.success("Candidato adicionado à sua conta!");
    },
    onError: (e: Error) => toast.error(e.message.includes('candidate_limit_reached') ? 'Limite de candidatos do plano atingido. Faça upgrade para adicionar mais.' : e.message),
  });

  const manualAddMutation = useMutation({
    mutationFn: async (p: AddCandidatePayload) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const { data: existing } = await supabase.from("candidates").select("id").eq("user_id", user.id);
      const used = (subscription as any)?.candidates_created_total ?? (existing?.length ?? 0);
      if (subscription && used >= subscription.max_candidates) {
        throw new Error(`Limite vitalício de ${subscription.max_candidates} candidatos atingido. Excluir candidatos não restaura créditos — faça upgrade do plano.`);
      }
      const region = [p.city, p.state].filter(Boolean).join(", ") || p.region || p.state || null;
      const { error } = await supabase.from("candidates").insert({
        user_id: user.id,
        full_name: p.fullName,
        party: p.party,
        party_name: p.partyName ?? null,
        party_number: p.partyNumber ?? null,
        region,
        social_media_link: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-candidates-names"] });
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["candidates-overview"] });
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast.success("Candidato cadastrado com sucesso!");
      setAddDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dialogInitial = useMemo(() => {
    const cargo = appliedFilters?.cargo?.[0] ?? pendingFilters.cargo?.[0];
    const estado = appliedFilters?.estado?.[0] ?? pendingFilters.estado?.[0];
    const municipio = appliedFilters?.municipio ?? pendingFilters.municipio;
    const q = (appliedFilters?.q ?? searchQuery ?? "").trim();
    return {
      fullName: q,
      position: cargo ? CARGO_TO_POSITION[cargo] : undefined,
      state: estado,
      city: municipio,
    };
  }, [appliedFilters, pendingFilters, searchQuery]);

  const goPage = (p: number) => {
    if (!appliedFilters) return;
    const target = Math.max(0, exactTotal ? Math.min(p, totalPages - 1) : p);
    setAppliedFilters({ ...appliedFilters, page: target });
  };

  const sourceLabel = useMemo(() => {
    if (!sources.length) return null;
    const hasDb = sources.includes("catalog-db");
    const hasTse = sources.some((s) => s.startsWith("tse"));
    const hasWeb = sources.includes("firecrawl") || sources.includes("web") || sources.includes("ai-lookup") || sources.includes("ai_web");
    if (hasDb && !hasTse && !hasWeb) return "Banco TSE";
    if (hasTse && hasWeb) return "TSE + IA + Web";
    if (hasTse) return "TSE";
    if (hasDb) return "Banco TSE";
    return "IA + Web";
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
        searchQuery={searchQuery}
        onSearchQueryChange={handleSearchQueryChange}
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
        <Card className="border-border/60 bg-gradient-to-b from-background to-muted/20 animate-in fade-in-0 zoom-in-95 duration-300">
          <CardContent className="py-16 px-6 text-center">
            <div className="mx-auto max-w-md flex flex-col items-center space-y-5">
              <div className="relative">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/30 to-primary/5 blur-2xl opacity-70" aria-hidden />
                <div className="relative h-20 w-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/[0.04] ring-1 ring-primary/20 flex items-center justify-center shadow-sm">
                  <UserSearch className="h-9 w-9 text-primary" />
                </div>
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xl font-semibold tracking-tight">Não encontramos esse nome nas bases oficiais</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Deseja monitorar essa pessoa como pré-candidato? Nosso sistema vai acompanhar menções e sinais políticos automaticamente.
                </p>
              </div>

              <Button
                size="lg"
                onClick={() => setAddDialogOpen(true)}
                className="rounded-xl px-6 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Adicionar como pré-candidato
              </Button>

              <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-sm">
                Buscamos em TSE, pré-candidatos detectados por IA e web. Figuras locais ou recém-lançadas podem ainda não estar indexadas.
              </p>

              {suggestions.length > 0 && (
                <div className="w-full space-y-2 pt-2 border-t border-border/60">
                  <p className="text-xs flex items-center justify-center gap-1.5 text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Você quis dizer:
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <Button
                        key={s.id}
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() => {
                          const next = { ...pendingFilters, q: s.nome, page: 0 };
                          setSearchQuery(s.nome);
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
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {(() => { console.log("TOTAL RECEBIDO", rows.length); return null; })()}
          {(() => {
            const totalPagesClient = Math.max(1, Math.ceil(rows.length / CLIENT_PAGE_SIZE));
            const safePage = Math.min(clientPage, totalPagesClient - 1);
            const visibleCandidates = rows.slice(safePage * CLIENT_PAGE_SIZE, (safePage + 1) * CLIENT_PAGE_SIZE);
            console.log("TOTAL RENDERIZADO", visibleCandidates.length, "página", safePage + 1, "de", totalPagesClient);
            return (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleCandidates.map((c, idx) => (
                    <CandidateCatalogCard
                      key={`${c.id ?? "row"}-${safePage}-${idx}`}
                      candidate={c}
                      alreadyAdded={myCandidates.includes(c.nome.toLowerCase())}
                      isAdding={adoptMutation.isPending && adoptMutation.variables?.id === c.id}
                      onAdd={(cand) => adoptMutation.mutate(cand)}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">
                    Página {safePage + 1} de {totalPagesClient} · {rows.length} candidato(s){hasNext ? " · há mais resultados no servidor" : ""}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={safePage === 0 || busy}
                      onClick={() => setClientPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
                    </Button>
                    {safePage >= totalPagesClient - 1 && hasNext ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => { setClientPage(0); goPage(page + 1); }}
                      >
                        Próxima página do servidor <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={safePage >= totalPagesClient - 1 || busy}
                        onClick={() => setClientPage((p) => p + 1)}
                      >
                        Próxima <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </>
      )}

      <AddCandidateDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        isPending={manualAddMutation.isPending}
        onSubmit={(payload) => manualAddMutation.mutate(payload)}
        knownNames={myCandidates}
        initialValues={dialogInitial}
      />
    </div>
  );
}
