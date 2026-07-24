import { describe, it, expect } from "vitest";

// lib/bankProfile.ts (source of the EDD dedupe helper/constants) has an
// import "server-only" — a no-op guard, same pattern as
// eddOpportunities.test.ts/eddLeaderboard.test.ts.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));

import { buildRouteReportReceipt, buildEddReportReceipt } from "./receipts";
import type { RouteReportInput } from "./routeConfidence";
import type { EddReportRow } from "./bankProfile";

function report(overrides: Partial<RouteReportInput> & { userId: string | null }): RouteReportInput {
  return { status: "success", testedAt: "2026-01-01", ...overrides };
}

// Fixed reference date so "fresh" vs "stale" (the 180-day window) is
// deterministic regardless of when this test actually runs.
const NOW = new Date("2026-01-20T00:00:00Z");

function eddRow(overrides: Partial<EddReportRow> & { bank_id: string }): EddReportRow {
  return {
    user_id: "u1",
    days_early: 1,
    created_at: "2026-01-01T00:00:00Z",
    deposit_type: null,
    payroll_provider: null,
    ...overrides,
  };
}

describe("buildRouteReportReceipt", () => {
  it("frames a route's very first report as 'now has evidence', not a transition", () => {
    const receipt = buildRouteReportReceipt({
      beforeReports: [],
      newReport: report({ userId: "u1", testedAt: "2026-01-01" }),
      fulfilledRequestCount: 0,
      now: NOW,
    });
    expect(receipt.evidenceBeforeState).toBeNull();
    expect(receipt.evidenceAfterState).toBe("limited_evidence");
    expect(receipt.lines).toEqual(["This route now has evidence: Limited evidence."]);
  });

  it("reports a genuine state transition as 'advanced from X to Y'", () => {
    // One prior fresh success (limited_evidence) + a second fresh success
    // from a different reporter tips it to observed_working.
    const receipt = buildRouteReportReceipt({
      beforeReports: [report({ userId: "u1", testedAt: "2026-01-01" })],
      newReport: report({ userId: "u2", testedAt: "2026-01-02" }),
      fulfilledRequestCount: 0,
      now: NOW,
    });
    expect(receipt.evidenceBeforeState).toBe("limited_evidence");
    expect(receipt.evidenceAfterState).toBe("observed_working");
    expect(receipt.lines).toEqual(["This route advanced from Limited evidence to Observed working."]);
  });

  it("tells a repeat reporter their evidence was updated when the aggregate state is unchanged", () => {
    const receipt = buildRouteReportReceipt({
      beforeReports: [
        report({ userId: "u1", testedAt: "2026-01-01", status: "success" }),
        report({ userId: "u2", testedAt: "2026-01-02", status: "success" }),
        report({ userId: "u3", testedAt: "2026-01-03", status: "success" }),
      ],
      newReport: report({ userId: "u1", testedAt: "2026-01-10", status: "success" }),
      fulfilledRequestCount: 0,
      now: NOW,
    });
    expect(receipt.isRepeatReporter).toBe(true);
    // consistently_reported before (3 fresh successes) and after (still 3
    // distinct reporters, u1's just got fresher) — no transition line.
    expect(receipt.evidenceBeforeState).toBe("consistently_reported");
    expect(receipt.evidenceAfterState).toBe("consistently_reported");
    expect(receipt.lines).toEqual(["Your evidence for this route was updated."]);
  });

  it("tells a repeat reporter both that evidence was updated AND the state changed, when their refreshed report flips it", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const receipt = buildRouteReportReceipt({
      // Over 180 days stale as of `now` -> previously_observed.
      beforeReports: [report({ userId: "u1", testedAt: "2025-01-01", status: "success" })],
      // Same reporter, fresh as of `now` -> limited_evidence.
      newReport: report({ userId: "u1", testedAt: "2026-06-01", status: "success" }),
      fulfilledRequestCount: 0,
      now,
    });
    expect(receipt.isRepeatReporter).toBe(true);
    expect(receipt.evidenceBeforeState).toBe("previously_observed");
    expect(receipt.evidenceAfterState).toBe("limited_evidence");
    expect(receipt.lines).toEqual([
      "Your evidence for this route was updated.",
      "This route's status changed from Previously observed to Limited evidence.",
    ]);
  });

  it("never lets a repeat submission double-count as a second distinct reporter", () => {
    const receipt = buildRouteReportReceipt({
      beforeReports: [report({ userId: "u1", testedAt: "2026-01-01" })],
      newReport: report({ userId: "u1", testedAt: "2026-01-15" }),
      fulfilledRequestCount: 0,
      now: NOW,
    });
    // Still only one distinct reporter -> still limited_evidence, not
    // observed_working (which would require 2+ distinct fresh reporters).
    expect(receipt.evidenceAfterState).toBe("limited_evidence");
  });

  it("states the fulfilled-request count with correct singular/plural wording", () => {
    const singular = buildRouteReportReceipt({
      beforeReports: [],
      newReport: report({ userId: "u1" }),
      fulfilledRequestCount: 1,
    });
    expect(singular.lines[0]).toBe("Your report fulfilled 1 open route request.");

    const plural = buildRouteReportReceipt({
      beforeReports: [],
      newReport: report({ userId: "u1" }),
      fulfilledRequestCount: 3,
    });
    expect(plural.lines[0]).toBe("Your report fulfilled 3 open route requests.");
  });

  it("omits the fulfilled-request line entirely when nothing was fulfilled", () => {
    const receipt = buildRouteReportReceipt({
      beforeReports: [],
      newReport: report({ userId: "u1" }),
      fulfilledRequestCount: 0,
    });
    expect(receipt.lines.some((l) => l.includes("fulfilled"))).toBe(false);
  });
});

