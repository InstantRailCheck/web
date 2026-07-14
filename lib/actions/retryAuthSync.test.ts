import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = { id: "admin-1" };
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ marker: "admin-client" }),
}));

const reconcileAuthSyncMock = vi.fn();
vi.mock("@/lib/authSync", () => ({
  reconcileAuthSync: (...args: unknown[]) => reconcileAuthSyncMock(...args),
}));

const { retryAuthSync } = await import("./retryAuthSync");

beforeEach(() => {
  adminUser = { id: "admin-1" };
  requireAdminMock.mockClear();
  reconcileAuthSyncMock.mockClear();
  reconcileAuthSyncMock.mockResolvedValue({ synced: true });
});

describe("retryAuthSync", () => {
  it("returns unauthorized and never reconciles when not an admin", async () => {
    adminUser = null;

    const result = await retryAuthSync("target-1");

    expect(result).toEqual({ error: "Unauthorized." });
    expect(reconcileAuthSyncMock).not.toHaveBeenCalled();
  });

  it("re-reads current state via reconcileAuthSync rather than trusting stale caller state", async () => {
    const result = await retryAuthSync("target-1");

    expect(result).toEqual({ success: true });
    expect(reconcileAuthSyncMock).toHaveBeenCalledWith(expect.anything(), "target-1");
  });

  it("is reachable and surfaces the warning even when nothing currently signals a problem", async () => {
    reconcileAuthSyncMock.mockResolvedValue({ synced: false, warning: "still pending" });

    const result = await retryAuthSync("target-1");

    expect(result).toEqual({ error: "still pending" });
  });
});
