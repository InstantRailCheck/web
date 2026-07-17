import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase caps a single select() at 1000 rows by default — banks now has
// 4,000+ rows, so any query needing the full table (e.g. a client-side
// search dropdown) must paginate with .range() or it silently truncates.
//
// Ordering by name alone is unsafe once duplicate names are permitted
// (v8.0) — Postgres doesn't guarantee stable ordering among equal keys
// across separate paginated queries without a secondary sort key, so a
// duplicate-name group could be split unpredictably across page
// boundaries (a row skipped on one page, or returned on two). id is
// already unique and already selected everywhere name is, so it's a free
// tiebreaker.
export async function fetchAllBanks<T>(supabase: SupabaseClient, columns: string): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select(columns)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