describe("buildEddReportReceipt", () => {
  it("says evidence is now visible when crossing EDD_MIN_REPORTERS (1 -> 2 distinct contributors)", () => {
    const receipt = buildEddReportReceipt({
      beforeReports: [eddRow({ bank_id: "b1", user_id: "u1" })],
      newReport: eddRow({ bank_id: "b1", user_id: "u2" }),
    });
    expect(receipt.contributorCountBefore).toBe(1);
    expect(receipt.contributorCountAfter).toBe(2);
    expect(receipt.crossedVisibility).toBe(true);
    expect(receipt.lines).toEqual(["EDD evidence is now visible on this bank's profile."]);
  });

  it("says the bank now qualifies for the leaderboard when crossing EDD_LEADERBOARD_MIN_REPORTERS (4 -> 5)", () => {
    const beforeReports = ["u1", "u2", "u3", "u4"].map((u) => eddRow({ bank_id: "b1", user_id: u }));
    const receipt = buildEddReportReceipt({
      beforeReports,
      newReport: eddRow({ bank_id: "b1", user_id: "u5" }),
    });
    expect(receipt.contributorCountBefore).toBe(4);
    expect(receipt.contributorCountAfter).toBe(5);
    expect(receipt.crossedLeaderboard).toBe(true);
    expect(receipt.lines).toEqual(["This bank now qualifies for the Early Direct Deposit leaderboard."]);
  });

  it("shows progress toward leaderboard eligibility (4 of 5) once visible but not yet ranked", () => {
    const beforeReports = ["u1", "u2", "u3"].map((u) => eddRow({ bank_id: "b1", user_id: u }));
    const receipt = buildEddReportReceipt({
      beforeReports,
      newReport: eddRow({ bank_id: "b1", user_id: "u4" }),
    });
    expect(receipt.contributorCountAfter).toBe(4);
    expect(receipt.crossedVisibility).toBe(false);
    expect(receipt.crossedLeaderboard).toBe(false);
    expect(receipt.lines).toEqual([
      "This bank now has 4 of 5 distinct contributors needed for leaderboard eligibility.",
    ]);
  });

  it("never pretends the contributor count increased for a repeat reporter, even at the leaderboard's edge", () => {
    // u1..u4 already reported (4 distinct contributors); u1 resubmits. A
    // naive implementation might see "5th row ever" and claim a crossing —
    // this must not happen, since it's still only 4 distinct reporters.
    const beforeReports = ["u1", "u2", "u3", "u4"].map((u) => eddRow({ bank_id: "b1", user_id: u }));
    const receipt = buildEddReportReceipt({
      beforeReports,
      newReport: eddRow({ bank_id: "b1", user_id: "u1", days_early: 3, created_at: "2026-02-01T00:00:00Z" }),
    });
    expect(receipt.isRepeatReporter).toBe(true);
    expect(receipt.contributorCountBefore).toBe(4);
    expect(receipt.contributorCountAfter).toBe(4);
    expect(receipt.crossedVisibility).toBe(false);
    expect(receipt.crossedLeaderboard).toBe(false);
    expect(receipt.lines).toEqual(["Your EDD evidence for this bank was updated."]);
  });
});
