import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
function daysAgoDate(days: number): string {
  return daysAgoIso(days).slice(0, 10);
}

type Row = {
  from_bank_id: string;
  to_bank_id: string;
  rail_used: string | null;
  status: string;
  tested_at: string | null;
  user_id: string | null;
  created_at: string;
};
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };
type Calls = Record<string, unknown[][]>;

function makeChain<T>(result: QueryResult<T>, calls: Calls = {}) {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return chain;
    };
  const chain: Record<string, unknown> = {
    select: record("select"),
    or: record("or"),
    gte: record("gte"),
    neq: record("neq"),
    not: record("not"),
    in: record("in"),
    order: record("order"),
    then: (resolve: (r: QueryResult<T>) => void) => resolve(result),
  };
  return chain;
}

let routeReportsQueue: { result: QueryResult<Row>; calls: Calls }[] = [];
let banksResult: QueryResult<{ id: string; slug: string; name: string }> = { data: [], error: null };

const fromMock = vi.fn((table: string) => {
  if (table === "route_reports") {
    const next = routeReportsQueue.shift();
    if (!next) throw new Error("unexpected extra route_reports query");
    return makeChain(next.result, next.calls);
  }
  if (table === "banks") return makeChain(banksResult);
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: fromMock }) }));

const {
  computeWatchlistActivity,
  buildWatchlistFollowIndex,
  matchesWatchlist,
  resolveActivityLastSeenAt,
  activityQueryCutoff,
} = await import("./watchlistActivity");

function queueRouteReports(rows: Row[], calls: Calls = {}) {
  routeReportsQueue.push({ result: { data: rows, error: null }, calls });
}

const BANK_A = { id: "bank-a", slug: "bank-a", name: "Bank A" };
const BANK_B = { id: "bank-b", slug: "bank-b", name: "Bank B" };

function routeFollow(fromId: string, toId: string) {
  return {
    fromBankId: fromId,
    fromBankName: "",
    fromBankSlug: "",
    fromBankIsActive: true,
    toBankId: toId,
    toBankName: "",
    toBankSlug: "",
    toBankIsActive: true,
    followedAt: daysAgoIso(30),
  };
}

function bankFollow(id: string) {
  return { bankId: id, bankName: "", bankSlug: "", bankIsActive: true, followedAt: daysAgoIso(30) };
}

beforeEach(() => {
  routeReportsQueue = [];
  banksResult = { data: [BANK_A, BANK_B], error: null };
  fromMock.mockClear();
});

