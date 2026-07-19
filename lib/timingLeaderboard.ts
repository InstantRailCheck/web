import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dedupeToNewestPerReporter, type ReportStatus } from "@/lib/routeConfidence";

// A timing-leaderboard-specific claim ("fastest confirmed settlement"),
// deliberately not shared with EDD_MIN_REPORTERS or communityRails.ts's
// rail-ranking threshold even though all three are 2 today — see
// lib/bankProfile.ts's EDD_MIN_REPORTERS comment for why these stay
// independently named.
export const TIMING_MIN_REPORTERS = 2;

const STALE_DAYS = 180;

export type TimingEvidenceLabel = "emerging" | "moderate" | "strong";

// Same sample-size bands as lib/eddLeaderboard.ts's evidence labels
// (defined independently here rather than imported — this module has no
// other reason to depend on the EDD feature, and three numbers aren't
// worth a shared abstraction for). Reflects sample size only, not
// certainty — a below-TIMING_MIN_REPORTERS entry never appears at all, so
// this only ever returns null for the 2-4 reporter range.
export function timingEvidenceLabel(sampleSize: number): TimingEvidenceLabel | null {
  if (sampleSize >= 25) return "strong";
  if (sampleSize >= 10) return "moderate";
  if (sampleSize >= 5) return "emerging";
  return null;
}

export const TIMING_EVIDENCE_LABEL_TEXT: Record<TimingEvidenceLabel, string> = {
  emerging: "Emerging evidence",
  moderate: "Moderate evidence",
  strong: "Strong evidence",
};

// Settlement time is a plain continuous measurement (no censored sentinel
// like EDD's days_early=6), but the median is still the more robust public
// statistic: a single outlier report (e.g. one mistakenly-entered
// multi-day delay) can swing a raw average far more than it swings a
// median, which only cares about relative position, not magnitude.
function medianMinutes(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// "At or below" since a lower settlement time is better here (the inverse
// of EDD's "at or above") — the first ranking tie-breaker: how
// consistently a bank's reports land at or faster than its own typical
// value.
function shareAtOrBelowTypical(values: number[], typical: number): number {
  if (values.length === 0) return 0;
  return values.filter((v) => v <= typical).length / values.length;
}

export type TimingLeaderboardEntry = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  typicalMinutes: number;
  sampleSize: number;
  shareAtOrBelowTypical: number;
  latestObservationDate: string;
  isStale: boolean;
  evidenceLabel: TimingEvidenceLabel | null;
};

export type TimingReportRow = {
  from_bank_id: string;
  from_bank_name: string;
  to_bank_id: string;
  rail_used: string | null;
  status: string;
  settlement_time_minutes: number | null;
  tested_at: string | null;
  user_id: string | null;
};

export type TimingLeaderboardBank = {
  id: string;
  slug: string;
  isActive: boolean;
};

function compareEntries(a: TimingLeaderboardEntry, b: TimingLeaderboardEntry): number {
  const typicalDiff = a.typicalMinutes - b.typicalMinutes; // lower (faster) is better
  if (typicalDiff !== 0) return typicalDiff;
  const shareDiff = b.shareAtOrBelowTypical - a.shareAtOrBelowTypical;
  if (shareDiff !== 0) return shareDiff;
  const countDiff = b.sampleSize - a.sampleSize;
  if (countDiff !== 0) return countDiff;
  return a.bankName.localeCompare(b.bankName);
}

// Pure aggregation, deliberately separated from the Supabase fetch below
// (same "compute vs. fetch" split as lib/eddLeaderboard.ts) so the ranking
// logic is fully unit-testable without a database. Applies the same
// integrity rules as before (dedupe to each reporter's newest report per
// directional route+rail, exclude failed/negative/unattributed rows), plus
// two additions: inactive institutions are now excluded (previously a gap
// — an inactive bank's old reports could still rank), and a deterministic
// tie-break instead of relying on sort stability alone.
export function computeTimingLeaderboard(
  rows: TimingReportRow[],
  banks: TimingLeaderboardBank[],
  now: Date = new Date()
): Record<string, TimingLeaderboardEntry[]> {
  const bankById = new Map(banks.map((b) => [b.id, b]));

  const meaningfulRows = rows.filter(
    (r) => r.status !== "failed" && r.settlement_time_minutes != null && r.settlement_time_minutes >= 0
  );

  const byRoute = new Map<string, TimingReportRow[]>();
  for (const row of meaningfulRows) {
    const key = `${row.from_bank_id}|${row.to_bank_id}|${row.rail_used}`;
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(row);
  }

  const groups = new Map<
    string,
    { bankId: string; bankSlug: string; bankName: string; times: number[]; latestMs: number }
  >();

  for (const routeRows of byRoute.values()) {
    const attributable = dedupeToNewestPerReporter(
      routeRows
        .filter((r): r is TimingReportRow & { tested_at: string } => !!r.tested_at)
        .map((r) => ({ ...r, userId: r.user_id, status: r.status as ReportStatus, testedAt: r.tested_at }))
    );

    for (const row of attributable) {
      const bank = bankById.get(row.from_bank_id);
      if (!bank || !bank.isActive) continue; // inactive/unknown banks never rank

      const rail = row.rail_used || "unknown";
      const key = `${rail}::${row.from_bank_id}`;
      const group = groups.get(key) ?? {
        bankId: row.from_bank_id,
        bankSlug: bank.slug,
        bankName: row.from_bank_name,
        times: [] as number[],
        latestMs: 0,
      };
      group.times.push(row.settlement_time_minutes as number);
      const testedMs = new Date(row.testedAt).getTime();
      if (testedMs > group.latestMs) group.latestMs = testedMs;
      groups.set(key, group);
    }
  }

  const result: Record<string, TimingLeaderboardEntry[]> = {};

  for (const [key, group] of groups) {
    if (group.times.length < TIMING_MIN_REPORTERS) continue;
    const rail = key.split("::")[0];

    const typicalMinutes = medianMinutes(group.times);

    const entry: TimingLeaderboardEntry = {
      bankId: group.bankId,
      bankSlug: group.bankSlug,
      bankName: group.bankName,
      typicalMinutes,
      sampleSize: group.times.length,
      shareAtOrBelowTypical: shareAtOrBelowTypical(group.times, typicalMinutes),
      latestObservationDate: new Date(group.latestMs).toISOString(),
      isStale: (now.getTime() - group.latestMs) / (1000 * 60 * 60 * 24) > STALE_DAYS,
      evidenceLabel: timingEvidenceLabel(group.times.length),
    };

    result[rail] = result[rail] ? [...result[rail], entry] : [entry];
  }

  for (const rail of Object.keys(result)) {
    result[rail].sort(compareEntries);
  }

  return result;
}

// Fetches real route_reports/banks rows and hands them to the pure
// computeTimingLeaderboard above.
export async function getTimingLeaderboard(): Promise<Record<string, TimingLeaderboardEntry[]>> {
  const supabase = createAdminClient();

  const [{ data }, { data: allBanks }] = await Promise.all([
    supabase
      .from("route_reports")
      .select("from_bank_id, from_bank_name, to_bank_id, rail_used, status, settlement_time_minutes, tested_at, user_id")
      .not("settlement_time_minutes", "is", null),
    supabase.from("banks").select("id, slug, is_active"),
  ]);

  const banks = (allBanks ?? []).map((b) => ({ id: b.id, slug: b.slug, isActive: b.is_active }));
  return computeTimingLeaderboard(data ?? [], banks);
}
