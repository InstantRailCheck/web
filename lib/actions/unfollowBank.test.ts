import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let deleteResult: { error: { message: string } | null } = { error: null };
const eqMock = vi.fn();
type Chain = { eq: (...args: unknown[]) => Chain; then: (resolve: (v: typeof deleteResult) => void) => void };
const deleteChain: Chain = {
  eq: (...args: unknown[]) => {
    eqMock(...args);
    return deleteChain;
  },
  then: (resolve) => resolve(deleteResult),
};
const deleteMock = vi.fn(() => deleteChain);
const fromMock = vi.fn(() => ({ delete: deleteMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { unfollowBank } = await import("./unfollowBank");

beforeEach(() => {
  currentUser = { id: "user-1" };
  deleteResult = { error: null };
  getUserMock.mockClear();
  deleteMock.mockClear();
  eqMock.mockClear();
  fromMock.mockClear();
});

describe("unfollowBank", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await unfollowBank("bank-a");

    expect(result).toEqual({ error: "You must be signed in." });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes the follow row scoped to the caller's own user_id", async () => {
    const result = await unfollowBank("bank-a");

    expect(result).toEqual({ success: true });
    expect(fromMock).toHaveBeenCalledWith("watchlist_bank_follows");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqMock).toHaveBeenCalledWith("bank_id", "bank-a");
  });

  it("surfaces a delete error as a failure", async () => {
    deleteResult = { error: { message: "db down" } };

    const result = await unfollowBank("bank-a");

    expect(result).toEqual({ error: "Failed to unfollow this bank." });
  });
});
