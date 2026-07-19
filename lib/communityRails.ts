import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllBanks } from "@/lib/allBanks";
import { dedupeToNewestPerReporter, type ReportStatus } from "@/lib/routeConfidence";
import { computeEddLeaderboard, type EddLeaderboardResult } from "@/lib/eddLeaderboard";

// This is a rail-ranking claim ("banks with the most confirmed successes on
// this rail"), a different product claim from EDD's or timing's — kept as
// its own named threshold rather than sharing EDD_MIN_REPORTERS, even
// though both happen to be 2 today (see lib/bankProfile.ts's EDD_MIN_REPORTERS
// comment on why these are deliberately not unified).
const RAIL_RANKING_MIN_REPORTERS = 2;

export type CommunityRailEntry = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  successCount: number;
};

export async function getCommunityReportedBanks(rail: string): Promise<CommunityRailEntry[]> {
  const supabase = createAdminClient();

  const [{ data }, { data: allBanks }] = await Promise.all([
    supabase
      .from("route_reports")
      .select("from_bank_id, from_bank_name, to_bank_id, status, tested_at, user_id")
      .eq("rail_used", rail),
    supabase.from("banks").select("id, slug"),
  ]);

  const slugById = new Map((allBanks ?? []).map((b) => [b.id, b.slug]));

  type Row = NonNullable<typeof data>[number];

  // Dedupe within each directional route (from+to) before pooling by
  // sender bank — the same integrity rule as the pairwise route evidence
  // and bank-wide rail rollup, applied here so a repeat reporter on one
  // route can't inflate a bank's overall ranking.
  const byRoute = new Map<string, Row[]>();
  for (const row of data ?? []) {
    const key = `${row.from_bank_id}|${row.to_bank_id}`;
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(row);
  }

  const counts = new Map<string, CommunityRailEntry>();
  for (const routeRows of byRoute.values()) {
    const attributable = dedupeToNewestPerReporter(
      routeRows
        .filter((r): r is (typeof routeRows)[number] & { tested_at: string } => !!r.tested_at)
        .map((r) => ({ ...r, userId: r.user_id, status: r.status as ReportStatus, testedAt: r.tested_at }))
    );

    for (const row of attributable) {
      if (row.status !== "success") continue;
      const slug = slugById.get(row.from_bank_id);
      if (!slug) continue;

      const entry = counts.get(row.from_bank_id) ?? {
        bankId: row.from_bank_id,
        bankSlug: slug,
        bankName: row.from_bank_name,
        successCount: 0,
      };
      entry.successCount += 1;
      counts.set(row.from_bank_id, entry);
    }
  }

  return Array.from(counts.values())
    .filter((e) => e.successCount >= RAIL_RANKING_MIN_REPORTERS)
    .sort((a, b) => b.successCount - a.successCount);
}

// Fetches real edd_reports/banks rows and hands them to the shared, pure
// computeEddLeaderboard — the one place both /early-direct-deposit and
// the /rails preview get their ranking from, so the two surfaces can
// never show different numbers for the same underlying evidence.
export async function getEddLeaderboardData(): Promise<EddLeaderboardResult> {
  const supabase = createAdminClient();

  const [{ data: eddRows }, allBanks] = await Promise.all([
    supabase.from("edd_reports").select("bank_id, user_id, days_early, created_at, deposit_type, payroll_provider"),
    fetchAllBanks<{ id: string; slug: string; name: string; is_active: boolean }>(
      supabase,
      "id, slug, name, is_active"
    ),
  ]);

  const banks = allBanks.map((b) => ({ id: b.id, slug: b.slug, name: b.name, isActive: b.is_active }));
  return computeEddLeaderboard(eddRows ?? [], banks);
}
