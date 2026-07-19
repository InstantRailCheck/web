import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: logErrorMock }));

let tableData: Record<string, unknown[]> = {};
let tableErrors: Record<string, string> = {};

function fakeQueryBuilder(table: string, data: unknown) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.or = chain;
  builder.order = chain;
  builder.maybeSingle = () => Promise.resolve({ data: (data as unknown[])[0] ?? null, error: null });
  builder.then = (resolve: (v: { data: unknown; error: { message: string } | null }) => void) =>
    resolve(
      tableErrors[table]
        ? { data: null, error: { message: tableErrors[table] } }
        : { data, error: null }
    );
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fakeQueryBuilder(table, tableData[table] ?? []),
  }),
}));

const {
  dedupeEddReportsByReporterAndBank,
  computeEddProviderEvidence,
  describeEddProviderEvidence,
  getBankProfileById,
  EDD_MIN_REPORTERS,
  EDD_PROVIDER_MIN_REPORTERS,
  EDD_DAYS_SENTINEL,
} = await import("./bankProfile");

beforeEach(() => {
  tableData = {};
  tableErrors = {};
  logErrorMock.mockClear();
});

function eddRow(overrides: Partial<{
  bank_id: string; user_id: string | null; days_early: number; created_at: string;
  deposit_type: string | null; payroll_provider: string | null;
}> = {}) {
  return {
    bank_id: "bank-a",
    user_id: "u1",
    days_early: 1,
    created_at: "2026-01-01",
    deposit_type: null,
    payroll_provider: null,
    ...overrides,
  };
}

