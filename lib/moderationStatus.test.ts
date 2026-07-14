import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getUserModerationStatus } = await import("./moderationStatus");

function mockAdmin(row: unknown) {
  const maybeSingle = vi.fn(() => Promise.resolve({ data: row }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as never;
}

describe("getUserModerationStatus", () => {
  it("is not blocked when no row exists (never moderated)", async () => {
    const result = await getUserModerationStatus(mockAdmin(null), "user-1");
    expect(result).toEqual({ blocked: false });
  });

  it("is not blocked when status is active", async () => {
    const result = await getUserModerationStatus(mockAdmin({ status: "active", ban_expires_at: null }), "user-1");
    expect(result).toEqual({ blocked: false });
  });

  it("is blocked when restricted", async () => {
    const result = await getUserModerationStatus(mockAdmin({ status: "restricted", ban_expires_at: null }), "user-1");
    expect(result).toEqual({ blocked: true, message: expect.any(String) });
  });

  it("is blocked when temporarily banned with a future expiry", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = await getUserModerationStatus(mockAdmin({ status: "temporarily_banned", ban_expires_at: future }), "user-1");
    expect(result).toEqual({ blocked: true, message: expect.any(String) });
  });

  it("is not blocked when temporarily banned but the expiry has passed", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = await getUserModerationStatus(mockAdmin({ status: "temporarily_banned", ban_expires_at: past }), "user-1");
    expect(result).toEqual({ blocked: false });
  });

  it("is blocked when permanently banned", async () => {
    const result = await getUserModerationStatus(mockAdmin({ status: "permanently_banned", ban_expires_at: null }), "user-1");
    expect(result).toEqual({ blocked: true, message: expect.any(String) });
  });
});
