import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

function fakeQueryBuilder(data: unknown) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.or = chain;
  builder.order = chain;
  builder.maybeSingle = () => Promise.resolve({ data: (data as unknown[])[0] ?? null, error: null });
  builder.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return builder;
}

let tableData: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fakeQueryBuilder(tableData[table] ?? []),
  }),
}));

const { dedupeEddReportsByReporterAndBank, getBankProfileById, EDD_MIN_REPORTERS } = await import("./bankProfile");

beforeEach(() => {
  tableData = {};
});

describe("dedupeEddReportsByReporterAndBank", () => {
  it("keeps only each reporter's newest report per bank", () => {
    const result = dedupeEddReportsByReporterAndBank([
      { bank_id: "bank-a", user_id: "u1", days_early: 0, created_at: "2026-01-01" },
      { bank_id: "bank-a", user_id: "u1", days_early: 2, created_at: "2026-01-05" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].days_early).toBe(2);
  });

  it("excludes unattributed rows", () => {
    const result = dedupeEddReportsByReporterAndBank([
      { bank_id: "bank-a", user_id: null, days_early: 1, created_at: "2026-01-01" },
    ]);
    expect(result).toHaveLength(0);
  });

  it("keeps the same reporter's reports for two different banks independent", () => {
    const result = dedupeEddReportsByReporterAndBank([
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-01" },
      { bank_id: "bank-b", user_id: "u1", days_early: 2, created_at: "2026-01-01" },
    ]);
    expect(result).toHaveLength(2);
  });
});

describe("getBankProfileById — eddEvidence uses distinct reporters, not raw rows", () => {
  const BANK = {
    id: "bank-a", slug: "bank-a", name: "Bank A", website: null, address: null, phone: null,
    fednow_participant: null, rtp_participant: null, zelle_participant: null,
  };

  it("does not surface EDD evidence when only one distinct reporter exists, however many rows they submitted", async () => {
    tableData.banks = [BANK];
    tableData.route_reports = [];
    tableData.bank_rail_history = [];
    tableData.edd_reports = [
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-01" },
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-02" },
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-03" },
    ];

    const profile = await getBankProfileById("bank-a");
    expect(profile.eddEvidence).toBeNull();
  });

  it(`surfaces EDD evidence once ${EDD_MIN_REPORTERS} distinct reporters exist`, async () => {
    tableData.banks = [BANK];
    tableData.route_reports = [];
    tableData.bank_rail_history = [];
    tableData.edd_reports = [
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-01" },
      { bank_id: "bank-a", user_id: "u2", days_early: 3, created_at: "2026-01-02" },
    ];

    const profile = await getBankProfileById("bank-a");
    expect(profile.eddEvidence).toEqual({ avgDaysEarly: 2, reportCount: 2, hasMoreThanFive: false });
  });
});
