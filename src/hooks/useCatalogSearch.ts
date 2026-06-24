import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CatalogFilters {
  q?: string;
  cargo?: string[];
  partido?: string[];
  regiao?: string[];
  estado?: string[];
  municipio?: string;
  onlyEleitos?: boolean;
  page?: number;
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
  ano_eleicao: number | null;
  foto_url: string | null;
  redes_sociais: Record<string, string> | null;
  popularidade: number;
  similarity: number;
  total_count: number;
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
  };
  console.log("TSE Query", payload);
  const params = new URLSearchParams();
  if (payload.q) params.set("q", payload.q);
  if (payload.cargo?.length) params.set("cargo", payload.cargo.join(","));
  if (payload.partido?.length) params.set("partido", payload.partido.join(","));
  if (payload.regiao?.length) params.set("regiao", payload.regiao.join(","));
  if (payload.estado?.length) params.set("estado", payload.estado.join(","));
  if (payload.municipio) params.set("municipio", payload.municipio);
  if (payload.onlyEleitos) params.set("somenteEleitos", "true");
  params.set("page", String(payload.page));

  const { data, error } = await supabase.functions.invoke(`tse-search?${params.toString()}`, { method: "GET" });
  if (error) throw error;

  const rows = (data?.rows ?? []) as PoliticianRow[];
  console.log("TSE Results", rows.length);
  return {
    rows,
    total: Number(data?.total ?? 0),
    suggestions: (data?.suggestions ?? []) as Suggestion[],
    normalized: (data?.normalized ?? {}) as Record<string, string>,
    notice: (data?.message ?? data?.notice ?? null) as string | null,
    fallback: !!data?.fallback,
    page: data?.page ?? 0,
  };
}

export function useCatalogSearch(filters: CatalogFilters) {
  return useQuery({
    queryKey: ["tse-search", filters],
    queryFn: () => searchTSECandidates(filters),
    staleTime: 60_000,
  });
}
