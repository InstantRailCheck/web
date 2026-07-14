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

const getUserModerationStatusMock = vi.fn();
vi.mock("@/lib/moderationStatus", () => ({
  getUserModerationStatus: (...args: unknown[]) => getUserModerationStatusMock(...args),
}));

const isActionRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isActionRateLimited: (...args: unknown[]) => isActionRateLimitedMock(...args),
}));

const updateTagMock = vi.fn();
vi.mock("next/cache", () => ({
  updateTag: (...args: unknown[]) => updateTagMock(...args),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const { requestRoute } = await import("./requestRoute");

beforeEach(() => {
  currentUser = { id: "user-1" };
  insertResult = { error: null };
  getUserMock.mockClear();
  insertMock.mockClear();
  fromMock.mockClear();
  getUserModerationStatusMock.mockClear();
  getUserModerationStatusMock.mockResolvedValue({ blocked: false });
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  updateTagMock.mockClear();
  updateTagMock.mockReset();
  logErrorMock.mockClear();
});

describe("requestRoute", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await requestRoute("bank-a", "bank-b");

    expect(result).toEqual({ error: "You must be signed in." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns the moderation status message and never inserts when the user is restricted/banned", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "Your account is currently restricted from submitting." });

    const result = await requestRoute("bank-a", "bank-b");

    expect(result).toEqual({ error: "Your account is currently restricted from submitting." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when the banks are the same", async () => {
    const result = await requestRoute("bank-a", "bank-a");

    expect(result).toEqual({ error: "Sender and receiver banks must be different." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await requestRoute("bank-a", "bank-b");

    expect("error" in result).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts and invalidates the needs-fresh-reports cache on a real new request", async () => {
    const result = await requestRoute("bank-a", "bank-b");

    expect(result).toEqual({ success: true });
    expect(fromMock).toHaveBeenCalledWith("route_requests");
    expect(insertMock).toHaveBeenCalledWith({
      from_bank_id: "bank-a",
      to_bank_id: "bank-b",
      user_id: "user-1",
    });
    expect(updateTagMock).toHaveBeenCalledWith("needs-fresh-reports");
  });

  // The actual fix this round of review caught: a duplicate request (no new
  // row) must not trigger cache invalidation, or an authenticated caller
  // could force the expensive recomputation on demand with zero real writes.
  it("treats a 23505 unique-violation as success but does NOT invalidate the cache", async () => {
    insertResult = { error: { code: "23505" } };

    const result = await requestRoute("bank-a", "bank-b");

    expect(result).toEqual({ success: true });
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it("surfaces any other insert error as a failure and does not invalidate the cache", async () => {
    insertResult = { error: { code: "23000" } };

    const result = await requestRoute("bank-a", "bank-b");

    expect(result).toEqual({ error: "Failed to submit request." });
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it("swallows an updateTag failure and still reports success, since the write already committed", async () => {
    updateTagMock.mockImplementation(() => {
      throw new Error("cache backend unavailable");
    });

    const result = await requestRoute("bank-a", "bank-b");

    expect(result).toEqual({ success: true });
    expect(logErrorMock).toHaveBeenCalledWith(
      "Failed to invalidate needs-fresh-reports cache after request creation",
      expect.objectContaining({ error: "cache backend unavailable" })
    );
  });
});
