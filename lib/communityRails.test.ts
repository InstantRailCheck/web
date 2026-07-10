import { describe, it, expect, vi, beforeEach } from "vitest";

// communityRails.ts imports lib/bankProfile.ts (for the shared EDD dedup
// helper/threshold), which is marked server-only — that package throws on
// import outside a real Next.js server build. It's a build-time guard
// against a client bundle including it, not something to enforce in a
// vitest run, so it's a no-op here.
vi.mock("server-only", () => ({}));

// Lightweight fake Postgrest query builder: every chain method returns
// itself, and it resolves (via `then`, since Supabase's real builder is a
// thenable) to canned data for whichever table it was built for.
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

vi.mock("@/lib/allBanks", () => ({
  fetchAllBanks: async () => tableData.banks ?? [],
}));

const { getCommunityReportedBanks, getEddRankedBanks } = await import("./communityRails");

beforeEach(() => {
  tableData = {};
});

describe("getCommunityReportedBanks — dedup by directional route before pooling by bank", () => {
  const banks = [{ id: "bank-a", slug: "bank-a" }, { id: "bank-b", slug: "bank-b" }];

  it("does not let one reporter's repeat submissions on the same route inflate the count", async () => {
    tableData.banks = banks;
    tableData.route_reports = [
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "success", tested_at: "2026-01-01", user_id: "u1" },
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "success", tested_at: "2026-01-02", user_id: "u1" },
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "success", tested_at: "2026-01-03", user_id: "u2" },
    ];

    const result = await getCommunityReportedBanks("RTP");
    expect(result).toEqual([{ bankId: "bank-a", bankSlug: "bank-a", bankName: "Bank A", successCount: 2 }]);
  });

  it("counts different legitimate routes from the same reporter independently", async () => {
    tableData.banks = banks;
    tableData.route_reports = [
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "success", tested_at: "2026-01-01", user_id: "u1" },
      // Same reporter, same sender, but a DIFFERENT receiver — a distinct route, must count separately.
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-c", status: "success", tested_at: "2026-01-02", user_id: "u1" },
    ];

    const result = await getCommunityReportedBanks("RTP");
    expect(result).toEqual([{ bankId: "bank-a", bankSlug: "bank-a", bankName: "Bank A", successCount: 2 }]);
  });

  it("excludes unattributed rows", async () => {
    tableData.banks = banks;
    tableData.route_reports = [
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "success", tested_at: "2026-01-01", user_id: null },
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "success", tested_at: "2026-01-02", user_id: null },
    ];

    const result = await getCommunityReportedBanks("RTP");
    expect(result).toEqual([]);
  });

  it("uses each reporter's newest report on a route, not their oldest", async () => {
    tableData.banks = banks;
    tableData.route_reports = [
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "failed", tested_at: "2026-01-01", user_id: "u1" },
      { from_bank_id: "bank-a", from_bank_name: "Bank A", to_bank_id: "bank-b", status: "success", tested_at: "2026-01-05", user_id: "u1" },
    ];

    const result = await getCommunityReportedBanks("RTP");
    // Below the 2-reporter ranking threshold, but this still proves the
    // newest (success) report is what's used, not the older failed one.
    expect(result).toEqual([]);
  });
});

describe("getEddRankedBanks — dedup by reporter+bank", () => {
  const banks = [{ id: "bank-a", slug: "bank-a", name: "Bank A" }];

  it("does not let repeat submissions from one reporter inflate the average or count", async () => {
    tableData.banks = banks;
    tableData.edd_reports = [
      { bank_id: "bank-a", user_id: "u1", days_early: 0, created_at: "2026-01-01" },
      { bank_id: "bank-a", user_id: "u1", days_early: 2, created_at: "2026-01-02" }, // newest from u1
      { bank_id: "bank-a", user_id: "u2", days_early: 2, created_at: "2026-01-03" },
    ];

    const result = await getEddRankedBanks();
    expect(result).toEqual([
      { bankId: "bank-a", bankSlug: "bank-a", bankName: "Bank A", avgDaysEarly: 2, reportCount: 2, hasMoreThanFive: false },
    ]);
  });

  it("stays below the reporting threshold with only one distinct reporter, however many rows they submit", async () => {
    tableData.banks = banks;
    tableData.edd_reports = [
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-01" },
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-02" },
      { bank_id: "bank-a", user_id: "u1", days_early: 1, created_at: "2026-01-03" },
    ];

    const result = await getEddRankedBanks();
    expect(result).toEqual([]);
  });
});
