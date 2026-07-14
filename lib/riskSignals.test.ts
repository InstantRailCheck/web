import { describe, it, expect } from "vitest";
import {
  evaluateVelocity,
  evaluateDuplicateRouteReport,
  evaluateDuplicateEddReport,
  evaluateConsensusConflict,
  evaluateSettlementTimeOutlier,
  evaluateModerationHistory,
  evaluateOfficialSourceMismatch,
  sortSignals,
  scoreOf,
  type RouteReportKey,
  type ConsensusCandidate,
} from "./riskSignals";

const NOW = new Date("2026-07-14T12:00:00.000Z");

describe("evaluateVelocity", () => {
  it("does not flag a normal single submission", () => {
    const result = evaluateVelocity(
      { tableLabel: "route report", candidateCreatedAt: NOW.toISOString(), sameUserOtherTimestamps: [], userTotalRowsExcludingCandidate: 0 }
    );
    expect(result).toBeNull();
  });

  it("does not flag 2 submissions in the last hour (below the threshold of 3)", () => {
    const result = evaluateVelocity(
      {
        tableLabel: "route report",
        candidateCreatedAt: NOW.toISOString(),
        sameUserOtherTimestamps: [new Date(NOW.getTime() - 10 * 60_000).toISOString()],
        userTotalRowsExcludingCandidate: 1,
      }
    );
    expect(result).toBeNull();
  });

  // userTotalRowsExcludingCandidate is deliberately large (an established
  // account) in these three tests so the burst is attributed to plain
  // velocity, not new_reporter_high_volume — that distinction is covered
  // separately below.

  it("flags exactly 3 submissions within the last hour", () => {
    const result = evaluateVelocity(
      {
        tableLabel: "route report",
        candidateCreatedAt: NOW.toISOString(),
        sameUserOtherTimestamps: [
          new Date(NOW.getTime() - 10 * 60_000).toISOString(),
          new Date(NOW.getTime() - 20 * 60_000).toISOString(),
        ],
        userTotalRowsExcludingCandidate: 40,
      }
    );
    expect(result).toEqual({ signal: "velocity", severity: "high", reason: expect.stringContaining("3 route reports") });
  });

  it("flags exactly 5 submissions within 24h (below the 1h threshold)", () => {
    const spaced = [4, 8, 12, 16].map((h) => new Date(NOW.getTime() - h * HOUR()).toISOString());
    const result = evaluateVelocity(
      { tableLabel: "route report", candidateCreatedAt: NOW.toISOString(), sameUserOtherTimestamps: spaced, userTotalRowsExcludingCandidate: 40 }
    );
    expect(result).toEqual({ signal: "velocity", severity: "warning", reason: expect.stringContaining("5 route reports") });
  });

  it("does not flag 4 submissions within 24h (below the threshold of 5)", () => {
    const spaced = [4, 8, 12].map((h) => new Date(NOW.getTime() - h * HOUR()).toISOString());
    const result = evaluateVelocity(
      { tableLabel: "route report", candidateCreatedAt: NOW.toISOString(), sameUserOtherTimestamps: spaced, userTotalRowsExcludingCandidate: 40 }
    );
    expect(result).toBeNull();
  });

  it("flags new-reporter-high-volume instead of generic velocity when the account has almost no history", () => {
    const spaced = [0.1, 0.2].map((h) => new Date(NOW.getTime() - h * HOUR()).toISOString());
    const result = evaluateVelocity(
      { tableLabel: "route report", candidateCreatedAt: NOW.toISOString(), sameUserOtherTimestamps: spaced, userTotalRowsExcludingCandidate: 0 }
    );
    expect(result?.signal).toBe("new_reporter_high_volume");
    expect(result?.severity).toBe("high");
  });

  it("does not flag new-reporter-high-volume for an established account with the same burst", () => {
    const spaced = [0.1, 0.2].map((h) => new Date(NOW.getTime() - h * HOUR()).toISOString());
    const result = evaluateVelocity(
      { tableLabel: "route report", candidateCreatedAt: NOW.toISOString(), sameUserOtherTimestamps: spaced, userTotalRowsExcludingCandidate: 40 }
    );
    // Still a real burst (3 in an hour), just attributed to velocity, not "new reporter".
    expect(result?.signal).toBe("velocity");
  });
});

function HOUR() {
  return 60 * 60 * 1000;
}

