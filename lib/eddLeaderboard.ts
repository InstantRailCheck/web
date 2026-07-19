// Pure aggregation for the public Early Direct Deposit leaderboard
// (/early-direct-deposit) and its /rails preview — deliberately has no
// "server-only"/Supabase import so it stays fully unit-testable and can't
// accidentally depend on fetch-layer details. lib/communityRails.ts is the
// only caller that fetches real rows and passes them in here; every EDD
// surface that ranks banks (the dedicated page, the /rails preview) must
// go through this one function so the numbers can't drift between them.
import { EDD_DAYS_SENTINEL, EDD_MIN_REPORTERS, dedupeEddReportsByReporterAndBank, type EddReportRow } from "@/lib/bankProfile";

// A credible PUBLIC RANKING claim ("this bank is #4") needs more evidence
// than a bank profile page simply showing that some evidence exists
// (EDD_MIN_REPORTERS). Deliberately a separate constant, not a
// reinterpretation of EDD_MIN_REPORTERS, which keeps its original meaning
// unchanged (the floor for the "Early evidence" unranked section below,
// and for a bank profile's own EddCard).
export const EDD_LEADERBOARD_MIN_REPORTERS = 5;

const STALE_DAYS = 180;

// days_early 0-5 are exact counts; EDD_DAYS_SENTINEL (6) means "more than
// 5 days," an unbounded, unknown-magnitude value. It must never be summed
// or averaged as a literal 6 — every place this module needs a "typical"
// value represents that censoring explicitly instead of guessing at a
// number past the bucket.
export type TypicalValue = { kind: "exact"; days: number } | { kind: "moreThanFive" };

export type EddEvidenceLabel = "emerging" | "moderate" | "strong";

export function eddEvidenceLabel(reportCount: number): EddEvidenceLabel | null {
  if (reportCount >= 25) return "strong";
  if (reportCount >= 10) return "moderate";
  if (reportCount >= EDD_LEADERBOARD_MIN_REPORTERS) return "emerging";
  return null;
}

export const EDD_EVIDENCE_LABEL_TEXT: Record<EddEvidenceLabel, string> = {
  emerging: "Emerging evidence",
  moderate: "Moderate evidence",
  strong: "Strong evidence",
};

// e.g. "2 days: 8 reports" / "More than 5 days early: 3 reports" — bucket 6
// is never rendered as "6 days," only ever as the categorical phrase.
export function distributionBucketLabel(bucket: number): string {
  if (bucket === EDD_DAYS_SENTINEL) return "More than 5 days early";
  if (bucket === 0) return "Not early / same day";
  return `${bucket} day${bucket === 1 ? "" : "s"} early`;
}

export function typicalValueLabel(typical: TypicalValue): string {
  if (typical.kind === "moreThanFive") return "more than 5 days early";
  if (typical.days === 0) return "not early / same day";
  return `${typical.days} day${typical.days === 1 ? "" : "s"} early`;
}

// Sorts numerically ascending. A plain numeric sort is safe here even
// though 6 is censored: "more than 5" is genuinely greater than every real
// 0-5 observation for ORDERING purposes, even though its exact magnitude
// is unknowable — this function is only ever used to find a middle
// position, never to add or divide values.
function ascendingDays(a: number, b: number): number {
  return a - b;
}

// Median of the 0-6 bucket values. If the median would land on, or would
// need to average across, the censored bucket, this returns a categorical
// result instead of fabricating an exact number — per the requirement
// that an interpolated median crossing the censored bucket must fall back
// to a lower-bound/categorical presentation.
export function computeTypicalValue(daysEarly: number[]): TypicalValue {
  const sorted = [...daysEarly].sort(ascendingDays);
  const n = sorted.length;
  const mid = Math.floor(n / 2);

  if (n % 2 === 1) {
    const v = sorted[mid];
    return v === EDD_DAYS_SENTINEL ? { kind: "moreThanFive" } : { kind: "exact", days: v };
  }

  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  // upper is always >= lower after sorting, so if upper is censored the
  // interpolated median either falls squarely on the censored bucket or
  // would require averaging a real number with an unknown one — both
  // cases fall back to the categorical result.
  if (upper === EDD_DAYS_SENTINEL) return { kind: "moreThanFive" };
  return { kind: "exact", days: Math.round((lower + upper) / 2) };
}

