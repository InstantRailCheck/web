import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase caps a single select() at 1000 rows by default — banks now has
// 4,000+ rows, so any query needing the full table (e.g. a client-side
// search dropdown) must paginate with .range() or it silently truncates.
export async function fetchAllBanks<T>(supabase: SupabaseClient, columns: string): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select(columns)
      .order("name", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
