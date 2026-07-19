import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TimingLeaderboardBank } from "./timingLeaderboard";

// timingLeaderboard.ts is marked server-only, which throws on import outside
// a real Next.js server build — a build-time guard, not something to
// enforce in a vitest run.
vi.mock("server-only", () => ({}));

function fakeQueryBuilder(data: unknown) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.not = chain;
  builder.in = chain;
  builder.order = chain;
  builder.range = chain;
  builder.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return builder;
}

let tableData: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fakeQueryBuilder(tableData[table] ?? []),
  }),
}));

const { getTimingLeaderboard, computeTimingLeaderboard, timingEvidenceLabel } = await import("./timingLeaderboard");

beforeEach(() => {
  tableData = {};
});

const BANKS = [{ id: "bank-a", slug: "bank-a", is_active: true }];

function row(overrides: Partial<{
  from_bank_id: string; from_bank_name: string; to_bank_id: string; rail_used: string;
  status: string; settlement_time_minutes: number | null; tested_at: string; user_id: string | null;
}>) {
  return {
    from_bank_id: "bank-a",
    from_bank_name: "Bank A",
    to_bank_id: "bank-b",
    rail_used: "ACH",
    status: "success",
    settlement_time_minutes: 60,
    tested_at: "2026-01-01",
    user_id: "u1",
    ...overrides,
  };
}

describe("getTimingLeaderboard — fetches real rows and defers to computeTimingLeaderboard", () => {
  it("wires route_reports/banks through to the shared computation", async () => {
    tableData.banks = BANKS;
    tableData.route_reports = [
      row({ user_id: "u1", settlement_time_minutes: 60, tested_at: "2026-01-01" }),
      row({ user_id: "u2", settlement_time_minutes: 60, tested_at: "2026-01-02" }),
    ];

    const result = await getTimingLeaderboard();
    expect(result.ACH).toHaveLength(1);
    expect(result.ACH[0].typicalMinutes).toBe(60);
    expect(result.ACH[0].sampleSize).toBe(2);
  });

  it("excludes an inactive bank from the leaderboard", async () => {
    tableData.banks = [{ ...BANKS[0], is_active: false }];
    tableData.route_reports = [
      row({ user_id: "u1", settlement_time_minutes: 60 }),
      row({ user_id: "u2", settlement_time_minutes: 60 }),
    ];

    const result = await getTimingLeaderboard();
    expect(result.ACH ?? []).toEqual([]);
  });
});

describe("timingEvidenceLabel — sample-size bands", () => {
  it("returns null below the emerging band", () => {
    expect(timingEvidenceLabel(2)).toBeNull();
    expect(timingEvidenceLabel(4)).toBeNull();
  });
  it("emerging: 5-9", () => {
    expect(timingEvidenceLabel(5)).toBe("emerging");
    expect(timingEvidenceLabel(9)).toBe("emerging");
  });
  it("moderate: 10-24", () => {
    expect(timingEvidenceLabel(10)).toBe("moderate");
    expect(timingEvidenceLabel(24)).toBe("moderate");
  });
  it("strong: 25+", () => {
    expect(timingEvidenceLabel(25)).toBe("strong");
  });
});