// "At or above the typical value" — the first ranking tie-breaker. A
// "more than 5" report always counts as at-or-above any typical value
// (exact or categorical), since it's genuinely >= every real 0-5 value
// and >= the categorical bucket itself.
function shareAtOrAboveTypical(daysEarly: number[], typical: TypicalValue): number {
  if (daysEarly.length === 0) return 0;
  const atOrAbove = daysEarly.filter((d) => {
    if (d === EDD_DAYS_SENTINEL) return true;
    return typical.kind === "exact" && d >= typical.days;
  }).length;
  return atOrAbove / daysEarly.length;
}

// Ordinal rank for sorting only (never used arithmetically) — "more than
// 5" always outranks every exact value.
function typicalSortRank(typical: TypicalValue): number {
  return typical.kind === "moreThanFive" ? EDD_DAYS_SENTINEL : typical.days;
}

export type EddLeaderboardEntry = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  typical: TypicalValue;
  reportCount: number;
  shareAtOrAboveTypical: number;
  // Keys are the 0-6 buckets; a bucket absent from the reports simply
  // isn't a key (the presentation layer treats a missing key as zero).
  distribution: Partial<Record<number, number>>;
  latestReportDate: string;
  isStale: boolean;
  evidenceLabel: EddEvidenceLabel | null;
};

export type EddLeaderboardResult = {
  ranked: EddLeaderboardEntry[];
  earlyEvidence: EddLeaderboardEntry[];
};

export type EddLeaderboardBank = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
};

function compareEntries(a: EddLeaderboardEntry, b: EddLeaderboardEntry): number {
  const typicalDiff = typicalSortRank(b.typical) - typicalSortRank(a.typical);
  if (typicalDiff !== 0) return typicalDiff;
  const shareDiff = b.shareAtOrAboveTypical - a.shareAtOrAboveTypical;
  if (shareDiff !== 0) return shareDiff;
  const countDiff = b.reportCount - a.reportCount;
  if (countDiff !== 0) return countDiff;
  return a.bankName.localeCompare(b.bankName);
}

// Builds the ranked (>= EDD_LEADERBOARD_MIN_REPORTERS) and unranked
// "early evidence" (>= EDD_MIN_REPORTERS but below the leaderboard bar)
// sections shared by /early-direct-deposit and the /rails preview.
// Inactive institutions and anything below EDD_MIN_REPORTERS never appear
// in either list. No recency weighting — every qualifying report counts
// equally regardless of age; latestReportDate/isStale are surfaced
// instead so staleness is visible rather than silently downweighted.
export function computeEddLeaderboard(
  rows: EddReportRow[],
  banks: EddLeaderboardBank[],
  now: Date = new Date()
): EddLeaderboardResult {
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const attributableRows = dedupeEddReportsByReporterAndBank(rows);

  const rowsByBank = new Map<string, EddReportRow[]>();
  for (const row of attributableRows) {
    const bank = bankById.get(row.bank_id);
    if (!bank || !bank.isActive) continue; // inactive/unknown banks never rank
    if (!rowsByBank.has(row.bank_id)) rowsByBank.set(row.bank_id, []);
    rowsByBank.get(row.bank_id)!.push(row);
  }

  const ranked: EddLeaderboardEntry[] = [];
  const earlyEvidence: EddLeaderboardEntry[] = [];

  for (const [bankId, bankRows] of rowsByBank) {
    if (bankRows.length < EDD_MIN_REPORTERS) continue;
    const bank = bankById.get(bankId)!;
    const daysEarly = bankRows.map((r) => r.days_early);
    const typical = computeTypicalValue(daysEarly);

    const distribution: Partial<Record<number, number>> = {};
    for (const d of daysEarly) distribution[d] = (distribution[d] ?? 0) + 1;

    const latestMs = Math.max(...bankRows.map((r) => new Date(r.created_at).getTime()));
    const latestReportDate = new Date(latestMs).toISOString();
    const isStale = (now.getTime() - latestMs) / (1000 * 60 * 60 * 24) > STALE_DAYS;

    const entry: EddLeaderboardEntry = {
      bankId,
      bankSlug: bank.slug,
      bankName: bank.name,
      typical,
      reportCount: bankRows.length,
      shareAtOrAboveTypical: shareAtOrAboveTypical(daysEarly, typical),
      distribution,
      latestReportDate,
      isStale,
      evidenceLabel: eddEvidenceLabel(bankRows.length),
    };

    if (bankRows.length >= EDD_LEADERBOARD_MIN_REPORTERS) ranked.push(entry);
    else earlyEvidence.push(entry);
  }

  ranked.sort(compareEntries);
  earlyEvidence.sort(compareEntries);

  return { ranked, earlyEvidence };
}
