// Route confidence / evidence methodology — see project discussion for the
// full design rationale. Core principle: "blank over wrong." A route with
// sparse or unattributed data should show no claim at all rather than a
// precise-looking number that isn't backed by real, distinct reporters.
//
// Unit of analysis: one directional route (from bank + to bank) + one rail.
// Reverse direction (B->A) is a separate route from A->B.

export type ReportStatus = "success" | "failed" | "delayed";

export type RouteReportInput = {
  userId: string | null;
  status: ReportStatus;
  testedAt: string; // ISO date (YYYY-MM-DD)
};

export type EvidenceState =
  | "limited_evidence"
  | "observed_working"
  | "consistently_reported"
  | "reported_unsuccessful"
  | "reported_delayed"
  | "variable_timing"
  | "conflicting"
  | "previously_observed";

export type RouteEvidence = {
  state: EvidenceState;
  reportCount: number;
  latestObservationDate: string;
  // Only set for limited_evidence, where the single report's own outcome is
  // the entire basis for the label and must be shown alongside it.
  outcome?: ReportStatus;
};

export const FRESHNESS_WINDOW_DAYS = 180;

type DedupedReport<T> = T & { testedAtMs: number };

// Keeps only each reporter's newest report — so one person submitting
// repeatedly can't inflate the reporter count or outvote a single stale
// dissenting report. Generic over T so callers can carry extra fields
// (settlement time, counterparty bank id, etc.) through the dedup step —
// lib/bankProfile.ts's bank-wide rollup relies on this to apply the same
// integrity rule per counterparty route before aggregating.
export function dedupeToNewestPerReporter<T extends { userId: string | null; testedAt: string }>(
  reports: T[]
): DedupedReport<T>[] {
  const newestByReporter = new Map<string, DedupedReport<T>>();
  for (const r of reports) {
    if (r.userId === null) continue; // seed/unattributed rows never count as evidence
    const testedAtMs = new Date(r.testedAt).getTime();
    const existing = newestByReporter.get(r.userId);
    if (!existing || testedAtMs > existing.testedAtMs) {
      newestByReporter.set(r.userId, { ...r, testedAtMs });
    }
  }
  return [...newestByReporter.values()];
}

export function computeRouteEvidence(
  reports: RouteReportInput[],
  now: Date = new Date()
): RouteEvidence | null {
  // 1. Exclude user_id IS NULL. 2. Reduce to each reporter's newest report.
  const attributable = dedupeToNewestPerReporter(reports);

  // 3. If no attributable reports: render no evidence badge.
  if (attributable.length === 0) return null;

  // testedAt is a date-only value (parsed as UTC midnight), so `now` must be
  // truncated to the start of its own UTC day before diffing — otherwise a
  // report exactly 180 calendar days old goes stale as soon as any time
  // passes past midnight on the 180th day, rather than staying fresh for
  // the whole day.
  const nowUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoffMs = nowUtcMidnight - FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const fresh = attributable.filter((r) => r.testedAtMs >= cutoffMs);
  const latestOf = (rs: DedupedReport<RouteReportInput>[]) =>
    rs.reduce((latest, r) => (r.testedAt > latest ? r.testedAt : latest), rs[0].testedAt);

  // 4. If all attributable reports are stale: Previously observed.
  if (fresh.length === 0) {
    return {
      state: "previously_observed",
      reportCount: attributable.length,
      latestObservationDate: latestOf(attributable),
    };
  }

  // 5. If exactly one fresh reporter: Limited evidence, with its outcome shown.
  if (fresh.length === 1) {
    return {
      state: "limited_evidence",
      reportCount: 1,
      latestObservationDate: fresh[0].testedAt,
      outcome: fresh[0].status,
    };
  }

  const successes = fresh.filter((r) => r.status === "success");
  const failures = fresh.filter((r) => r.status === "failed");
  const delays = fresh.filter((r) => r.status === "delayed");
  const latestFresh = latestOf(fresh);

  // 6. If fresh reports include failures plus success or delay: Conflicting.
  if (failures.length > 0 && (successes.length > 0 || delays.length > 0)) {
    return { state: "conflicting", reportCount: fresh.length, latestObservationDate: latestFresh };
  }

  // 7. If all fresh reports failed: Reported unsuccessful.
  if (failures.length === fresh.length) {
    return { state: "reported_unsuccessful", reportCount: fresh.length, latestObservationDate: latestFresh };
  }

  // 8. If all fresh reports were delayed: Reported delayed.
  if (delays.length === fresh.length) {
    return { state: "reported_delayed", reportCount: fresh.length, latestObservationDate: latestFresh };
  }

  // 9. If fresh reports contain success + delayed and no failures: Variable timing.
  if (successes.length > 0 && delays.length > 0) {
    return { state: "variable_timing", reportCount: fresh.length, latestObservationDate: latestFresh };
  }

  // 10. All fresh reports succeeded.
  return {
    state: fresh.length >= 3 ? "consistently_reported" : "observed_working",
    reportCount: fresh.length,
    latestObservationDate: latestFresh,
  };
}

export const EVIDENCE_LABELS: Record<EvidenceState, string> = {
  limited_evidence: "Limited evidence",
  observed_working: "Observed working",
  consistently_reported: "Consistently reported",
  reported_unsuccessful: "Reported unsuccessful",
  reported_delayed: "Reported delayed",
  variable_timing: "Variable timing",
  conflicting: "Conflicting reports",
  previously_observed: "Previously observed",
};