describe("computeTimingLeaderboard", () => {
  const activeBank = (id: string, slug = id): TimingLeaderboardBank => ({ id, slug, isActive: true });
  const inactiveBank = (id: string, slug = id): TimingLeaderboardBank => ({ id, slug, isActive: false });

  it("does not let one reporter's repeat submissions on the same route skew the typical value", () => {
    const rows = [
      row({ user_id: "u1", settlement_time_minutes: 10, tested_at: "2026-01-01" }),
      row({ user_id: "u1", settlement_time_minutes: 1000, tested_at: "2026-01-02" }), // newest from u1
      row({ user_id: "u2", settlement_time_minutes: 60, tested_at: "2026-01-03" }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    // u1's newest (1000) and u2's (60) -> median of [1000, 60] rounds to 530
    expect(result.ACH).toEqual([
      expect.objectContaining({ bankId: "bank-a", sampleSize: 2, typicalMinutes: 530 }),
    ]);
  });

  it("excludes failed transfers even if a settlement time was submitted", () => {
    const rows = [
      row({ user_id: "u1", status: "failed", settlement_time_minutes: 9999 }),
      row({ user_id: "u2", status: "success", settlement_time_minutes: 30 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    expect(result.ACH ?? []).toEqual([]); // only 1 meaningful reporter, below threshold
  });

  it("excludes negative/corrupt settlement time values", () => {
    const rows = [
      row({ user_id: "u1", settlement_time_minutes: -5 }),
      row({ user_id: "u2", settlement_time_minutes: 40 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    expect(result.ACH ?? []).toEqual([]);
  });

  it("still includes delayed transfers, since a slow-but-completed transfer has a meaningful time", () => {
    const rows = [
      row({ user_id: "u1", status: "delayed", settlement_time_minutes: 200 }),
      row({ user_id: "u2", status: "success", settlement_time_minutes: 40 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    expect(result.ACH[0].typicalMinutes).toBe(120);
  });

  it("counts different legitimate routes/rails from the same reporter independently", () => {
    const rows = [
      row({ user_id: "u1", rail_used: "ACH", to_bank_id: "bank-b", settlement_time_minutes: 60 }),
      row({ user_id: "u1", rail_used: "RTP", to_bank_id: "bank-b", settlement_time_minutes: 1 }),
      row({ user_id: "u2", rail_used: "ACH", to_bank_id: "bank-b", settlement_time_minutes: 60 }),
      row({ user_id: "u2", rail_used: "RTP", to_bank_id: "bank-b", settlement_time_minutes: 1 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    expect(result.ACH).toHaveLength(1);
    expect(result.RTP).toHaveLength(1);
    expect(result.ACH[0].sampleSize).toBe(2);
    expect(result.RTP[0].sampleSize).toBe(2);
  });

  it("user_id = null rows never contribute", () => {
    const rows = [
      row({ user_id: null, settlement_time_minutes: 10 }),
      row({ user_id: null, settlement_time_minutes: 20 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    expect(result.ACH ?? []).toEqual([]);
  });

  it("inactive institutions never rank, however much evidence exists", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ user_id: `u${i}`, settlement_time_minutes: 30, tested_at: `2026-01-${String(i + 1).padStart(2, "0")}` })
    );
    const result = computeTimingLeaderboard(rows, [inactiveBank("bank-a")]);
    expect(result.ACH ?? []).toEqual([]);
  });

  it("computes an ordinary median for an odd sample", () => {
    const rows = [
      row({ user_id: "u1", settlement_time_minutes: 10 }),
      row({ user_id: "u2", settlement_time_minutes: 100 }),
      row({ user_id: "u3", settlement_time_minutes: 20 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    expect(result.ACH[0].typicalMinutes).toBe(20); // sorted: 10,20,100 -> median 20
  });

  it("computes a rounded average-of-middle-two median for an even sample", () => {
    const rows = [
      row({ user_id: "u1", settlement_time_minutes: 10 }),
      row({ user_id: "u2", settlement_time_minutes: 21 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    expect(result.ACH[0].typicalMinutes).toBe(16); // (10+21)/2 = 15.5 -> rounds to 16
  });

  it("deterministic tie ordering falls back to institution name when typical/share/count all match", () => {
    const rows = [
      ...["u0", "u1"].map((u) => row({ from_bank_id: "z-bank", from_bank_name: "Z Bank", user_id: u, settlement_time_minutes: 30 })),
      ...["u2", "u3"].map((u) => row({ from_bank_id: "a-bank", from_bank_name: "A Bank", user_id: u, settlement_time_minutes: 30 })),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("z-bank"), activeBank("a-bank")]);
    expect(result.ACH.map((e) => e.bankName)).toEqual(["A Bank", "Z Bank"]);
  });

  it("ranks a lower (faster) typical value above a higher one", () => {
    const rows = [
      ...["u0", "u1"].map((u) => row({ from_bank_id: "slow", from_bank_name: "Slow Bank", user_id: u, settlement_time_minutes: 500 })),
      ...["u2", "u3"].map((u) => row({ from_bank_id: "fast", from_bank_name: "Fast Bank", user_id: u, settlement_time_minutes: 5 })),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("slow"), activeBank("fast")]);
    expect(result.ACH.map((e) => e.bankName)).toEqual(["Fast Bank", "Slow Bank"]);
  });

  it("marks evidence older than 180 days as stale and computes the latest observation date", () => {
    const rows = [
      row({ user_id: "u1", settlement_time_minutes: 30, tested_at: "2025-01-01" }),
      row({ user_id: "u2", settlement_time_minutes: 30, tested_at: "2025-01-05" }),
    ];
    const now = new Date("2026-01-01T00:00:00Z");
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")], now);
    expect(result.ACH[0].isStale).toBe(true);
    expect(result.ACH[0].latestObservationDate).toBe(new Date("2025-01-05").toISOString());
  });

  it("does not mark recent evidence as stale", () => {
    const rows = [
      row({ user_id: "u1", settlement_time_minutes: 30, tested_at: "2026-01-01" }),
      row({ user_id: "u2", settlement_time_minutes: 30, tested_at: "2026-01-05" }),
    ];
    const now = new Date("2026-01-10T00:00:00Z");
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")], now);
    expect(result.ACH[0].isStale).toBe(false);
  });

  it("returns an empty result for no evidence at all — a real empty state", () => {
    expect(computeTimingLeaderboard([], [])).toEqual({});
  });

  it("never serializes a user id onto an entry", () => {
    const rows = [
      row({ user_id: "u1", settlement_time_minutes: 30 }),
      row({ user_id: "u2", settlement_time_minutes: 30 }),
    ];
    const result = computeTimingLeaderboard(rows, [activeBank("bank-a")]);
    const keys = Object.keys(result.ACH[0]);
    for (const forbidden of ["user_id", "userId", "reporterId"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(result)).not.toMatch(/"u1"|"u2"/);
  });
});
