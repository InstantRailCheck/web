import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let upsertResult: { error: { message: string } | null } = { error: null };
const upsertMock = vi.fn<
  (row: { user_id: string; last_seen_at: string }, options: { onConflict: string }) => Promise<{
    error: { message: string } | null;
  }>
>(() => Promise.resolve(upsertResult));
const fromMock = vi.fn(() => ({ upsert: upsertMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: fromMock }) }));

const { markWatchlistActivitySeen } = await import("./markWatchlistActivitySeen");

beforeEach(() => {
  currentUser = { id: "user-1" };
  upsertResult = { error: null };
  getUserMock.mockClear();
  fromMock.mockClear();
  upsertMock.mockClear();
});

describe("markWatchlistActivitySeen", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await markWatchlistActivitySeen();

    expect(result).toEqual({ error: "You must be signed in." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("upserts the caller's last-seen timestamp keyed on user_id", async () => {
    const result = await markWatchlistActivitySeen();

    expect(result).toEqual({ success: true });
    expect(fromMock).toHaveBeenCalledWith("watchlist_activity_last_seen");
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [row, options] = upsertMock.mock.calls[0];
    expect(row).toMatchObject({ user_id: "user-1" });
    expect(typeof row.last_seen_at).toBe("string");
    expect(options).toEqual({ onConflict: "user_id" });
  });

  it("returns an error when the upsert fails", async () => {
    upsertResult = { error: { message: "db down" } };

    const result = await markWatchlistActivitySeen();

    expect(result).toEqual({ error: "Failed to update watchlist activity." });
  });
});
