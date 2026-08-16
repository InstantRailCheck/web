import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

type QueryResult<T> = { data: T | null; error: { message: string } | null };

function makeChain(result: QueryResult<unknown>, calls: Record<string, unknown[][]> = {}) {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return chain;
    };
  const chain: Record<string, unknown> = {
    select: record("select"),
    eq: record("eq"),
    order: record("order"),
    in: record("in"),
    or: record("or"),
    gte: record("gte"),
    neq: record("neq"),
    not: record("not"),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (r: QueryResult<unknown>) => void) => resolve(result),
  };
  return chain;
}

let queues: Record<string, QueryResult<unknown>[]>;
let routeReportsCalls: Record<string, unknown[][]>;

const fromMock = vi.fn((table: string) => {
  if (table === "route_reports") return makeChain(queues.route_reports.shift()!, routeReportsCalls);
  const queue = queues[table];
  if (!queue || queue.length === 0) throw new Error(`unexpected query on ${table}`);
  return makeChain(queue.shift()!);
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: fromMock }) }));

const { getWatchlistActivityCount } = await import("./getWatchlistActivityCount");

beforeEach(() => {
  currentUser = { id: "user-1" };
  routeReportsCalls = {};
  queues = {
    watchlist_bank_follows: [{ data: [], error: null }],
    watchlist_route_follows: [{ data: [], error: null }],
    watchlist_activity_last_seen: [{ data: null, error: null }],
    route_reports: [],
  };
  getUserMock.mockClear();
  fromMock.mockClear();
});

describe("getWatchlistActivityCount", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await getWatchlistActivityCount();

    expect(result).toEqual({ error: "You must be signed in." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("propagates a watchlist load error", async () => {
    queues.watchlist_bank_follows = [{ data: null, error: { message: "db down" } }];

    const result = await getWatchlistActivityCount();

    expect(result).toEqual({ error: "Failed to load your watchlist." });
  });

  it("returns 0 without querying route_reports when nothing is followed", async () => {
    const result = await getWatchlistActivityCount();

    expect(result).toEqual({ count: 0 });
    expect(fromMock).not.toHaveBeenCalledWith("route_reports");
  });

  it("counts qualifying reports and excludes the caller's own reports at the query level", async () => {
    queues.watchlist_bank_follows = [
      { data: [{ bank_id: "bank-a", created_at: "2026-01-01T00:00:00Z" }], error: null },
    ];
    queues.banks = [{ data: [{ id: "bank-a", name: "Bank A", slug: "bank-a", is_active: true }], error: null }];
    queues.route_reports = [{ data: [{ from_bank_id: "bank-a", to_bank_id: "bank-c" }], error: null }];

    const result = await getWatchlistActivityCount();

    expect(result).toEqual({ count: 1 });
    expect(routeReportsCalls.neq).toEqual([["user_id", "user-1"]]);
    expect(routeReportsCalls.not).toEqual([["user_id", "is", null]]);
  });

  it("returns an error when the route_reports query fails", async () => {
    queues.watchlist_bank_follows = [
      { data: [{ bank_id: "bank-a", created_at: "2026-01-01T00:00:00Z" }], error: null },
    ];
    queues.banks = [{ data: [{ id: "bank-a", name: "Bank A", slug: "bank-a", is_active: true }], error: null }];
    queues.route_reports = [{ data: null, error: { message: "db down" } }];

    const result = await getWatchlistActivityCount();

    expect(result).toEqual({ error: "Failed to load watchlist activity." });
  });
});
