// Pure aggregation for /contribute's "EDD opportunities" section — a
// sibling to computeEddLeaderboard (lib/eddLeaderboard.ts), not a
// modification of it. That function deliberately excludes anything below
// EDD_MIN_REPORTERS entirely (a count of 1 is invisible to every existing
// EDD surface); this module exists specifically to surface those
// otherwise-invisible near-threshold banks as actionable opportunities, so
// it must stay a separate function rather than widening the leaderboard's
// own inclusion range. No "server-only"/Supabase import here either, for
// the same reason as eddLeaderboard.ts: this stays fully unit-testable and
// can't accidentally depend on fetch-layer details.
import {
  EDD_MIN_REPORTERS,
  dedupeEddReportsByReporterAndBank,
  type EddReportRow,
} from "@/lib/bankProfile";
import { EDD_LEADERBOARD_MIN_REPORTERS } from "@/lib/eddLeaderboard";

export type EddOpportunityThresholdKind = "visibility" | "ranking";

export type EddOpportunity = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  reportCount: number;
  // How many more reports would cross the next threshold — always >= 1.
  reportsUntilNextThreshold: number;
  // "visibility": the next report would make this bank's EDD evidence
  // trustworthy enough to show at all (crossing EDD_MIN_REPORTERS).
  // "ranking": evidence already shows on the bank's own profile, but the
  // next report(s) would be what's needed to reach the public leaderboard
  // (crossing EDD_LEADERBOARD_MIN_REPORTERS).
  nextThresholdKind: EddOpportunityThresholdKind;
};

export type EddOpportunityBank = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
};

function compareOpportunities(a: EddOpportunity, b: EddOpportunity): number {
  if (a.reportsUntilNextThreshold !== b.reportsUntilNextThreshold) {
    return a.reportsUntilNextThreshold - b.reportsUntilNextThreshold;
  }
  return a.bankName.localeCompare(b.bankName);
}

// A bank with 0 reports isn't an "opportunity" in this sense — there's
// nothing to prioritize over any other bank with no evidence at all, and
// suggesting one would be exactly the invented "popular bank" guessing
// this feature is required to avoid. A bank with >= EDD_LEADERBOARD_MIN_
// REPORTERS is already leaderboard-eligible, so it's no longer a "next
// report matters most here" opportunity either — that range is [1, 4]
// exclusively (EDD_LEADERBOARD_MIN_REPORTERS - 1).
export function computeEddOpportunities(
  rows: EddReportRow[],
  banks: EddOpportunityBank[]
): EddOpportunity[] {
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const attributableRows = dedupeEddReportsByReporterAndBank(rows);

  const rowsByBank = new Map<string, EddReportRow[]>();
  for (const row of attributableRows) {
    const bank = bankById.get(row.bank_id);
    if (!bank || !bank.isActive) continue;
    if (!rowsByBank.has(row.bank_id)) rowsByBank.set(row.bank_id, []);
    rowsByBank.get(row.bank_id)!.push(row);
  }

  const opportunities: EddOpportunity[] = [];

  for (const [bankId, bankRows] of rowsByBank) {
    const reportCount = bankRows.length;
    if (reportCount < 1 || reportCount >= EDD_LEADERBOARD_MIN_REPORTERS) continue;

    const bank = bankById.get(bankId)!;
    const crossesVisibility = reportCount < EDD_MIN_REPORTERS;

    opportunities.push({
      bankId,
      bankSlug: bank.slug,
      bankName: bank.name,
      reportCount,
      reportsUntilNextThreshold: crossesVisibility
        ? EDD_MIN_REPORTERS - reportCount
        : EDD_LEADERBOARD_MIN_REPORTERS - reportCount,
      nextThresholdKind: crossesVisibility ? "visibility" : "ranking",
    });
  }

  return opportunities.sort(compareOpportunities);
}