describe("evaluateDuplicateRouteReport", () => {
  const base: RouteReportKey = {
    id: "candidate",
    fromBankId: "bank-a",
    toBankId: "bank-b",
    direction: "push",
    railUsed: "ACH",
    status: "success",
    testedAt: "2026-07-14",
    createdAt: NOW.toISOString(),
  };

  it("does not flag when there are no other matching reports", () => {
    expect(evaluateDuplicateRouteReport(base, [], NOW)).toBeNull();
  });

  it("does not flag a different route/rail/outcome from the same user", () => {
    const other: RouteReportKey = { ...base, id: "other", railUsed: "Wire" };
    expect(evaluateDuplicateRouteReport(base, [other], NOW)).toBeNull();
  });

  it("flags an exact repeat within the freshness window", () => {
    const other: RouteReportKey = { ...base, id: "other", testedAt: "2026-07-01" };
    const result = evaluateDuplicateRouteReport(base, [other], NOW);
    expect(result?.signal).toBe("duplicate");
    expect(result?.severity).toBe("warning");
  });

  it("escalates to high severity with 2+ repeats", () => {
    const other1: RouteReportKey = { ...base, id: "other1", testedAt: "2026-07-01" };
    const other2: RouteReportKey = { ...base, id: "other2", testedAt: "2026-07-05" };
    const result = evaluateDuplicateRouteReport(base, [other1, other2], NOW);
    expect(result?.severity).toBe("high");
  });

  it("ignores a repeat older than the freshness window", () => {
    const stale: RouteReportKey = { ...base, id: "stale", createdAt: new Date(NOW.getTime() - 200 * 24 * HOUR()).toISOString() };
    expect(evaluateDuplicateRouteReport(base, [stale], NOW)).toBeNull();
  });

  it("treats reverse direction as a different route, not a duplicate", () => {
    const reversed: RouteReportKey = { ...base, id: "reversed", fromBankId: "bank-b", toBankId: "bank-a" };
    expect(evaluateDuplicateRouteReport(base, [reversed], NOW)).toBeNull();
  });
});

describe("evaluateDuplicateEddReport", () => {
  it("flags an identical EDD claim repeated for the same bank", () => {
    const candidate = { id: "c", bankId: "bank-a", daysEarly: 2, createdAt: NOW.toISOString() };
    const other = { id: "o", bankId: "bank-a", daysEarly: 2, createdAt: NOW.toISOString() };
    expect(evaluateDuplicateEddReport(candidate, [other], NOW)?.signal).toBe("duplicate");
  });

  it("does not flag a different days_early value", () => {
    const candidate = { id: "c", bankId: "bank-a", daysEarly: 2, createdAt: NOW.toISOString() };
    const other = { id: "o", bankId: "bank-a", daysEarly: 1, createdAt: NOW.toISOString() };
    expect(evaluateDuplicateEddReport(candidate, [other], NOW)).toBeNull();
  });
});

describe("evaluateConsensusConflict", () => {
  const settledSuccessBaseline: ConsensusCandidate[] = [
    { userId: "u1", status: "success", testedAt: "2026-07-01" },
    { userId: "u2", status: "success", testedAt: "2026-07-05" },
    { userId: "u3", status: "success", testedAt: "2026-07-10" },
  ];

  it("does not flag a single prior report as a baseline (low-data route)", () => {
    const thin: ConsensusCandidate[] = [{ userId: "u1", status: "success", testedAt: "2026-07-01" }];
    const result = evaluateConsensusConflict({ userId: "candidate", status: "failed", testedAt: "2026-07-14" }, thin, NOW);
    expect(result).toBeNull();
  });

  it("does not flag when the baseline is already conflicting", () => {
    const conflicting: ConsensusCandidate[] = [
      { userId: "u1", status: "success", testedAt: "2026-07-01" },
      { userId: "u2", status: "failed", testedAt: "2026-07-05" },
    ];
    const result = evaluateConsensusConflict({ userId: "candidate", status: "success", testedAt: "2026-07-14" }, conflicting, NOW);
    expect(result).toBeNull();
  });

  it("flags a failed report against a settled all-success baseline", () => {
    const result = evaluateConsensusConflict(
      { userId: "candidate", status: "failed", testedAt: "2026-07-14" },
      settledSuccessBaseline,
      NOW
    );
    expect(result?.signal).toBe("consensus_conflict");
  });

  it("does not flag a success report against a settled all-success baseline", () => {
    const result = evaluateConsensusConflict(
      { userId: "candidate", status: "success", testedAt: "2026-07-14" },
      settledSuccessBaseline,
      NOW
    );
    expect(result).toBeNull();
  });

  it("flags a success report against a settled all-failure baseline", () => {
    const failureBaseline: ConsensusCandidate[] = [
      { userId: "u1", status: "failed", testedAt: "2026-07-01" },
      { userId: "u2", status: "failed", testedAt: "2026-07-05" },
    ];
    const result = evaluateConsensusConflict({ userId: "candidate", status: "success", testedAt: "2026-07-14" }, failureBaseline, NOW);
    expect(result?.signal).toBe("consensus_conflict");
  });

  it("does not let a delayed report cross-contaminate against a same-direction different-rail baseline (rail separation is the caller's job, but delayed alone should not read as a hard conflict)", () => {
    const result = evaluateConsensusConflict(
      { userId: "candidate", status: "delayed", testedAt: "2026-07-14" },
      settledSuccessBaseline,
      NOW
    );
    expect(result).toBeNull();
  });
});

