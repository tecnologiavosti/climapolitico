import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CandidateTypeFilter = "official" | "pre_candidate" | "both";

export interface CatalogFilters {
  q?: string;
  cargo?: string[];
  partido?: string[];
  regiao?: string[];
  estado?: string[];
  municipio?: string;
  onlyEleitos?: boolean;
  page?: number;
  candidateType?: CandidateTypeFilter;
}

function normalize(str: string | null | undefined) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export interface PoliticianRow {
  id: string;
  tse_id: string | null;
  nome: string;
  nome_urna: string | null;
  partido_sigla: string | null;
  partido_nome: string | null;
  numero_partido: string | null;
  cargo: string | null;
  regiao: string | null;
  estado: string | null;
  municipio: string | null;
  eleito: boolean;
  categoria?: "eleito" | "ex_candidato" | "pre_candidato" | "lideranca_local" | null;
  ano_eleicao: number | null;
  foto_url: string | null;
  redes_sociais: Record<string, string> | null;
  popularidade: number;
  similarity: number;
  total_count: number;
  candidate_type?: "official" | "pre_candidate" | "monitored";
  confidence_score?: number;
  reason?: string | null;
}

export interface Suggestion {
  id: string;
  nome: string;
  partido_sigla: string | null;
  cargo: string | null;
  estado: string | null;
  similarity: number;
  ai_generated?: boolean;
}

export const PAGE_SIZE = 50;

export async function searchTSECandidates(filters: CatalogFilters) {
  const payload = {
    q: filters.q?.trim() || null,
    cargo: filters.cargo?.length ? filters.cargo.map(normalize) : null,
    partido: filters.partido?.length ? filters.partido.map(normalize) : null,
    regiao: filters.regiao?.length ? filters.regiao.map(normalize) : null,
    estado: filters.estado?.length ? filters.estado.map((uf) => uf.toUpperCase()) : null,
    municipio: filters.municipio?.trim() || null,
    onlyEleitos: !!filters.onlyEleitos,
    page: filters.page ?? 0,
    candidateType: filters.candidateType ?? "both",
  };
  console.log("CATALOG HYBRID REQUEST:", payload);

  const { data, error } = await supabase.functions.invoke("catalog-search-hybrid", {
    method: "POST",
    body: payload,
  });
  if (error) throw error;

  const rows = (data?.rows ?? []) as PoliticianRow[];
  console.log("FRONT RECEIVED", rows.length);
  console.log("FRONTEND RAW:", rows.length);
  console.log("FIRST 5 FRONTEND:", rows.slice(0, 5).map((r) => ({
    nome: r.nome, cargo: r.cargo, estado: r.estado, municipio: r.municipio, eleito: r.eleito,
  })));
  console.log("TSE Results", rows.length);
  return {
    rows,
    total: Number(data?.total ?? 0),
    hasMore: !!data?.hasMore,
    exactTotal: data?.exactTotal !== false,
    suggestions: (data?.suggestions ?? []) as Suggestion[],
    normalized: (data?.normalized ?? {}) as Record<string, string>,
    notice: (data?.message ?? data?.notice ?? null) as string | null,
    fallback: !!data?.fallback,
    page: data?.page ?? 0,
    lastUpdated: (data?.last_updated ?? null) as string | null,
    nationalOnly: !!data?.nationalOnly,
    partial: !!data?.partial,
    sources: (data?.sources ?? []) as string[],
  };
}

export function useCatalogSearch(filters: CatalogFilters | null) {
  return useQuery({
    queryKey: ["tse-search", filters],
    queryFn: () => searchTSECandidates(filters as CatalogFilters),
    enabled: !!filters,
    staleTime: 60_000,
  });
}
