import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

type QueryResult<T> = { data: T | null; error: { message: string } | null };

function makeChain(result: QueryResult<unknown>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    in: () => chain,
    or: () => chain,
    gte: () => chain,
    neq: () => chain,
    not: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (r: QueryResult<unknown>) => void) => resolve(result),
  };
  return chain;
}

let queues: Record<string, QueryResult<unknown>[]>;

const fromMock = vi.fn((table: string) => {
  const queue = queues[table];
  if (!queue || queue.length === 0) throw new Error(`unexpected query on ${table}`);
  return makeChain(queue.shift()!);
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: fromMock }) }));

const { getWatchlistActivity } = await import("./getWatchlistActivity");

beforeEach(() => {
  currentUser = { id: "user-1" };
  queues = {
    watchlist_bank_follows: [{ data: [], error: null }],
    watchlist_route_follows: [{ data: [], error: null }],
    watchlist_activity_last_seen: [{ data: null, error: null }],
  };
  getUserMock.mockClear();
  fromMock.mockClear();
});

describe("getWatchlistActivity (action)", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await getWatchlistActivity();

    expect(result).toEqual({ error: "You must be signed in." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("propagates a watchlist load error instead of proceeding", async () => {
    queues.watchlist_bank_follows = [{ data: null, error: { message: "db down" } }];

    const result = await getWatchlistActivity();

    expect(result).toEqual({ error: "Failed to load your watchlist." });
  });

  it("returns an empty item list when nothing is followed", async () => {
    const result = await getWatchlistActivity();

    expect(result).toEqual({ items: [] });
  });

  it("computes activity for a followed route with new evidence", async () => {
    queues.watchlist_route_follows = [
      { data: [{ from_bank_id: "bank-a", to_bank_id: "bank-b", created_at: "2026-01-01T00:00:00Z" }], error: null },
    ];
    const bankRows = {
      data: [
        { id: "bank-a", name: "Bank A", slug: "bank-a", is_active: true },
        { id: "bank-b", name: "Bank B", slug: "bank-b", is_active: true },
      ],
      error: null,
    };
    // Queried twice: once by getWatchlist() to resolve followed bank slugs,
    // once by computeWatchlistActivity() to resolve the activity items' banks.
    queues.banks = [bankRows, bankRows];
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const dateOnly = dayAgo.slice(0, 10);
    const newReport = {
      from_bank_id: "bank-a",
      to_bank_id: "bank-b",
      rail_used: "RTP",
      status: "success",
      tested_at: dateOnly,
      user_id: "u1",
      created_at: dayAgo,
    };
    queues.route_reports = [
      { data: [newReport], error: null }, // candidate query
      { data: [newReport], error: null }, // history query
    ];

    const result = await getWatchlistActivity();

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          fromBankSlug: "bank-a",
          toBankSlug: "bank-b",
          rail: "RTP",
          changeLabel: "New evidence: Limited evidence",
        }),
      ],
    });
  });
});
