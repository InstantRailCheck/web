import { describe, it, expect, vi } from "vitest";

// bankProfile.ts (the source of the shared dedupe helper/constants) is
// marked server-only, which throws outside a real Next.js server build —
// a no-op guard for this vitest run, same pattern as communityRails.test.ts.
vi.mock("server-only", () => ({}));

import {
  computeEddLeaderboard,
  computeTypicalValue,
  distributionBucketLabel,
  typicalValueLabel,
  eddEvidenceLabel,
  EDD_LEADERBOARD_MIN_REPORTERS,
  type EddLeaderboardBank,
} from "./eddLeaderboard";
import { EDD_DAYS_SENTINEL, type EddReportRow } from "./bankProfile";

function row(overrides: Partial<EddReportRow> & { bank_id: string }): EddReportRow {
  return {
    user_id: "u1",
    days_early: 1,
    created_at: "2026-01-01T00:00:00Z",
    deposit_type: null,
    payroll_provider: null,
    ...overrides,
  };
}

const activeBank = (id: string, name = id): EddLeaderboardBank => ({ id, slug: id, name, isActive: true });
const inactiveBank = (id: string, name = id): EddLeaderboardBank => ({ id, slug: id, name, isActive: false });

function reportersFor(bankId: string, days: number[], startDate = "2026-01-01"): EddReportRow[] {
  return days.map((d, i) =>
    row({
      bank_id: bankId,
      user_id: `u${i}`,
      days_early: d,
      created_at: new Date(new Date(startDate).getTime() + i * 86_400_000).toISOString(),
    })
  );
}

describe("computeTypicalValue — censored-median safety", () => {
  it("computes an ordinary median for an odd sample", () => {
    expect(computeTypicalValue([0, 2, 4])).toEqual({ kind: "exact", days: 2 });
  });

  it("computes an ordinary median (rounded average of the middle two) for an even sample", () => {
    // sorted: 1,3 -> middle two are 1 and 3 -> average 2
    expect(computeTypicalValue([3, 1])).toEqual({ kind: "exact", days: 2 });
  });

  it("rounds a fractional even-sample median to the nearest whole bucket", () => {
    // sorted: 1,1,2,5 -> middle two are 1 and 2 -> average 1.5 -> rounds to 2
    expect(computeTypicalValue([5, 1, 2, 1])).toEqual({ kind: "exact", days: 2 });
  });

  it("never treats bucket 6 as a literal numeric six — odd sample landing on the sentinel is categorical", () => {
    // sorted: 5,6,6 -> median index 1 -> the sentinel itself
    expect(computeTypicalValue([6, 5, EDD_DAYS_SENTINEL])).toEqual({ kind: "moreThanFive" });
  });

  it("falls back to categorical when an even-sample interpolation would cross the censored bucket", () => {
    expect(computeTypicalValue([4, EDD_DAYS_SENTINEL])).toEqual({ kind: "moreThanFive" });
  });

  it("mixed values containing the sentinel never fabricate an exact number", () => {
    // sorted: 0,1,6,6,6 -> median index 2 -> the sentinel itself
    const result = computeTypicalValue([0, 1, EDD_DAYS_SENTINEL, EDD_DAYS_SENTINEL, EDD_DAYS_SENTINEL]);
    expect(result).toEqual({ kind: "moreThanFive" });
    expect(result).not.toHaveProperty("days");
  });

  it("all-censored sample is categorical", () => {
    expect(computeTypicalValue([EDD_DAYS_SENTINEL, EDD_DAYS_SENTINEL])).toEqual({ kind: "moreThanFive" });
  });
});