describe("pure helpers", () => {
  it("buildWatchlistFollowIndex unions bank-follow and route-follow endpoint ids", () => {
    const index = buildWatchlistFollowIndex({ banks: [bankFollow("bank-c")], routes: [routeFollow("bank-a", "bank-b")] });
    expect(index.bankFollowIds).toEqual(new Set(["bank-c"]));
    expect(index.routeFollowKeys).toEqual(new Set(["bank-a::bank-b"]));
    expect(index.allBankIds).toEqual(new Set(["bank-c", "bank-a", "bank-b"]));
  });

  it("matchesWatchlist matches a bank-follow on either side but a route-follow only in its own direction", () => {
    const index = buildWatchlistFollowIndex({ banks: [bankFollow("bank-c")], routes: [routeFollow("bank-a", "bank-b")] });
    expect(matchesWatchlist({ from_bank_id: "bank-c", to_bank_id: "bank-x" }, index)).toBe(true);
    expect(matchesWatchlist({ from_bank_id: "bank-x", to_bank_id: "bank-c" }, index)).toBe(true);
    expect(matchesWatchlist({ from_bank_id: "bank-a", to_bank_id: "bank-b" }, index)).toBe(true);
    expect(matchesWatchlist({ from_bank_id: "bank-b", to_bank_id: "bank-a" }, index)).toBe(false);
  });

  it("resolveActivityLastSeenAt defaults to FRESHNESS_WINDOW_DAYS ago when no row exists", () => {
    const resolved = resolveActivityLastSeenAt(null);
    const expectedMs = Date.now() - 180 * DAY_MS;
    expect(Math.abs(new Date(resolved).getTime() - expectedMs)).toBeLessThan(5000);
  });

  it("resolveActivityLastSeenAt passes through an existing timestamp untouched", () => {
    expect(resolveActivityLastSeenAt("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
  });

  it("activityQueryCutoff clamps a very old last-seen timestamp to the freshness window", () => {
    const veryOld = daysAgoIso(400);
    const cutoff = activityQueryCutoff(veryOld);
    const expectedMs = Date.now() - 180 * DAY_MS;
    expect(Math.abs(new Date(cutoff).getTime() - expectedMs)).toBeLessThan(5000);
  });

  it("activityQueryCutoff leaves a recent last-seen timestamp unclamped", () => {
    const recent = daysAgoIso(2);
    expect(activityQueryCutoff(recent)).toBe(recent);
  });
});

describe("computeWatchlistActivity", () => {
  const lastSeenAt = daysAgoIso(5);

  it("returns nothing and never queries route_reports when the watchlist is empty", async () => {
    const items = await computeWatchlistActivity("user-1", { banks: [], routes: [] }, lastSeenAt);
    expect(items).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("labels a route with no prior evidence as newly confirmed once two fresh successes exist", async () => {
    const candidateCalls: Calls = {};
    const newReport: Row = {
      from_bank_id: "bank-a",
      to_bank_id: "bank-b",
      rail_used: "RTP",
      status: "success",
      tested_at: daysAgoDate(1),
      user_id: "u1",
      created_at: daysAgoIso(1),
    };
    queueRouteReports([newReport], candidateCalls);
    queueRouteReports([
      newReport,
      { ...newReport, user_id: "u2", tested_at: daysAgoDate(2), created_at: daysAgoIso(2) },
    ]);

    const watchlist = { banks: [], routes: [routeFollow("bank-a", "bank-b")] };
    const items = await computeWatchlistActivity("user-1", watchlist, lastSeenAt);

    expect(items).toEqual([
      expect.objectContaining({
        fromBankSlug: "bank-a",
        toBankSlug: "bank-b",
        rail: "RTP",
        changeLabel: "Newly confirmed working",
      }),
    ]);
    // The candidate query excludes the caller's own reports and stays
    // bounded to the resolved cutoff.
    expect(candidateCalls.neq).toEqual([["user_id", "user-1"]]);
    expect(candidateCalls.not).toEqual([["user_id", "is", null]]);
  });

  it("labels a state change from previously_observed to limited_evidence", async () => {
    const oldReport: Row = {
      from_bank_id: "bank-a",
      to_bank_id: "bank-b",
      rail_used: "ACH",
      status: "success",
      tested_at: daysAgoDate(200),
      user_id: "u0",
      created_at: daysAgoIso(200),
    };
    const newReport: Row = {
      from_bank_id: "bank-a",
      to_bank_id: "bank-b",
      rail_used: "ACH",
      status: "success",
      tested_at: daysAgoDate(1),
      user_id: "u1",
      created_at: daysAgoIso(1),
    };
    queueRouteReports([newReport]);
    queueRouteReports([oldReport, newReport]);

    const watchlist = { banks: [], routes: [routeFollow("bank-a", "bank-b")] };
    const items = await computeWatchlistActivity("user-1", watchlist, lastSeenAt);

    expect(items).toEqual([
      expect.objectContaining({ changeLabel: "Evidence updated: Previously observed → Limited evidence" }),
    ]);
  });

  it("labels an additional report that doesn't move the evidence state as a plain new report", async () => {
    const priorReporters = ["u0", "u1", "u2"].map((id, i) => ({
      from_bank_id: "bank-a",
      to_bank_id: "bank-b",
      rail_used: "Wire",
      status: "success",
      tested_at: daysAgoDate(10 + i),
      user_id: id,
      created_at: daysAgoIso(10 + i),
    })) as Row[];
    const newReport: Row = {
      from_bank_id: "bank-a",
      to_bank_id: "bank-b",
      rail_used: "Wire",
      status: "success",
      tested_at: daysAgoDate(1),
      user_id: "u3",
      created_at: daysAgoIso(1),
    };
    queueRouteReports([newReport]);
    queueRouteReports([...priorReporters, newReport]);

    const watchlist = { banks: [], routes: [routeFollow("bank-a", "bank-b")] };
    const items = await computeWatchlistActivity("user-1", watchlist, lastSeenAt);

    expect(items).toEqual([
      expect.objectContaining({ changeLabel: "New report added (still Consistently reported)" }),
    ]);
  });

  it("ignores a report on the reverse direction of a followed route", async () => {
    const reverseReport: Row = {
      from_bank_id: "bank-b",
      to_bank_id: "bank-a",
      rail_used: "RTP",
      status: "success",
      tested_at: daysAgoDate(1),
      user_id: "u1",
      created_at: daysAgoIso(1),
    };
    queueRouteReports([reverseReport]);

    const watchlist = { banks: [], routes: [routeFollow("bank-a", "bank-b")] };
    const items = await computeWatchlistActivity("user-1", watchlist, lastSeenAt);

    expect(items).toEqual([]);
    // Only the candidate query should run — filtered out before any history/banks lookup.
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("matches a bank-follow on either side of the report", async () => {
    const report: Row = {
      from_bank_id: "bank-x",
      to_bank_id: "bank-a",
      rail_used: "Zelle",
      status: "success",
      tested_at: daysAgoDate(1),
      user_id: "u1",
      created_at: daysAgoIso(1),
    };
    queueRouteReports([report]);
    queueRouteReports([report]);
    banksResult = { data: [BANK_A, { id: "bank-x", slug: "bank-x", name: "Bank X" }], error: null };

    const watchlist = { banks: [bankFollow("bank-a")], routes: [] };
    const items = await computeWatchlistActivity("user-1", watchlist, lastSeenAt);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ fromBankSlug: "bank-x", toBankSlug: "bank-a" });
  });
});
