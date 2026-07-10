import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dedupeToNewestPerReporter, type ReportStatus } from "@/lib/routeConfidence";

// A timing-leaderboard-specific claim ("fastest confirmed settlement"),
// deliberately not shared with EDD_MIN_REPORTERS or communityRails.ts's
// rail-ranking threshold even though all three are 2 today — see
// lib/bankProfile.ts's EDD_MIN_REPORTERS comment for why these stay
// independently named.
const TIMING_MIN_REPORTERS = 2;

export type LeaderboardEntry = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  avgTime: number;
  sampleSize: number;
};

export async function getTimingLeaderboard(): Promise<Record<string, LeaderboardEntry[]>> {
  const supabase = createAdminClient();

  const [{ data }, { data: allBanks }] = await Promise.all([
    supabase
      .from("route_reports")
      .select("from_bank_id, from_bank_name, to_bank_id, rail_used, status, settlement_time_minutes, tested_at, user_id")
      .not("settlement_time_minutes", "is", null),
    supabase.from("banks").select("id, slug"),
  ]);

  const slugById = new Map((allBanks ?? []).map((b) => [b.id, b.slug]));
  type Row = NonNullable<typeof data>[number];

  // A failed transfer has no meaningful settlement time (the money never
  // arrived) even if a stray value got submitted; a negative or otherwise
  // corrupt value isn't a real duration either — both are excluded before
  // anything else runs.
  const meaningfulRows = (data ?? []).filter(
    (r) => r.status !== "failed" && r.settlement_time_minutes != null && r.settlement_time_minutes >= 0
  );

  // Dedupe within each directional route+rail before pooling by (rail,
  // sender bank) — same integrity rule as the rail-ranking and pairwise
  // route evidence: a repeat reporter on one route can't skew the average.
  const byRoute = new Map<string, Row[]>();
  for (const row of meaningfulRows) {
    const key = `${row.from_bank_id}|${row.to_bank_id}|${row.rail_used}`;
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(row);
  }

  const groups = new Map<string, { bankId: string; bankSlug: string; bankName: string; times: number[] }>();

  for (const routeRows of byRoute.values()) {
    const attributable = dedupeToNewestPerReporter(
      routeRows
        .filter((r): r is Row & { tested_at: string } => !!r.tested_at)
        .map((r) => ({ ...r, userId: r.user_id, status: r.status as ReportStatus, testedAt: r.tested_at }))
    );

    for (const row of attributable) {
      const slug = slugById.get(row.from_bank_id);
      if (!slug) continue;

      const rail = row.rail_used || "unknown";
      const key = `${rail}::${row.from_bank_id}`;
      const group = groups.get(key) ?? {
        bankId: row.from_bank_id,
        bankSlug: slug,
        bankName: row.from_bank_name,
        times: [] as number[],
      };
      group.times.push(row.settlement_time_minutes as number);
      groups.set(key, group);
    }
  }

  const result: Record<string, LeaderboardEntry[]> = {};

  for (const [key, group] of groups) {
    const rail = key.split("::")[0];
    if (group.times.length < TIMING_MIN_REPORTERS) continue;

    const avgTime = Math.round(
      group.times.reduce((a, b) => a + b, 0) / group.times.length
    );

    const entry: LeaderboardEntry = {
      bankId: group.bankId,
      bankSlug: group.bankSlug,
      bankName: group.bankName,
      avgTime,
      sampleSize: group.times.length,
    };

    result[rail] = result[rail] ? [...result[rail], entry] : [entry];
  }

  for (const rail of Object.keys(result)) {
    result[rail].sort((a, b) => a.avgTime - b.avgTime);
  }

  return result;
}
