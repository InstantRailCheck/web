import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let insertResult: { error: { code?: string } | null } = { error: null };
const insertMock = vi.fn(() => Promise.resolve(insertResult));
const fromMock = vi.fn(() => ({ insert: insertMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const isActionRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isActionRateLimited: (...args: unknown[]) => isActionRateLimitedMock(...args),
}));

const { followRoute } = await import("./followRoute");

beforeEach(() => {
  currentUser = { id: "user-1" };
  insertResult = { error: null };
  getUserMock.mockClear();
  insertMock.mockClear();
  fromMock.mockClear();
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
});

describe("followRoute", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await followRoute("bank-a", "bank-b");

    expect(result).toEqual({ error: "You must be signed in." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when the banks are the same", async () => {
    const result = await followRoute("bank-a", "bank-a");

    expect(result).toEqual({ error: "Sender and receiver banks must be different." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await followRoute("bank-a", "bank-b");

    expect("error" in result).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts a follow row on a real new watch", async () => {
    const result = await followRoute("bank-a", "bank-b");

    expect(result).toEqual({ success: true });
    expect(fromMock).toHaveBeenCalledWith("watchlist_route_follows");
    expect(insertMock).toHaveBeenCalledWith({ user_id: "user-1", from_bank_id: "bank-a", to_bank_id: "bank-b" });
  });

  it("treats a 23505 unique-violation (already watching) as success", async () => {
    insertResult = { error: { code: "23505" } };

    const result = await followRoute("bank-a", "bank-b");

    expect(result).toEqual({ success: true });
  });

  it("surfaces any other insert error as a failure", async () => {
    insertResult = { error: { code: "23000" } };

    const result = await followRoute("bank-a", "bank-b");

    expect(result).toEqual({ error: "Failed to watch this route." });
  });
});
