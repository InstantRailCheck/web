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
const secondEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const firstEqMock = vi.fn(() => ({ eq: secondEqMock }));
const selectMock = vi.fn(() => ({ eq: firstEqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { getBankFollowStatus } = await import("./getBankFollowStatus");

beforeEach(() => {
  currentUser = { id: "user-1" };
  maybeSingleResult = { data: null, error: null };
  getUserMock.mockClear();
  fromMock.mockClear();
  selectMock.mockClear();
  firstEqMock.mockClear();
  secondEqMock.mockClear();
});

describe("getBankFollowStatus", () => {
  it("returns following: false when unauthenticated (no query is even attempted)", async () => {
    currentUser = null;

    const result = await getBankFollowStatus("bank-a");

    expect(result).toEqual({ following: false });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns following: true when a row exists for this user and bank", async () => {
    maybeSingleResult = { data: { id: 1 }, error: null };

    const result = await getBankFollowStatus("bank-a");

    expect(result).toEqual({ following: true });
    expect(fromMock).toHaveBeenCalledWith("watchlist_bank_follows");
    expect(firstEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(secondEqMock).toHaveBeenCalledWith("bank_id", "bank-a");
  });

  it("returns following: false when no row exists", async () => {
    const result = await getBankFollowStatus("bank-a");

    expect(result).toEqual({ following: false });
  });

  it("returns following: false on a query error rather than throwing", async () => {
    maybeSingleResult = { data: null, error: { message: "db down" } };

    const result = await getBankFollowStatus("bank-a");

    expect(result).toEqual({ following: false });
  });
});
