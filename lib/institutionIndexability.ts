import type { SupabaseClient } from "@supabase/supabase-js";

// v8.0 §10: whether a bank profile page is worth Google indexing at all —
// completing the directory means covering ~8,500 institutions, most of
// which will have no community reports. Indexing every one regardless of
// content would be a programmatic page dump (thin/duplicate content,
// exactly what Google's own guidance warns against), not genuine SEO
// value. A page only qualifies once it clears a real content bar, checked
// identically wherever indexability decisions are made — generateMetadata
// (robots meta tag) and the sitemap builder (an excluded page must also
// never appear in sitemap.xml, or the two send contradictory signals).
export type BankForIndexability = {
  is_active: boolean;
  website: string | null;
  total_assets: number | null;
  fednow_participant: boolean | null;
  rtp_participant: boolean | null;
  zelle_participant: boolean | null;
  aka_names: string[] | null;
};

const MIN_CONTENT_SIGNALS = 2;

export function bankIsIndexable(bank: BankForIndexability, hasAttributableReport: boolean): boolean {
  if (!bank.is_active) return false;

  const signals = [
    !!bank.website,
    bank.total_assets !== null,
    !!(bank.fednow_participant || bank.rtp_participant || bank.zelle_participant),
    !!(bank.aka_names && bank.aka_names.length > 0),
    hasAttributableReport,
  ];

  return signals.filter(Boolean).length >= MIN_CONTENT_SIGNALS;
}

// Single-bank existence check for generateMetadata — a per-page request
// only ever needs this one bank's answer, so a bulk fetch (below) would be
// pure waste here.
export async function hasAttributableReportForBank(supabase: SupabaseClient, bankId: string): Promise<boolean> {
  const [routeReport, eddReport] = await Promise.all([
    supabase
      .from("route_reports")
      .select("id")
      .or(`from_bank_id.eq.${bankId},to_bank_id.eq.${bankId}`)
      .not("user_id", "is", null)
      .limit(1)
      .maybeSingle(),
    supabase.from("edd_reports").select("id").eq("bank_id", bankId).limit(1).maybeSingle(),
  ]);
  return !!routeReport.data || !!eddReport.data;
}

// Bulk existence check for the sitemap builder — one Set<bankId> covering
// every bank with at least one attributable report, built from a real
// database-side existence query (narrow columns, no report content), not
// a full-row transfer or a reimplementation of dedupeToNewestPerReporter —
// existence doesn't need dedup, only counting/averaging does.
export async function fetchBankIdsWithAttributableReport(supabase: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("route_reports")
      .select("from_bank_id, to_bank_id")
      .not("user_id", "is", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ from_bank_id: string | null; to_bank_id: string | null }>) {
      if (row.from_bank_id) ids.add(row.from_bank_id);
      if (row.to_bank_id) ids.add(row.to_bank_id);
    }
    if (!data || data.length < pageSize) break;
  }

  // edd_reports.user_id is NOT NULL — every row is inherently attributable.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("edd_reports")
      .select("bank_id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ bank_id: string }>) {
      ids.add(row.bank_id);
    }
    if (!data || data.length < pageSize) break;
  }

  return ids;
}
