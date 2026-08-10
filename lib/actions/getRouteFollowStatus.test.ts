import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let maybeSingleResult: { data: { id: number } | null; error: { message: string } | null } = {
  data: null,
  error: null,
};
const maybeSingleMock = vi.fn(() => Promise.resolve(maybeSingleResult));
const thirdEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const secondEqMock = vi.fn(() => ({ eq: thirdEqMock }));
const firstEqMock = vi.fn(() => ({ eq: secondEqMock }));
const selectMock = vi.fn(() => ({ eq: firstEqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { getRouteFollowStatus } = await import("./getRouteFollowStatus");

beforeEach(() => {
  currentUser = { id: "user-1" };
  maybeSingleResult = { data: null, error: null };
  getUserMock.mockClear();
  fromMock.mockClear();
  selectMock.mockClear();
  firstEqMock.mockClear();
  secondEqMock.mockClear();
  thirdEqMock.mockClear();
});

describe("getRouteFollowStatus", () => {
  it("returns following: false when unauthenticated (no query is even attempted)", async () => {
    currentUser = null;

    const result = await getRouteFollowStatus("bank-a", "bank-b");

    expect(result).toEqual({ following: false });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns following: true when a row exists for this user and pair", async () => {
    maybeSingleResult = { data: { id: 1 }, error: null };

    const result = await getRouteFollowStatus("bank-a", "bank-b");

    expect(result).toEqual({ following: true });
    expect(fromMock).toHaveBeenCalledWith("watchlist_route_follows");
    expect(firstEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(secondEqMock).toHaveBeenCalledWith("from_bank_id", "bank-a");
    expect(thirdEqMock).toHaveBeenCalledWith("to_bank_id", "bank-b");
  });

  it("returns following: false when no row exists", async () => {
    const result = await getRouteFollowStatus("bank-a", "bank-b");

    expect(result).toEqual({ following: false });
  });

  it("returns following: false on a query error rather than throwing", async () => {
    maybeSingleResult = { data: null, error: { message: "db down" } };

    const result = await getRouteFollowStatus("bank-a", "bank-b");

    expect(result).toEqual({ following: false });
  });
});
