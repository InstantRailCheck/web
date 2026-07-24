import { describe, it, expect, vi } from "vitest";

// bankProfile.ts (the source of the shared dedupe helper/constants) is
// marked server-only, which throws outside a real Next.js server build —
// same no-op guard as eddLeaderboard.test.ts.
vi.mock("server-only", () => ({}));

import { computeEddOpportunities, type EddOpportunityBank } from "./eddOpportunities";
import { EDD_MIN_REPORTERS, type EddReportRow } from "./bankProfile";
import { EDD_LEADERBOARD_MIN_REPORTERS } from "./eddLeaderboard";

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

const activeBank = (id: string, name = id): EddOpportunityBank => ({ id, slug: id, name, isActive: true });
const inactiveBank = (id: string, name = id): EddOpportunityBank => ({ id, slug: id, name, isActive: false });

function reportersFor(bankId: string, count: number): EddReportRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      bank_id: bankId,
      user_id: `u${i}`,
      days_early: 1,
      created_at: new Date(new Date("2026-01-01").getTime() + i * 86_400_000).toISOString(),
    })
  );
}

describe("computeEddOpportunities — dedup integrity (shared with computeEddLeaderboard)", () => {
  it("one reporter submitting repeatedly counts once — below the visibility threshold, not an opportunity gap of zero", () => {
    const banks = [activeBank("b1")];
    const rows = [
      row({ bank_id: "b1", user_id: "u1", days_early: 0, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: "u1", days_early: 2, created_at: "2026-01-02" }),
    ];
    const result = computeEddOpportunities(rows, banks);
    expect(result).toHaveLength(1);
    expect(result[0].reportCount).toBe(1);
  });

  it("a newer report replaces that reporter's older evidence for the same bank", () => {
    const banks = [activeBank("b1")];
    const rows = [
      row({ bank_id: "b1", user_id: "u1", days_early: 0, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: "u1", days_early: 5, created_at: "2026-01-05" }),
      row({ bank_id: "b1", user_id: "u2", days_early: 5, created_at: "2026-01-02" }),
    ];
    const result = computeEddOpportunities(rows, banks);
    expect(result).toHaveLength(1);
    expect(result[0].reportCount).toBe(2); // u1 counted once (newest), u2 once
  });

  it("reporters are deduped independently per bank", () => {
    const banks = [activeBank("b1"), activeBank("b2")];
    const rows = [
      row({ bank_id: "b1", user_id: "u1", days_early: 1, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: "u1", days_early: 1, created_at: "2026-01-02" }),
      row({ bank_id: "b2", user_id: "u1", days_early: 3, created_at: "2026-01-01" }),
    ];
    const result = computeEddOpportunities(rows, banks);
    const byBank = new Map(result.map((o) => [o.bankId, o.reportCount]));
    expect(byBank.get("b1")).toBe(1);
    expect(byBank.get("b2")).toBe(1);
  });

  it("user_id = null rows never contribute", () => {
    const banks = [activeBank("b1")];
    const rows = [
      row({ bank_id: "b1", user_id: null, days_early: 5, created_at: "2026-01-01" }),
      row({ bank_id: "b1", user_id: null, days_early: 5, created_at: "2026-01-02" }),
    ];
    expect(computeEddOpportunities(rows, banks)).toEqual([]);
  });
});

describe("computeEddOpportunities — [1, 4] range boundaries", () => {
  it("excludes a bank with zero reports — nothing to prioritize, never invented", () => {
    const banks = [activeBank("b1")];
    expect(computeEddOpportunities([], banks)).toEqual([]);
  });

  it("count 1: one report from crossing EDD_MIN_REPORTERS, kind visibility", () => {
    const banks = [activeBank("b1")];
    const result = computeEddOpportunities(reportersFor("b1", 1), banks);
    expect(result).toHaveLength(1);
    expect(result[0].reportCount).toBe(1);
    expect(result[0].reportsUntilNextThreshold).toBe(EDD_MIN_REPORTERS - 1);
    expect(result[0].nextThresholdKind).toBe("visibility");
  });

  it("count 2: already visible, several reports from ranking, kind ranking", () => {
    const banks = [activeBank("b1")];
    const result = computeEddOpportunities(reportersFor("b1", 2), banks);
    expect(result[0].reportsUntilNextThreshold).toBe(EDD_LEADERBOARD_MIN_REPORTERS - 2);
    expect(result[0].nextThresholdKind).toBe("ranking");
  });

  it("count 4: one report away from the leaderboard, kind ranking", () => {
    const banks = [activeBank("b1")];
    const result = computeEddOpportunities(reportersFor("b1", 4), banks);
    expect(result[0].reportCount).toBe(4);
    expect(result[0].reportsUntilNextThreshold).toBe(1);
    expect(result[0].nextThresholdKind).toBe("ranking");
  });

  it("excludes a bank with 5+ reports — already leaderboard-eligible, no longer an opportunity", () => {
    const banks = [activeBank("b1")];
    expect(computeEddOpportunities(reportersFor("b1", EDD_LEADERBOARD_MIN_REPORTERS), banks)).toEqual([]);
    expect(computeEddOpportunities(reportersFor("b1", EDD_LEADERBOARD_MIN_REPORTERS + 5), banks)).toEqual([]);
  });
});

describe("computeEddOpportunities — institution and ordering rules", () => {
  it("inactive banks never appear, however much evidence exists", () => {
    const banks = [inactiveBank("b1")];
    expect(computeEddOpportunities(reportersFor("b1", 3), banks)).toEqual([]);
  });

  it("orders by proximity to the next threshold, ascending", () => {
    const banks = [activeBank("far", "Far Bank"), activeBank("near", "Near Bank")];
    const rows = [...reportersFor("far", 2), ...reportersFor("near", 4)];
    const result = computeEddOpportunities(rows, banks);
    expect(result.map((o) => o.bankName)).toEqual(["Near Bank", "Far Bank"]);
  });

  it("ties on proximity fall back to bank name", () => {
    const banks = [activeBank("z", "Z Bank"), activeBank("a", "A Bank")];
    const rows = [...reportersFor("z", 1), ...reportersFor("a", 1)];
    const result = computeEddOpportunities(rows, banks);
    expect(result.map((o) => o.bankName)).toEqual(["A Bank", "Z Bank"]);
  });

  it("never serializes a user id or other private context onto an entry", () => {
    const banks = [activeBank("b1")];
    const result = computeEddOpportunities(reportersFor("b1", 2), banks);
    const keys = Object.keys(result[0]);
    for (const forbidden of ["user_id", "userId", "reporterId", "email"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(result)).not.toMatch(/u0|u1|u2|u3/);
  });
});
