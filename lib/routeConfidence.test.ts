import { describe, it, expect } from "vitest";
import { computeRouteEvidence, dedupeToNewestPerReporter, type RouteReportInput } from "./routeConfidence";

const NOW = new Date("2026-07-10T00:00:00Z");

function daysAgo(days: number): string {
  const d = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

function report(userId: string | null, status: RouteReportInput["status"], testedAt: string): RouteReportInput {
  return { userId, status, testedAt };
}

describe("computeRouteEvidence", () => {
  it("returns null when there are no reports at all", () => {
    expect(computeRouteEvidence([], NOW)).toBeNull();
  });

  it("returns null when every report is unattributed (user_id null)", () => {
    const reports = [report(null, "success", daysAgo(1)), report(null, "success", daysAgo(2))];
    expect(computeRouteEvidence(reports, NOW)).toBeNull();
  });

  it("ignores unattributed rows but still counts attributable ones alongside them", () => {
    const reports = [report(null, "success", daysAgo(1)), report("u1", "success", daysAgo(2))];
    const result = computeRouteEvidence(reports, NOW);
    expect(result?.state).toBe("limited_evidence");
    expect(result?.reportCount).toBe(1);
  });

  it("returns previously_observed when all attributable reports are outside the freshness window", () => {
    const reports = [report("u1", "success", daysAgo(200)), report("u2", "success", daysAgo(190))];
    const result = computeRouteEvidence(reports, NOW);
    expect(result).toEqual({
      state: "previously_observed",
      reportCount: 2,
      latestObservationDate: daysAgo(190),
    });
  });

  it("treats a report exactly at the freshness boundary as fresh", () => {
    const reports = [report("u1", "success", daysAgo(180))];
    const result = computeRouteEvidence(reports, NOW);
    expect(result?.state).toBe("limited_evidence");
  });

  describe("limited_evidence (exactly one fresh reporter)", () => {
    it("shows the outcome for a single successful report", () => {
      const result = computeRouteEvidence([report("u1", "success", daysAgo(1))], NOW);
      expect(result).toEqual({
        state: "limited_evidence",
        reportCount: 1,
        latestObservationDate: daysAgo(1),
        outcome: "success",
      });
    });

    it("shows the outcome for a single unsuccessful report", () => {
      const result = computeRouteEvidence([report("u1", "failed", daysAgo(1))], NOW);
      expect(result?.outcome).toBe("failed");
      expect(result?.state).toBe("limited_evidence");
    });

    it("shows the outcome for a single delayed report", () => {
      const result = computeRouteEvidence([report("u1", "delayed", daysAgo(1))], NOW);
      expect(result?.outcome).toBe("delayed");
      expect(result?.state).toBe("limited_evidence");
    });

    it("dedupes multiple reports from the same reporter down to one, keeping the newest", () => {
      const reports = [
        report("u1", "failed", daysAgo(10)),
        report("u1", "success", daysAgo(1)),
      ];
      const result = computeRouteEvidence(reports, NOW);
      expect(result).toEqual({
        state: "limited_evidence",
        reportCount: 1,
        latestObservationDate: daysAgo(1),
        outcome: "success",
      });
    });
  });

  describe("observed_working / consistently_reported (all fresh reports succeed)", () => {
    it("returns observed_working for exactly two unique successful reporters", () => {
      const reports = [report("u1", "success", daysAgo(1)), report("u2", "success", daysAgo(2))];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("observed_working");
      expect(result?.reportCount).toBe(2);
    });

    it("returns consistently_reported for three or more unique successful reporters", () => {
      const reports = [
        report("u1", "success", daysAgo(1)),
        report("u2", "success", daysAgo(2)),
        report("u3", "success", daysAgo(3)),
      ];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("consistently_reported");
      expect(result?.reportCount).toBe(3);
    });

    it("latestObservationDate reflects the most recent fresh report, not submission order", () => {
      const reports = [
        report("u1", "success", daysAgo(5)),
        report("u2", "success", daysAgo(1)),
        report("u3", "success", daysAgo(3)),
      ];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.latestObservationDate).toBe(daysAgo(1));
    });
  });

  describe("reported_unsuccessful (all fresh reports failed)", () => {
    it("returns reported_unsuccessful when every fresh report is a failure", () => {
      const reports = [report("u1", "failed", daysAgo(1)), report("u2", "failed", daysAgo(2))];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("reported_unsuccessful");
      expect(result?.reportCount).toBe(2);
    });
  });

  describe("reported_delayed (all fresh reports delayed)", () => {
    it("returns reported_delayed when every fresh report is delayed", () => {
      const reports = [report("u1", "delayed", daysAgo(1)), report("u2", "delayed", daysAgo(2))];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("reported_delayed");
      expect(result?.reportCount).toBe(2);
    });
  });

  describe("variable_timing (success + delayed, zero failures)", () => {
    it("returns variable_timing for a mix of success and delayed with no failures", () => {
      const reports = [report("u1", "success", daysAgo(1)), report("u2", "delayed", daysAgo(2))];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("variable_timing");
      expect(result?.reportCount).toBe(2);
    });

    it("still returns variable_timing with three reporters mixing success and delay", () => {
      const reports = [
        report("u1", "success", daysAgo(1)),
        report("u2", "delayed", daysAgo(2)),
        report("u3", "success", daysAgo(3)),
      ];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("variable_timing");
    });
  });

  describe("conflicting (failure alongside success and/or delay)", () => {
    it("returns conflicting for success + failure", () => {
      const reports = [report("u1", "success", daysAgo(1)), report("u2", "failed", daysAgo(2))];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("conflicting");
    });

    it("returns conflicting for delayed + failure", () => {
      const reports = [report("u1", "delayed", daysAgo(1)), report("u2", "failed", daysAgo(2))];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("conflicting");
    });

    it("returns conflicting for success + delayed + failure all present", () => {
      const reports = [
        report("u1", "success", daysAgo(1)),
        report("u2", "delayed", daysAgo(2)),
        report("u3", "failed", daysAgo(3)),
      ];
      const result = computeRouteEvidence(reports, NOW);
      expect(result?.state).toBe("conflicting");
    });
  });

  describe("stale reports don't count toward fresh-state thresholds", () => {
    it("only counts fresh reports even when older attributable ones exist", () => {
      const reports = [
        report("u1", "failed", daysAgo(300)), // stale, should be ignored entirely
        report("u2", "success", daysAgo(1)),
      ];
      const result = computeRouteEvidence(reports, NOW);
      // Only one fresh reporter (u2) — limited_evidence, not conflicting.
      expect(result?.state).toBe("limited_evidence");
      expect(result?.outcome).toBe("success");
    });
  });
});

describe("dedupeToNewestPerReporter", () => {
  it("drops rows with a null userId", () => {
    const reports = [report(null, "success", daysAgo(1)), report("u1", "success", daysAgo(2))];
    expect(dedupeToNewestPerReporter(reports)).toHaveLength(1);
  });

  it("keeps only the newest report per reporter", () => {
    const reports = [
      report("u1", "failed", daysAgo(10)),
      report("u1", "success", daysAgo(1)),
      report("u2", "success", daysAgo(5)),
    ];
    const result = dedupeToNewestPerReporter(reports);
    expect(result).toHaveLength(2);
    const u1Result = result.find((r) => r.userId === "u1");
    expect(u1Result?.status).toBe("success");
  });
});
