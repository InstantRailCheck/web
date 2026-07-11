import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// A more faithful fake than a pure passthrough: getActivityFeed's
// attributable-only fix lives in the query itself (.not("user_id", "is",
// null)), not in downstream JS, so the fake needs to actually apply .eq/.not
// filters and .order sorting for the fix to be exercised at all.
function fakeQueryBuilder(data: Record<string, unknown>[]) {
  let rows = [...data];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (col: string, val: unknown) => {
    rows = rows.filter((r) => r[col] === val);
    return builder;
  };
  builder.not = (col: string, op: string, val: unknown) => {
    if (op === "is" && val === null) rows = rows.filter((r) => r[col] !== null);
    return builder;
  };
  builder.order = (col: string, opts?: { ascending?: boolean }) => {
    rows = [...rows].sort((a, b) => {
      const av = a[col] as string;
      const bv = b[col] as string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return opts?.ascending === false ? -cmp : cmp;
    });
    return builder;
  };
  builder.limit = (n: number) => {
    rows = rows.slice(0, n);
    return builder;
  };
  builder.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null });
  return builder;
}

let tableData: Record<string, Record<string, unknown>[]> = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fakeQueryBuilder(tableData[table] ?? []),
  }),
}));

const { getActivityFeed } = await import("./activityFeed");

beforeEach(() => {
  tableData = { banks: [] };
});

describe("getActivityFeed — attributable-only reports", () => {
  it("excludes unattributed (seed/legacy) route reports from the feed entirely", async () => {
    tableData.route_reports = [
      {
        id: "r1", from_bank_id: "a", from_bank_name: "A", to_bank_id: "b", to_bank_name: "B",
        rail_used: "RTP", status: "success", created_at: "2026-01-01", user_id: null,
      },
      {
        id: "r2", from_bank_id: "a", from_bank_name: "A", to_bank_id: "b", to_bank_name: "B",
        rail_used: "RTP", status: "success", created_at: "2026-01-02", user_id: "u1",
      },
    ];

    const feed = await getActivityFeed(30);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ type: "report", id: "report-r2" });
  });

  it("scores 'first confirmed' per directional route+rail, not from-bank+rail alone", async () => {
    // Two distinct routes (a->b and a->c) on the same rail from the same
    // sender — each is the genuine first success for its own route, so both
    // should be able to earn the badge independently.
    tableData.route_reports = [
      {
        id: "r1", from_bank_id: "a", from_bank_name: "A", to_bank_id: "b", to_bank_name: "B",
        rail_used: "RTP", status: "success", created_at: "2026-01-01", user_id: "u1",
      },
      {
        id: "r2", from_bank_id: "a", from_bank_name: "A", to_bank_id: "c", to_bank_name: "C",
        rail_used: "RTP", status: "success", created_at: "2026-01-02", user_id: "u2",
      },
    ];

    const feed = await getActivityFeed(30);
    const r1 = feed.find((i) => i.id === "report-r1");
    const r2 = feed.find((i) => i.id === "report-r2");
    expect(r1 && "isFirstConfirmed" in r1 && r1.isFirstConfirmed).toBe(true);
    expect(r2 && "isFirstConfirmed" in r2 && r2.isFirstConfirmed).toBe(true);
  });

  it("does not let an earlier unattributed success claim 'first confirmed' ahead of a real report", async () => {
    tableData.route_reports = [
      {
        id: "seed", from_bank_id: "a", from_bank_name: "A", to_bank_id: "b", to_bank_name: "B",
        rail_used: "RTP", status: "success", created_at: "2020-01-01", user_id: null,
      },
      {
        id: "real", from_bank_id: "a", from_bank_name: "A", to_bank_id: "b", to_bank_name: "B",
        rail_used: "RTP", status: "success", created_at: "2026-01-01", user_id: "u1",
      },
    ];

    const feed = await getActivityFeed(30);
    expect(feed).toHaveLength(1);
    const real = feed.find((i) => i.id === "report-real");
    expect(real && "isFirstConfirmed" in real && real.isFirstConfirmed).toBe(true);
  });

  it("still includes bank_added items alongside attributable reports", async () => {
    tableData.banks = [{ id: "a", slug: "bank-a", name: "Bank A", created_at: "2026-01-03" }];
    tableData.route_reports = [
      {
        id: "r1", from_bank_id: "a", from_bank_name: "A", to_bank_id: "b", to_bank_name: "B",
        rail_used: "RTP", status: "success", created_at: "2026-01-01", user_id: "u1",
      },
    ];

    const feed = await getActivityFeed(30);
    expect(feed.map((i) => i.type).sort()).toEqual(["bank_added", "report"]);
  });
});
