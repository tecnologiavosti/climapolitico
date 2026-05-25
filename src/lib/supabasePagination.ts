import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";

/**
 * Pagina automaticamente qualquer query do PostgREST (limite Supabase = 1000/req).
 * Use sem .range() / .limit() no builder — a função adiciona internamente.
 *
 * Ex.:
 *   await fetchAllPaginated<Row>((from, to) =>
 *     supabase.from("social_interactions").select("id,sentiment_label")
 *       .eq("user_id", userId).range(from, to)
 *   );
 */
export async function fetchAllPaginated<T = any>(
  build: (from: number, to: number) => any,
  pageSize = 1000,
  hardCap = 500_000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (all.length < hardCap) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function countRows(
  build: () => any,
): Promise<number> {
  const { count, error } = await build();
  if (error) throw error;
  return count ?? 0;
}
