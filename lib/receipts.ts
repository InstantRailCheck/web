// Pure "what did my report just accomplish" builder for the two submission
// Server Actions (submitRouteReport, submitEddReport) — no "server-only"/
// Supabase import here, same discipline as lib/eddOpportunities.ts, so this
// stays fully unit-testable and the before/after math can never accidentally
// depend on a live query instead of the authoritative snapshot the caller
// already fetched.
import { computeRouteEvidence, EVIDENCE_LABELS, type EvidenceState, type RouteReportInput } from "@/lib/routeConfidence";
import { EDD_MIN_REPORTERS, dedupeEddReportsByReporterAndBank, type EddReportRow } from "@/lib/bankProfile";
import { EDD_LEADERBOARD_MIN_REPORTERS } from "@/lib/eddLeaderboard";

export type RouteReportReceipt = {
  isRepeatReporter: boolean;
  fulfilledRequestCount: number;
  evidenceBeforeState: EvidenceState | null;
  evidenceAfterState: EvidenceState;
  lines: string[];
};

function fulfilledRequestLine(count: number): string | null {
  if (count <= 0) return null;
  return `Your report fulfilled ${count} open route request${count !== 1 ? "s" : ""}.`;
}

export function buildRouteReportReceipt(params: {
  beforeReports: RouteReportInput[];
  newReport: RouteReportInput;
  fulfilledRequestCount: number;
  now?: Date;
}): RouteReportReceipt {
  const { beforeReports, newReport, fulfilledRequestCount, now } = params;
  const isRepeatReporter = beforeReports.some((r) => r.userId === newReport.userId);

  const evidenceBefore = computeRouteEvidence(beforeReports, now);
  const evidenceAfter = computeRouteEvidence([...beforeReports, newReport], now);
  // newReport is always attributable (userId is always non-null for a
  // signed-in submission), so the combined set can never be empty evidence.
  if (!evidenceAfter) throw new Error("buildRouteReportReceipt: evidenceAfter must never be null");

  const lines: string[] = [];
  const fulfilledLine = fulfilledRequestLine(fulfilledRequestCount);
  if (fulfilledLine) lines.push(fulfilledLine);

  const stateChanged = evidenceBefore !== null && evidenceBefore.state !== evidenceAfter.state;

  if (isRepeatReporter) {
    lines.push("Your evidence for this route was updated.");
    if (stateChanged) {
      lines.push(
        `This route's status changed from ${EVIDENCE_LABELS[evidenceBefore!.state]} to ${EVIDENCE_LABELS[evidenceAfter.state]}.`
      );
    }
  } else if (evidenceBefore === null) {
    lines.push(`This route now has evidence: ${EVIDENCE_LABELS[evidenceAfter.state]}.`);
  } else if (stateChanged) {
    lines.push(`This route advanced from ${EVIDENCE_LABELS[evidenceBefore.state]} to ${EVIDENCE_LABELS[evidenceAfter.state]}.`);
  }

  if (lines.length === 0) {
    lines.push(`Thanks — this route still shows: ${EVIDENCE_LABELS[evidenceAfter.state]}.`);
  }

  return {
    isRepeatReporter,
    fulfilledRequestCount,
    evidenceBeforeState: evidenceBefore?.state ?? null,
    evidenceAfterState: evidenceAfter.state,
    lines,
  };
}

export type EddReportReceipt = {
  isRepeatReporter: boolean;
  contributorCountBefore: number;
  contributorCountAfter: number;
  crossedVisibility: boolean;
  crossedLeaderboard: boolean;
  lines: string[];
};

export function buildEddReportReceipt(params: {
  beforeReports: EddReportRow[];
  newReport: EddReportRow;
}): EddReportReceipt {
  const { beforeReports, newReport } = params;
  const isRepeatReporter = beforeReports.some((r) => r.user_id === newReport.user_id);

  const contributorCountBefore = dedupeEddReportsByReporterAndBank(beforeReports).length;
  const contributorCountAfter = dedupeEddReportsByReporterAndBank([...beforeReports, newReport]).length;

  const crossedVisibility = contributorCountBefore < EDD_MIN_REPORTERS && contributorCountAfter >= EDD_MIN_REPORTERS;
  const crossedLeaderboard =
    contributorCountBefore < EDD_LEADERBOARD_MIN_REPORTERS && contributorCountAfter >= EDD_LEADERBOARD_MIN_REPORTERS;

  const lines: string[] = [];
  if (isRepeatReporter) {
    lines.push("Your EDD evidence for this bank was updated.");
  } else if (crossedVisibility) {
    lines.push("EDD evidence is now visible on this bank's profile.");
  } else if (crossedLeaderboard) {
    lines.push("This bank now qualifies for the Early Direct Deposit leaderboard.");
  } else if (contributorCountAfter < EDD_LEADERBOARD_MIN_REPORTERS) {
    lines.push(
      `This bank now has ${contributorCountAfter} of ${EDD_LEADERBOARD_MIN_REPORTERS} distinct contributors needed for leaderboard eligibility.`
    );
  } else {
    lines.push("Thanks — your report adds to this bank's EDD evidence.");
  }

  return {
    isRepeatReporter,
    contributorCountBefore,
    contributorCountAfter,
    crossedVisibility,
    crossedLeaderboard,
    lines,
  };
}