describe("distributionBucketLabel / typicalValueLabel — bucket 6 phrasing", () => {
  it("renders bucket 6 only as the categorical phrase, never '6 days'", () => {
    expect(distributionBucketLabel(EDD_DAYS_SENTINEL)).toBe("More than 5 days early");
    expect(distributionBucketLabel(EDD_DAYS_SENTINEL)).not.toContain("6");
  });

  it("renders ordinary buckets as exact day counts", () => {
    expect(distributionBucketLabel(0)).toBe("Not early / same day");
    expect(distributionBucketLabel(1)).toBe("1 day early");
    expect(distributionBucketLabel(2)).toBe("2 days early");
  });

  it("typicalValueLabel never mentions 6 for a categorical typical value", () => {
    expect(typicalValueLabel({ kind: "moreThanFive" })).toBe("more than 5 days early");
  });
});

describe("eddEvidenceLabel — sample-size bands", () => {
  it("returns null below the leaderboard threshold", () => {
    expect(eddEvidenceLabel(4)).toBeNull();
  });
  it("emerging: 5-9", () => {
    expect(eddEvidenceLabel(5)).toBe("emerging");
    expect(eddEvidenceLabel(9)).toBe("emerging");
  });
  it("moderate: 10-24", () => {
    expect(eddEvidenceLabel(10)).toBe("moderate");
    expect(eddEvidenceLabel(24)).toBe("moderate");
  });
  it("strong: 25+", () => {
    expect(eddEvidenceLabel(25)).toBe("strong");
    expect(eddEvidenceLabel(1000)).toBe("strong");
  });
});