describe("dedupeEddReportsByReporterAndBank", () => {
  it("keeps only each reporter's newest report per bank", () => {
    const result = dedupeEddReportsByReporterAndBank([
      eddRow({ days_early: 0, created_at: "2026-01-01" }),
      eddRow({ days_early: 2, created_at: "2026-01-05" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].days_early).toBe(2);
  });

  it("excludes unattributed rows", () => {
    const result = dedupeEddReportsByReporterAndBank([eddRow({ user_id: null })]);
    expect(result).toHaveLength(0);
  });

  it("keeps the same reporter's reports for two different banks independent", () => {
    const result = dedupeEddReportsByReporterAndBank([
      eddRow({ bank_id: "bank-a" }),
      eddRow({ bank_id: "bank-b" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("treats null, 'unknown', and 'other' as distinct deposit_type/payroll_provider values (not collapsed together)", () => {
    // Same reporter, same bank, but three different contexts — this dedup
    // level (by bank only) collapses to their single newest row regardless,
    // but the row's own field values must stay exactly what was stored.
    const [row] = dedupeEddReportsByReporterAndBank([
      eddRow({ deposit_type: "unknown", payroll_provider: null, created_at: "2026-01-03" }),
    ]);
    expect(row.deposit_type).toBe("unknown");
    expect(row.payroll_provider).toBeNull();
  });
});

describe("computeEddProviderEvidence", () => {
  it("hides a provider below EDD_PROVIDER_MIN_REPORTERS distinct reporters", () => {
    const rows = Array.from({ length: EDD_PROVIDER_MIN_REPORTERS - 1 }, (_, i) =>
      eddRow({ user_id: `u${i}`, deposit_type: "paycheck", payroll_provider: "adp" })
    );
    expect(computeEddProviderEvidence(rows)).toEqual([]);
  });

  it("surfaces a provider once EDD_PROVIDER_MIN_REPORTERS distinct reporters exist", () => {
    const rows = Array.from({ length: EDD_PROVIDER_MIN_REPORTERS }, (_, i) =>
      eddRow({ user_id: `u${i}`, deposit_type: "paycheck", payroll_provider: "adp", days_early: 2 })
    );
    const result = computeEddProviderEvidence(rows);
    expect(result).toEqual([
      { provider: "adp", providerLabel: "ADP", avgDaysEarly: 2, reportCount: EDD_PROVIDER_MIN_REPORTERS },
    ]);
  });

  it("does not let repeat submissions from one reporter inflate a provider's count", () => {
    const rows = [
      eddRow({ user_id: "u1", deposit_type: "paycheck", payroll_provider: "adp", created_at: "2026-01-01" }),
      eddRow({ user_id: "u1", deposit_type: "paycheck", payroll_provider: "adp", created_at: "2026-01-02" }),
      eddRow({ user_id: "u2", deposit_type: "paycheck", payroll_provider: "adp", created_at: "2026-01-01" }),
      eddRow({ user_id: "u3", deposit_type: "paycheck", payroll_provider: "adp", created_at: "2026-01-01" }),
    ];
    const result = computeEddProviderEvidence(rows);
    expect(result[0].reportCount).toBe(3);
  });

  it("counts a reporter's two different legitimate contexts independently", () => {
    // Same reporter, same bank, but two genuinely different provider
    // contexts (e.g. changed jobs) — both should be able to count toward
    // their respective provider's threshold.
    const rows = [
      eddRow({ user_id: "u1", deposit_type: "paycheck", payroll_provider: "adp" }),
      eddRow({ user_id: "u1", deposit_type: "paycheck", payroll_provider: "workday" }),
      eddRow({ user_id: "u2", deposit_type: "paycheck", payroll_provider: "adp" }),
      eddRow({ user_id: "u3", deposit_type: "paycheck", payroll_provider: "adp" }),
      eddRow({ user_id: "u4", deposit_type: "paycheck", payroll_provider: "workday" }),
      eddRow({ user_id: "u5", deposit_type: "paycheck", payroll_provider: "workday" }),
    ];
    const result = computeEddProviderEvidence(rows);
    expect(result.find((r) => r.provider === "adp")?.reportCount).toBe(3);
    expect(result.find((r) => r.provider === "workday")?.reportCount).toBe(3);
  });

  it("does not let one reporter's multiple eligible contexts satisfy the provider threshold alone", () => {
    // One person reporting the same provider under three different deposit
    // types (e.g. paycheck, gig_platform, other) is still one person — the
    // context-level dedup correctly keeps all three rows as distinct
    // experiences, but a public "N distinct reporters" claim must count
    // them once, not three times.
    const rows = [
      eddRow({ user_id: "u1", deposit_type: "paycheck", payroll_provider: "adp" }),
      eddRow({ user_id: "u1", deposit_type: "gig_platform", payroll_provider: "adp" }),
      eddRow({ user_id: "u1", deposit_type: "unknown", payroll_provider: "adp" }),
    ];
    expect(computeEddProviderEvidence(rows)).toEqual([]);
  });

  it("counts a reporter with multiple eligible contexts only once toward a provider that does clear the threshold", () => {
    const rows = [
      eddRow({ user_id: "u1", deposit_type: "paycheck", payroll_provider: "adp", days_early: 1 }),
      eddRow({ user_id: "u1", deposit_type: "gig_platform", payroll_provider: "adp", days_early: 5 }),
      eddRow({ user_id: "u2", deposit_type: "paycheck", payroll_provider: "adp", days_early: 3 }),
      eddRow({ user_id: "u3", deposit_type: "paycheck", payroll_provider: "adp", days_early: 3 }),
    ];
    const result = computeEddProviderEvidence(rows);
    expect(result[0].reportCount).toBe(3);
  });

  it("never creates a payroll-provider claim for non-payroll deposit types", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      eddRow({ user_id: `u${i}`, deposit_type: "tax_refund", payroll_provider: "government_treasury" })
    );
    expect(computeEddProviderEvidence(rows)).toEqual([]);
  });

  it("excludes 'unknown' and 'other' providers from public evidence even with enough reporters", () => {
    const unknownRows = Array.from({ length: 5 }, (_, i) =>
      eddRow({ user_id: `u${i}`, deposit_type: "paycheck", payroll_provider: "unknown" })
    );
    const otherRows = Array.from({ length: 5 }, (_, i) =>
      eddRow({ user_id: `v${i}`, deposit_type: "paycheck", payroll_provider: "other" })
    );
    expect(computeEddProviderEvidence([...unknownRows, ...otherRows])).toEqual([]);
  });

  it("excludes rows with no payroll_provider at all", () => {
    const rows = Array.from({ length: 5 }, (_, i) => eddRow({ user_id: `u${i}`, deposit_type: "paycheck" }));
    expect(computeEddProviderEvidence(rows)).toEqual([]);
  });

  it("excludes the open-ended 'more than 5 days' sentinel from the average, but still counts that reporter", () => {
    const rows = [
      eddRow({ user_id: "u1", deposit_type: "paycheck", payroll_provider: "adp", days_early: 2 }),
      eddRow({ user_id: "u2", deposit_type: "paycheck", payroll_provider: "adp", days_early: 4 }),
      eddRow({ user_id: "u3", deposit_type: "paycheck", payroll_provider: "adp", days_early: EDD_DAYS_SENTINEL }),
    ];
    const result = computeEddProviderEvidence(rows);
    // (2 + 4) / 2 = 3 — the sentinel-valued report is excluded from the sum
    // and the divisor, not averaged in as though it meant literally six.
    expect(result).toEqual([
      { provider: "adp", providerLabel: "ADP", avgDaysEarly: 3, reportCount: 3 },
    ]);
  });

  it("returns a null average (never a fabricated number) when every reporter chose the open-ended option", () => {
    const rows = Array.from({ length: EDD_PROVIDER_MIN_REPORTERS }, (_, i) =>
      eddRow({ user_id: `u${i}`, deposit_type: "paycheck", payroll_provider: "adp", days_early: EDD_DAYS_SENTINEL })
    );
    const result = computeEddProviderEvidence(rows);
    expect(result).toEqual([
      { provider: "adp", providerLabel: "ADP", avgDaysEarly: null, reportCount: EDD_PROVIDER_MIN_REPORTERS },
    ]);
  });
});

describe("describeEddProviderEvidence", () => {
  it("describes evidence, not a guarantee", () => {
    const text = describeEddProviderEvidence({ provider: "adp", providerLabel: "ADP", avgDaysEarly: 2, reportCount: 6 });
    expect(text).toBe("ADP payroll deposits were reported 2 days early by 6 distinct reporters.");
  });

  it("describes a null average categorically, never as a fabricated number", () => {
    const text = describeEddProviderEvidence({ provider: "adp", providerLabel: "ADP", avgDaysEarly: null, reportCount: 4 });
    expect(text).toBe("ADP payroll deposits were reported as more than 5 days early by 4 distinct reporters.");
  });
});

describe("getBankProfileById — EDD evidence and payroll context", () => {
  const BANK = {
    id: "bank-a", slug: "bank-a", name: "Bank A", website: null, address: null, phone: null,
    fednow_participant: null, rtp_participant: null, zelle_participant: null,
  };

  function setup(eddRows: ReturnType<typeof eddRow>[]) {
    tableData.banks = [BANK];
    tableData.route_reports = [];
    tableData.bank_rail_history = [];
    tableData.edd_reports = eddRows;
  }

  it("does not surface EDD evidence when only one distinct reporter exists, however many rows they submitted", async () => {
    setup([eddRow({ created_at: "2026-01-01" }), eddRow({ created_at: "2026-01-02" }), eddRow({ created_at: "2026-01-03" })]);

    const profile = await getBankProfileById("bank-a");
    expect(profile.eddEvidence).toBeNull();
  });

  it(`surfaces EDD evidence once ${EDD_MIN_REPORTERS} distinct reporters exist, with an empty providers list below the provider threshold`, async () => {
    setup([eddRow({ user_id: "u1", days_early: 1 }), eddRow({ user_id: "u2", days_early: 3 })]);

    const profile = await getBankProfileById("bank-a");
    expect(profile.eddEvidence).toEqual({ avgDaysEarly: 2, reportCount: 2, hasMoreThanFive: false, providers: [] });
  });

  it("existing reports with null deposit_type/payroll_provider remain valid and still count toward overall evidence", async () => {
    setup([
      eddRow({ user_id: "u1", deposit_type: null, payroll_provider: null }),
      eddRow({ user_id: "u2", deposit_type: null, payroll_provider: null }),
    ]);

    const profile = await getBankProfileById("bank-a");
    expect(profile.eddEvidence?.reportCount).toBe(2);
    expect(profile.eddEvidence?.providers).toEqual([]);
  });

  it("excludes the open-ended 'more than 5 days' sentinel from the bank-level average", async () => {
    setup([
      eddRow({ user_id: "u1", days_early: 1 }),
      eddRow({ user_id: "u2", days_early: 3 }),
      eddRow({ user_id: "u3", days_early: EDD_DAYS_SENTINEL }),
    ]);

    const profile = await getBankProfileById("bank-a");
    // (1 + 3) / 2 = 2 — the sentinel report contributes to reportCount and
    // hasMoreThanFive, but not to the average's sum or divisor.
    expect(profile.eddEvidence).toEqual({ avgDaysEarly: 2, reportCount: 3, hasMoreThanFive: true, providers: [] });
  });

  it("returns a null bank-level average when every attributable reporter chose the open-ended option", async () => {
    setup([
      eddRow({ user_id: "u1", days_early: EDD_DAYS_SENTINEL }),
      eddRow({ user_id: "u2", days_early: EDD_DAYS_SENTINEL }),
    ]);

    const profile = await getBankProfileById("bank-a");
    expect(profile.eddEvidence).toEqual({ avgDaysEarly: null, reportCount: 2, hasMoreThanFive: true, providers: [] });
  });

  it("includes provider evidence once the provider threshold is met", async () => {
    setup(
      Array.from({ length: EDD_PROVIDER_MIN_REPORTERS }, (_, i) =>
        eddRow({ user_id: `u${i}`, deposit_type: "paycheck", payroll_provider: "gusto", days_early: 1 })
      )
    );

    const profile = await getBankProfileById("bank-a");
    expect(profile.eddEvidence?.providers).toEqual([
      { provider: "gusto", providerLabel: "Gusto", avgDaysEarly: 1, reportCount: EDD_PROVIDER_MIN_REPORTERS },
    ]);
  });

  it("logs an error (and still falls back to an empty result) when a query fails, instead of failing silently", async () => {
    setup([]);
    tableErrors.route_reports = "connection reset";

    const profile = await getBankProfileById("bank-a");

    expect(profile.sending).toEqual([]);
    expect(logErrorMock).toHaveBeenCalledWith(
      "Failed to load route_reports for bank profile",
      expect.objectContaining({ bankId: "bank-a", error: "connection reset" })
    );
  });

  it("does not log anything when every query succeeds", async () => {
    setup([]);

    await getBankProfileById("bank-a");

    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