describe("evaluateSettlementTimeOutlier", () => {
  it("does not flag with fewer than 4 comparison points", () => {
    expect(evaluateSettlementTimeOutlier(500, [30, 35, 40])).toBeNull();
  });

  it("does not flag a value within the typical range", () => {
    expect(evaluateSettlementTimeOutlier(35, [30, 32, 34, 36, 38])).toBeNull();
  });

  it("flags a value far outside the robust range", () => {
    const result = evaluateSettlementTimeOutlier(1000, [30, 32, 34, 36, 38]);
    expect(result?.signal).toBe("settlement_time_outlier");
  });

  it("does not let one malicious outlier already in the comparison set distort the median enough to hide a genuine new outlier (robustness check)", () => {
    // One huge existing value can't drag the MAD-based threshold along with it
    // the way a naive mean+stddev would.
    const comparisons = [30, 32, 34, 36, 5000];
    const result = evaluateSettlementTimeOutlier(38, comparisons);
    expect(result).toBeNull(); // 38 is still a normal value near the true cluster
  });

  it("falls back to an absolute+proportional floor when MAD is zero", () => {
    const identical = [30, 30, 30, 30];
    expect(evaluateSettlementTimeOutlier(31, identical)).toBeNull(); // tiny deviation, not flagged
    expect(evaluateSettlementTimeOutlier(200, identical)?.signal).toBe("settlement_time_outlier");
  });
});

describe("evaluateModerationHistory", () => {
  it("does not flag a clean, active account", () => {
    expect(evaluateModerationHistory({ priorRemovedSubmissions: 0, priorEnforcementActions: 0, currentStatus: "active" })).toBeNull();
  });

  it("flags high severity for a currently non-active account", () => {
    const result = evaluateModerationHistory({ priorRemovedSubmissions: 0, priorEnforcementActions: 0, currentStatus: "restricted" });
    expect(result?.severity).toBe("high");
  });

  it("flags warning severity for historical-only enforcement on an active account", () => {
    const result = evaluateModerationHistory({ priorRemovedSubmissions: 1, priorEnforcementActions: 1, currentStatus: "active" });
    expect(result?.severity).toBe("warning");
  });
});

describe("evaluateOfficialSourceMismatch", () => {
  const base = { fromBankName: "Bank A", toBankName: "Bank B", fromBankParticipant: true, toBankParticipant: true };

  it("does not flag when both banks are confirmed participants", () => {
    expect(evaluateOfficialSourceMismatch("FedNow", base)).toBeNull();
  });

  it("flags high severity when a bank is confirmed NOT a participant", () => {
    const result = evaluateOfficialSourceMismatch("FedNow", { ...base, toBankParticipant: false });
    expect(result?.severity).toBe("high");
    expect(result?.reason).toContain("Bank B");
  });

  it("flags only low/info severity when participation data is simply missing, never treated as proof", () => {
    const result = evaluateOfficialSourceMismatch("RTP", { ...base, fromBankParticipant: null });
    expect(result?.severity).toBe("info");
    expect(result?.reason).toContain("unavailable");
  });

  it("prefers the stronger false-participant signal over a simultaneous unknown on the other bank", () => {
    const result = evaluateOfficialSourceMismatch("RTP", { ...base, fromBankParticipant: null, toBankParticipant: false });
    expect(result?.severity).toBe("high");
  });
});

describe("determinism and ordering", () => {
  it("sortSignals produces the same order for the same input every time", () => {
    const signals = [
      { signal: "duplicate" as const, severity: "warning" as const, reason: "a" },
      { signal: "moderation_history" as const, severity: "high" as const, reason: "b" },
      { signal: "velocity" as const, severity: "high" as const, reason: "c" },
    ];
    const first = sortSignals(signals);
    const second = sortSignals([...signals]);
    expect(first).toEqual(second);
    expect(first[0].severity).toBe("high");
    expect(first.map((s) => s.signal)).toEqual(["moderation_history", "velocity", "duplicate"]);
  });

  it("scoreOf sums weights deterministically", () => {
    const signals = [
      { signal: "velocity" as const, severity: "high" as const, reason: "a" },
      { signal: "duplicate" as const, severity: "info" as const, reason: "b" },
    ];
    expect(scoreOf(signals)).toBe(4);
    expect(scoreOf(signals)).toBe(scoreOf([...signals]));
  });
});
