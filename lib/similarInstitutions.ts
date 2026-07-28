import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const SIMILAR_BANKS_LIMIT = 5;

export type SimilarBankSummary = {
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
};

// Internal linking for bank profile pages: other institutions of the same
// type (source_authority — fdic bank vs ncua credit union, the closest
// existing proxy for "institution type") in the same state. No nationwide
// fallback when state is null — that wouldn't actually be "similar," just a
// different, fabricated relevance claim.
export async function getSimilarBanks(
  bank: { id: string; state: string | null; source_authority: "fdic" | "ncua" | null },
  limit: number = SIMILAR_BANKS_LIMIT
): Promise<SimilarBankSummary[]> {
  if (!bank.state) return [];

  const supabase = createAdminClient();
  let query = supabase
    .from("banks")
    .select("slug, name, city, state")
    .eq("state", bank.state)
    // An active row can never have inactive_reason/merged_into_bank_id set
    // (banks_active_excludes_inactive_fields_check), so this alone excludes
    // both inactive and merged institutions — no separate check needed.
    .eq("is_active", true)
    .neq("id", bank.id)
    .order("total_assets", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(limit);

  query =
    bank.source_authority === null
      ? query.is("source_authority", null)
      : query.eq("source_authority", bank.source_authority);

  const { data } = await query;
  return data ?? [];
}
