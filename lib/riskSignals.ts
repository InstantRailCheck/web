// Pure, DB-free risk-signal evaluators for the admin triage queue
// (lib/riskTriage.ts). Every function here takes already-fetched
// comparison data and returns named, explainable reasons — never a single
// opaque score. These are review signals, not proof of abuse: nothing here
// deletes content, restricts an account, or asserts a report is false.
//
// Kept deliberately free of any Supabase/DB import so every signal can be
// unit-tested with plain object fixtures and is trivially deterministic.

import { FRESHNESS_WINDOW_DAYS, computeRouteEvidence, type ReportStatus } from "@/lib/routeConfidence";

export type Severity = "info" | "warning" | "high";

export type SignalType =
  | "velocity"
  | "new_reporter_high_volume"
  | "duplicate"
  | "consensus_conflict"
  | "settlement_time_outlier"
  | "moderation_history"
  | "official_source_mismatch";

export type Signal = {
  signal: SignalType;
  severity: Severity;
  reason: string;
};

// Sort-order weight only — the UI always renders every fired reason
// regardless of score, never the score by itself.
export const SIGNAL_WEIGHTS: Record<Severity, number> = { high: 3, warning: 2, info: 1 };

export function scoreOf(signals: Signal[]): number {
  return signals.reduce((sum, s) => sum + SIGNAL_WEIGHTS[s.severity], 0);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------
// 1 & 2. Velocity / new-reporter-high-volume
// ---------------------------------------------------------------------

export type VelocityInput = {
  tableLabel: "route report" | "EDD report";
  candidateCreatedAt: string;
  // This user's OTHER created_at timestamps in the same table, any age —
  // the window filtering happens inside this function so callers can pass
  // one unfiltered fetch and reuse it for every candidate from that user.
  sameUserOtherTimestamps: string[];
  // Total rows by this user across BOTH route_reports and edd_reports,
  // all time, excluding the candidate itself — used only to distinguish
  // "new reporter" from an established account having an unusual day.
  userTotalRowsExcludingCandidate: number;
};

// No "now" parameter — velocity only compares relative offsets between the
// candidate and its own account's other timestamps, never against wall-
// clock time, so there is nothing for a reference date to do here (unlike
// the freshness-window signals below, which do need one).
export function evaluateVelocity(input: VelocityInput): Signal | null {
  const candidateMs = new Date(input.candidateCreatedAt).getTime();
  const otherMs = input.sameUserOtherTimestamps.map((t) => new Date(t).getTime());

  // Symmetric window (before AND after the candidate), not just prior
  // submissions: this runs retrospectively in the triage queue, not as an
  // insert-time trigger, so every member of a tight cluster of submissions
  // should read as part of the same burst regardless of which one happened
  // to land first.
  const within = (windowMs: number) => otherMs.filter((t) => Math.abs(candidateMs - t) < windowMs).length + 1;

  const burst1h = within(HOUR_MS);
  const burst24h = within(DAY_MS);

  const veteranRows = input.userTotalRowsExcludingCandidate - (burst24h - 1);
  if (veteranRows <= 2 && burst24h >= 3) {
    return {
      signal: "new_reporter_high_volume",
      severity: "high",
      reason: `New reporter (${Math.max(veteranRows, 0)} prior submission${veteranRows === 1 ? "" : "s"}) submitted ${burst24h} ${input.tableLabel}s in the last 24 hours.`,
    };
  }

  if (burst1h >= 3) {
    return {
      signal: "velocity",
      severity: "high",
      reason: `${burst1h} ${input.tableLabel}s from this account in the last hour.`,
    };
  }

  if (burst24h >= 5) {
    return {
      signal: "velocity",
      severity: "warning",
      reason: `${burst24h} ${input.tableLabel}s from this account in the last 24 hours.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------
// 3. Exact/near-duplicate
// ---------------------------------------------------------------------

export type RouteReportKey = {
  id: string;
  fromBankId: string | null;
  toBankId: string | null;
  direction: string | null;
  railUsed: string | null;
  status: string;
  testedAt: string; // ISO date
  createdAt: string; // ISO timestamp
};

export function evaluateDuplicateRouteReport(
  candidate: RouteReportKey,
  sameUserOtherReports: RouteReportKey[],
  now: Date = new Date()
): Signal | null {
  const cutoffMs = new Date(now).getTime() - FRESHNESS_WINDOW_DAYS * DAY_MS;
  const matches = sameUserOtherReports.filter(
    (r) =>
      r.id !== candidate.id &&
      r.fromBankId === candidate.fromBankId &&
      r.toBankId === candidate.toBankId &&
      r.direction === candidate.direction &&
      r.railUsed === candidate.railUsed &&
      r.status === candidate.status &&
      new Date(r.createdAt).getTime() >= cutoffMs
  );

  if (matches.length === 0) return null;

  const dates = matches.map((m) => m.testedAt).sort();
  return {
    signal: "duplicate",
    severity: matches.length >= 2 ? "high" : "warning",
    reason: `Same account submitted the identical route/rail/outcome ${matches.length} other time${matches.length === 1 ? "" : "s"} in the last ${FRESHNESS_WINDOW_DAYS} days (${dates.join(", ")}).`,
  };
}

export type EddReportKey = {
  id: string;
  bankId: string;
  daysEarly: number;
  createdAt: string;
};

export function evaluateDuplicateEddReport(
  candidate: EddReportKey,
  sameUserOtherReports: EddReportKey[],
  now: Date = new Date()
): Signal | null {
  const cutoffMs = new Date(now).getTime() - FRESHNESS_WINDOW_DAYS * DAY_MS;
  const matches = sameUserOtherReports.filter(
    (r) =>
      r.id !== candidate.id &&
      r.bankId === candidate.bankId &&
      r.daysEarly === candidate.daysEarly &&
      new Date(r.createdAt).getTime() >= cutoffMs
  );

  if (matches.length === 0) return null;

  return {
    signal: "duplicate",
    severity: matches.length >= 2 ? "high" : "warning",
    reason: `Same account submitted the identical EDD claim for this bank ${matches.length} other time${matches.length === 1 ? "" : "s"} in the last ${FRESHNESS_WINDOW_DAYS} days.`,
  };
}

// ---------------------------------------------------------------------
// 4. Consensus conflict (route_reports only) — reuses routeConfidence.ts's
//    own dedupe/evidence functions unmodified, never reimplements them.
// ---------------------------------------------------------------------

export type ConsensusCandidate = {
  userId: string;
  status: ReportStatus;
  testedAt: string;
};

// A settled baseline the request explicitly treats as strong enough to be
// worth flagging a disagreement against. limited_evidence/conflicting/
// no-evidence baselines never reach this — the whole point is "a single
// disagreement on a low-data route must not be over-flagged."
const SETTLED_BASELINE_STATES = new Set(["consistently_reported", "observed_working", "reported_unsuccessful", "reported_delayed"]);
const ALL_SUCCESS_BASELINES = new Set(["consistently_reported", "observed_working"]);

export function evaluateConsensusConflict(
  candidate: ConsensusCandidate,
  otherReportsSameRouteAndRail: ConsensusCandidate[],
  now: Date = new Date()
): Signal | null {
  const baseline = computeRouteEvidence(otherReportsSameRouteAndRail, now);
  if (!baseline || !SETTLED_BASELINE_STATES.has(baseline.state)) return null;

  const baselineIsAllSuccess = ALL_SUCCESS_BASELINES.has(baseline.state);
  const baselineIsAllFailure = baseline.state === "reported_unsuccessful";

  const disagrees =
    (baselineIsAllSuccess && candidate.status === "failed") || (baselineIsAllFailure && candidate.status === "success");

  if (!disagrees) return null;

  return {
    signal: "consensus_conflict",
    severity: "warning",
    reason: `This report's outcome ("${candidate.status}") conflicts with ${baseline.reportCount} other recent reporter${baseline.reportCount === 1 ? "" : "s"} on the same route and rail ("${baseline.state.replaceAll("_", " ")}"). Timing, account type, and bank-specific limits can all explain a real disagreement — this is a review signal, not proof either report is wrong.`,
  };
}

// ---------------------------------------------------------------------
// 5. Settlement-time outlier (route_reports, status = "success" only)
// ---------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const MAD_CONSISTENCY_CONSTANT = 1.4826;
const MIN_OUTLIER_COMPARISON_POINTS = 4;

export function evaluateSettlementTimeOutlier(candidateMinutes: number, otherSuccessMinutes: number[]): Signal | null {
  if (otherSuccessMinutes.length < MIN_OUTLIER_COMPARISON_POINTS) return null;

  const med = median(otherSuccessMinutes);
  const mad = median(otherSuccessMinutes.map((v) => Math.abs(v - med)));

  const deviation = Math.abs(candidateMinutes - med);
  const threshold = mad > 0 ? 3 * MAD_CONSISTENCY_CONSTANT * mad : Math.max(60, med * 0.5);

  if (deviation <= threshold) return null;

  return {
    signal: "settlement_time_outlier",
    severity: "warning",
    reason: `Settlement time of ${candidateMinutes} minutes is far outside the typical range for this route/rail (median ${Math.round(med)} minutes across ${otherSuccessMinutes.length} other reports).`,
  };
}

// ---------------------------------------------------------------------
// 6. Moderation history
// ---------------------------------------------------------------------

export type ModerationHistorySummary = {
  priorRemovedSubmissions: number;
  priorEnforcementActions: number; // restrict/suspend/ban, all time, historical or current
  currentStatus: "active" | "restricted" | "temporarily_banned" | "permanently_banned";
};

export function evaluateModerationHistory(summary: ModerationHistorySummary): Signal | null {
  if (summary.currentStatus !== "active") {
    return {
      signal: "moderation_history",
      severity: "high",
      reason: `Account is currently ${summary.currentStatus.replaceAll("_", " ")}.`,
    };
  }

  if (summary.priorRemovedSubmissions > 0 || summary.priorEnforcementActions > 0) {
    const parts: string[] = [];
    if (summary.priorRemovedSubmissions > 0) {
      parts.push(`${summary.priorRemovedSubmissions} prior removed submission${summary.priorRemovedSubmissions === 1 ? "" : "s"}`);
    }
    if (summary.priorEnforcementActions > 0) {
      parts.push(`${summary.priorEnforcementActions} prior enforcement action${summary.priorEnforcementActions === 1 ? "" : "s"}`);
    }
    return {
      signal: "moderation_history",
      severity: "warning",
      reason: `Account has ${parts.join(" and ")}.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------
// 7. Official-source mismatch (route_reports, FedNow/RTP only)
// ---------------------------------------------------------------------

export type RailParticipation = {
  fromBankName: string;
  toBankName: string;
  fromBankParticipant: boolean | null;
  toBankParticipant: boolean | null;
};

export function evaluateOfficialSourceMismatch(rail: "FedNow" | "RTP", participation: RailParticipation): Signal | null {
  const nonParticipants: string[] = [];
  if (participation.fromBankParticipant === false) nonParticipants.push(participation.fromBankName);
  if (participation.toBankParticipant === false) nonParticipants.push(participation.toBankName);

  if (nonParticipants.length > 0) {
    return {
      signal: "official_source_mismatch",
      severity: "high",
      reason: `Report claims ${rail} was used, but ${nonParticipants.join(" and ")} ${nonParticipants.length === 1 ? "is" : "are"} not listed as a ${rail} participant in official directory data.`,
    };
  }

  const unknownBanks: string[] = [];
  if (participation.fromBankParticipant === null) unknownBanks.push(participation.fromBankName);
  if (participation.toBankParticipant === null) unknownBanks.push(participation.toBankName);

  if (unknownBanks.length > 0) {
    return {
      signal: "official_source_mismatch",
      severity: "info",
      reason: `Official ${rail} participation data is unavailable for ${unknownBanks.join(" and ")} — this is an absence of data, not evidence the report is wrong.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------
// Aggregation helpers — combine every fired signal for one candidate,
// sorted by severity (high first) then stably by signal name so ordering
// is deterministic given identical input.
// ---------------------------------------------------------------------

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, warning: 1, info: 2 };

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.signal.localeCompare(b.signal));
}
