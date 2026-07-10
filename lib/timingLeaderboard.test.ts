import { describe, it, expect, vi, beforeEach } from "vitest";

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

const { getTimingLeaderboard } = await import("./timingLeaderboard");

beforeEach(() => {
  tableData = {};
});

const BANKS = [{ id: "bank-a", slug: "bank-a" }];

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

describe("getTimingLeaderboard", () => {
  it("does not let one reporter's repeat submissions on the same route skew the average", async () => {
    tableData.banks = BANKS;
    tableData.route_reports = [
      row({ user_id: "u1", settlement_time_minutes: 10, tested_at: "2026-01-01" }),
      row({ user_id: "u1", settlement_time_minutes: 1000, tested_at: "2026-01-02" }), // newest from u1
      row({ user_id: "u2", settlement_time_minutes: 60, tested_at: "2026-01-03" }),
    ];

    const result = await getTimingLeaderboard();
    expect(result.ACH).toEqual([{ bankId: "bank-a", bankSlug: "bank-a", bankName: "Bank A", avgTime: 530, sampleSize: 2 }]);
  });

  it("excludes failed transfers from timing even if a settlement time was submitted", async () => {
    tableData.banks = BANKS;
    tableData.route_reports = [
      row({ user_id: "u1", status: "failed", settlement_time_minutes: 9999 }),
      row({ user_id: "u2", status: "success", settlement_time_minutes: 30 }),
    ];

    const result = await getTimingLeaderboard();
    // Only one meaningful (non-failed) reporter — below the 2-reporter threshold.
    expect(result.ACH ?? []).toEqual([]);
  });

  it("excludes negative/corrupt settlement time values", async () => {
    tableData.banks = BANKS;
    tableData.route_reports = [
      row({ user_id: "u1", settlement_time_minutes: -5 }),
      row({ user_id: "u2", settlement_time_minutes: 40 }),
    ];

    const result = await getTimingLeaderboard();
    expect(result.ACH ?? []).toEqual([]);
  });

  it("still includes delayed transfers, since a slow-but-completed transfer has a meaningful time", async () => {
    tableData.banks = BANKS;
    tableData.route_reports = [
      row({ user_id: "u1", status: "delayed", settlement_time_minutes: 200 }),
      row({ user_id: "u2", status: "success", settlement_time_minutes: 40 }),
    ];

    const result = await getTimingLeaderboard();
    expect(result.ACH).toEqual([{ bankId: "bank-a", bankSlug: "bank-a", bankName: "Bank A", avgTime: 120, sampleSize: 2 }]);
  });

  it("counts different legitimate routes/rails from the same reporter independently", async () => {
    tableData.banks = BANKS;
    tableData.route_reports = [
      row({ user_id: "u1", rail_used: "ACH", to_bank_id: "bank-b", settlement_time_minutes: 60 }),
      row({ user_id: "u1", rail_used: "RTP", to_bank_id: "bank-b", settlement_time_minutes: 1 }),
      row({ user_id: "u2", rail_used: "ACH", to_bank_id: "bank-b", settlement_time_minutes: 60 }),
      row({ user_id: "u2", rail_used: "RTP", to_bank_id: "bank-b", settlement_time_minutes: 1 }),
    ];

    const result = await getTimingLeaderboard();
    expect(result.ACH).toHaveLength(1);
    expect(result.RTP).toHaveLength(1);
    expect(result.ACH[0].sampleSize).toBe(2);
    expect(result.RTP[0].sampleSize).toBe(2);
  });
});