describe("computeEddLeaderboard — integrity and dedup", () => {
  it("one reporter submitting repeatedly counts once", () => {
    const banks = [activeBank("b1")];
    const rows = [
      row({ bank_id: "b1", user_id: "u1", days_early: 0, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: "u1", days_early: 2, created_at: "2026-01-02" }),
      row({ bank_id: "b1", user_id: "u1", days_early: 4, created_at: "2026-01-03" }),
    ];
    const { ranked, earlyEvidence } = computeEddLeaderboard(rows, banks);
    expect(ranked).toEqual([]);
    expect(earlyEvidence).toEqual([]); // still only 1 distinct reporter, below EDD_MIN_REPORTERS
  });

  it("a newer report replaces that reporter's older evidence for the same bank", () => {
    const banks = [activeBank("b1")];
    const rows = [
      row({ bank_id: "b1", user_id: "u1", days_early: 0, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: "u1", days_early: 5, created_at: "2026-01-05" }), // newest for u1
      row({ bank_id: "b1", user_id: "u2", days_early: 5, created_at: "2026-01-02" }),
    ];
    const { earlyEvidence } = computeEddLeaderboard(rows, banks);
    expect(earlyEvidence).toHaveLength(1);
    expect(earlyEvidence[0].reportCount).toBe(2);
    expect(earlyEvidence[0].distribution).toEqual({ 5: 2 }); // u1's old 0-day row is gone
  });

  it("reporters are deduped independently per bank", () => {
    const banks = [activeBank("b1"), activeBank("b2")];
    const rows = [
      row({ bank_id: "b1", user_id: "u1", days_early: 1, created_at: "2026-01-01" }),
      row({ bank_id: "b2", user_id: "u1", days_early: 3, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: "u2", days_early: 1, created_at: "2026-01-01" }),
      row({ bank_id: "b2", user_id: "u2", days_early: 3, created_at: "2026-01-01" }),
    ];
    const { earlyEvidence } = computeEddLeaderboard(rows, banks);
    expect(earlyEvidence.map((e) => e.reportCount).sort()).toEqual([2, 2]);
  });

  it("user_id = null rows never contribute", () => {
    const banks = [activeBank("b1")];
    const rows = [
      row({ bank_id: "b1", user_id: null, days_early: 5, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: null, days_early: 5, created_at: "2026-01-02" }),
    ];
    const { ranked, earlyEvidence } = computeEddLeaderboard(rows, banks);
    expect(ranked).toEqual([]);
    expect(earlyEvidence).toEqual([]);
  });

  it("inactive institutions never appear in the leaderboard, however much evidence exists", () => {
    const banks = [inactiveBank("b1")];
    const rows = reportersFor("b1", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]); // 10 distinct reporters
    const { ranked, earlyEvidence } = computeEddLeaderboard(rows, banks);
    expect(ranked).toEqual([]);
    expect(earlyEvidence).toEqual([]);
  });

  it("4 distinct reporters remain unranked (early evidence, not on the leaderboard)", () => {
    const banks = [activeBank("b1")];
    const rows = reportersFor("b1", [1, 2, 3, 4]);
    const { ranked, earlyEvidence } = computeEddLeaderboard(rows, banks);
    expect(ranked).toEqual([]);
    expect(earlyEvidence).toHaveLength(1);
    expect(earlyEvidence[0].reportCount).toBe(4);
    expect(earlyEvidence[0].evidenceLabel).toBeNull();
  });

  it("5 distinct reporters qualify for the ranked leaderboard", () => {
    const banks = [activeBank("b1")];
    const rows = reportersFor("b1", [1, 2, 3, 4, 5]);
    const { ranked, earlyEvidence } = computeEddLeaderboard(rows, banks);
    expect(earlyEvidence).toEqual([]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reportCount).toBe(EDD_LEADERBOARD_MIN_REPORTERS);
    expect(ranked[0].evidenceLabel).toBe("emerging");
  });

  it("deterministic tie ordering falls back to institution name", () => {
    const banks = [activeBank("z-bank", "Z Bank"), activeBank("a-bank", "A Bank")];
    // Identical typical/share/count for both banks.
    const rows = [
      ...reportersFor("z-bank", [2, 2, 2, 2, 2]),
      ...reportersFor("a-bank", [2, 2, 2, 2, 2]),
    ];
    const { ranked } = computeEddLeaderboard(rows, banks);
    expect(ranked.map((e) => e.bankName)).toEqual(["A Bank", "Z Bank"]);
  });

  it("ranks a higher typical value above a lower one before falling back to sample size", () => {
    const banks = [activeBank("low", "Low Bank"), activeBank("high", "High Bank")];
    const rows = [
      ...reportersFor("low", [0, 0, 0, 0, 0, 0]), // n=6, typical 0
      ...reportersFor("high", [3, 3, 3, 3, 3]), // n=5, typical 3
    ];
    const { ranked } = computeEddLeaderboard(rows, banks);
    expect(ranked.map((e) => e.bankName)).toEqual(["High Bank", "Low Bank"]);
  });

  it("computes latestReportDate and marks stale evidence older than 180 days", () => {
    const banks = [activeBank("b1")];
    const rows = reportersFor("b1", [1, 1, 1, 1, 1], "2025-01-01");
    const now = new Date("2026-01-01T00:00:00Z"); // ~365 days after the latest report
    const { earlyEvidence, ranked } = computeEddLeaderboard(rows, banks, now);
    const entry = ranked[0] ?? earlyEvidence[0];
    expect(entry.isStale).toBe(true);
  });

  it("does not mark recent evidence as stale", () => {
    const banks = [activeBank("b1")];
    const now = new Date("2026-01-10T00:00:00Z");
    const rows = reportersFor("b1", [1, 1, 1, 1, 1], "2026-01-01");
    const { ranked } = computeEddLeaderboard(rows, banks, now);
    expect(ranked[0].isStale).toBe(false);
  });

  it("returns empty ranked/earlyEvidence for no evidence at all — a real empty state, not an error", () => {
    expect(computeEddLeaderboard([], [])).toEqual({ ranked: [], earlyEvidence: [] });
  });

  it("never serializes a user id or other private context onto an entry", () => {
    const banks = [activeBank("b1")];
    const rows = reportersFor("b1", [1, 2, 3, 4, 5]);
    const { ranked } = computeEddLeaderboard(rows, banks);
    const keys = Object.keys(ranked[0]);
    for (const forbidden of ["user_id", "userId", "reporterId", "email"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(ranked)).not.toMatch(/u0|u1|u2|u3|u4/);
  });
});
