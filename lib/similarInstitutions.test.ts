import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let tableData: unknown[] = [];
const calls: { method: string; args: unknown[] }[] = [];

function fakeQueryBuilder() {
  const builder: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };
  builder.select = record("select");
  builder.eq = record("eq");
  builder.neq = record("neq");
  builder.is = record("is");
  builder.order = record("order");
  builder.limit = record("limit");
  builder.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: tableData, error: null });
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => fakeQueryBuilder(),
  }),
}));

const { getSimilarBanks, SIMILAR_BANKS_LIMIT } = await import("./similarInstitutions");

beforeEach(() => {
  tableData = [];
  calls.length = 0;
});

function bankRow(overrides: Partial<{ slug: string; name: string; city: string | null; state: string | null }> = {}) {
  return { slug: "chase", name: "Chase", city: "New York", state: "NY", ...overrides };
}

describe("getSimilarBanks", () => {
  it("returns an empty array without querying when the bank's state is null", async () => {
    const result = await getSimilarBanks({ id: "bank-a", state: null, source_authority: "fdic" });
    expect(result).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("filters on state and excludes the current bank via neq", async () => {
    tableData = [bankRow()];
    await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: "fdic" });

    expect(calls).toContainEqual({ method: "eq", args: ["state", "NY"] });
    expect(calls).toContainEqual({ method: "neq", args: ["id", "bank-a"] });
  });

  it("only queries currently active institutions", async () => {
    await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: "fdic" });
    expect(calls).toContainEqual({ method: "eq", args: ["is_active", true] });
  });

  it("uses .eq() for a non-null source_authority", async () => {
    await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: "ncua" });
    expect(calls).toContainEqual({ method: "eq", args: ["source_authority", "ncua"] });
    expect(calls.some((c) => c.method === "is")).toBe(false);
  });

  it("uses .is() rather than .eq() for a null source_authority", async () => {
    await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: null });
    expect(calls).toContainEqual({ method: "is", args: ["source_authority", null] });
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "source_authority")).toBe(false);
  });

  it("orders by total_assets descending with nulls last, then a stable id tiebreak", async () => {
    await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: "fdic" });
    expect(calls).toContainEqual({ method: "order", args: ["total_assets", { ascending: false, nullsFirst: false }] });
    expect(calls).toContainEqual({ method: "order", args: ["id", { ascending: true }] });
  });

  it("respects the default limit constant", async () => {
    await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: "fdic" });
    expect(calls).toContainEqual({ method: "limit", args: [SIMILAR_BANKS_LIMIT] });
  });

  it("respects an explicit limit override", async () => {
    await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: "fdic" }, 2);
    expect(calls).toContainEqual({ method: "limit", args: [2] });
  });

  it("returns the resolved rows", async () => {
    tableData = [bankRow({ slug: "boa", name: "Bank of America" })];
    const result = await getSimilarBanks({ id: "bank-a", state: "NY", source_authority: "fdic" });
    expect(result).toEqual([{ slug: "boa", name: "Bank of America", city: "New York", state: "NY" }]);
  });
});
