import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

type BankFollowRow = { bank_id: string; created_at: string };
type RouteFollowRow = { from_bank_id: string; to_bank_id: string; created_at: string };
type BankRow = { id: string; name: string; slug: string; is_active: boolean };

let bankFollowsResult: { data: BankFollowRow[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
let routeFollowsResult: { data: RouteFollowRow[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
let banksResult: { data: BankRow[] | null; error: { message: string } | null } = { data: [], error: null };

const bankFollowsOrderMock = vi.fn(() => Promise.resolve(bankFollowsResult));
const bankFollowsEqMock = vi.fn(() => ({ order: bankFollowsOrderMock }));
const bankFollowsSelectMock = vi.fn(() => ({ eq: bankFollowsEqMock }));

const routeFollowsOrderMock = vi.fn(() => Promise.resolve(routeFollowsResult));
const routeFollowsEqMock = vi.fn(() => ({ order: routeFollowsOrderMock }));
const routeFollowsSelectMock = vi.fn(() => ({ eq: routeFollowsEqMock }));

const banksInMock = vi.fn(() => Promise.resolve(banksResult));
const banksSelectMock = vi.fn(() => ({ in: banksInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "watchlist_bank_follows") return { select: bankFollowsSelectMock };
  if (table === "watchlist_route_follows") return { select: routeFollowsSelectMock };
  if (table === "banks") return { select: banksSelectMock };
  throw new Error(`unexpected table ${table}`);
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { getWatchlist } = await import("./getWatchlist");

beforeEach(() => {
  currentUser = { id: "user-1" };
  bankFollowsResult = { data: [], error: null };
  routeFollowsResult = { data: [], error: null };
  banksResult = { data: [], error: null };
  getUserMock.mockClear();
  fromMock.mockClear();
  bankFollowsSelectMock.mockClear();
  bankFollowsEqMock.mockClear();
  routeFollowsSelectMock.mockClear();
  routeFollowsEqMock.mockClear();
  banksSelectMock.mockClear();
  banksInMock.mockClear();
});

describe("getWatchlist", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await getWatchlist();

    expect(result).toEqual({ error: "You must be signed in." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns empty lists and skips the banks query when nothing is followed", async () => {
    const result = await getWatchlist();

    expect(result).toEqual({ banks: [], routes: [] });
    expect(banksSelectMock).not.toHaveBeenCalled();
  });

  it("joins bank and route follows against banks, including an inactive bank truthfully", async () => {
    bankFollowsResult = { data: [{ bank_id: "bank-a", created_at: "2026-08-01T00:00:00Z" }], error: null };
    routeFollowsResult = {
      data: [{ from_bank_id: "bank-a", to_bank_id: "bank-b", created_at: "2026-08-02T00:00:00Z" }],
      error: null,
    };
    banksResult = {
      data: [
        { id: "bank-a", name: "Bank A", slug: "bank-a", is_active: true },
        { id: "bank-b", name: "Bank B", slug: "bank-b", is_active: false },
      ],
      error: null,
    };

    const result = await getWatchlist();

    expect(result).toEqual({
      banks: [
        {
          bankId: "bank-a",
          bankName: "Bank A",
          bankSlug: "bank-a",
          bankIsActive: true,
          followedAt: "2026-08-01T00:00:00Z",
        },
      ],
      routes: [
        {
          fromBankId: "bank-a",
          fromBankName: "Bank A",
          fromBankSlug: "bank-a",
          fromBankIsActive: true,
          toBankId: "bank-b",
          toBankName: "Bank B",
          toBankSlug: "bank-b",
          toBankIsActive: false,
          followedAt: "2026-08-02T00:00:00Z",
        },
      ],
    });
  });

  it("drops an entry whose bank row can no longer be found, rather than crashing or fabricating one", async () => {
    bankFollowsResult = { data: [{ bank_id: "bank-missing", created_at: "2026-08-01T00:00:00Z" }], error: null };
    banksResult = { data: [], error: null };

    const result = await getWatchlist();

    expect(result).toEqual({ banks: [], routes: [] });
  });

  it("returns an error when the bank-follows query fails", async () => {
    bankFollowsResult = { data: null, error: { message: "db down" } };

    const result = await getWatchlist();

    expect(result).toEqual({ error: "Failed to load your watchlist." });
  });

  it("returns an error when the route-follows query fails", async () => {
    routeFollowsResult = { data: null, error: { message: "db down" } };

    const result = await getWatchlist();

    expect(result).toEqual({ error: "Failed to load your watchlist." });
  });

  it("returns an error when the banks join query fails", async () => {
    bankFollowsResult = { data: [{ bank_id: "bank-a", created_at: "2026-08-01T00:00:00Z" }], error: null };
    banksResult = { data: null, error: { message: "db down" } };

    const result = await getWatchlist();

    expect(result).toEqual({ error: "Failed to load your watchlist." });
  });
});
