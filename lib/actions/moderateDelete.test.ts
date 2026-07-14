import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = { id: "admin-1" };
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

let rpcResult: { error: { code?: string; message?: string } | null } = { error: null };
const rpcMock = vi.fn(() => Promise.resolve(rpcResult));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
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

const { moderateDelete } = await import("./moderateDelete");

beforeEach(() => {
  adminUser = { id: "admin-1" };
  rpcResult = { error: null };
  requireAdminMock.mockClear();
  rpcMock.mockClear();
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  updateTagMock.mockClear();
  updateTagMock.mockReset();
  logErrorMock.mockClear();
});

describe("moderateDelete", () => {
  it("returns unauthorized and never calls the RPC when not an admin", async () => {
    adminUser = null;

    const result = await moderateDelete("route_reports", "row-1", "spam content", "spam");

    expect(result).toEqual({ error: "Unauthorized." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid target table", async () => {
    // @ts-expect-error deliberately invalid input
    const result = await moderateDelete("bank_corrections", "row-1", "reason", "spam");

    expect(result).toEqual({ error: "Invalid target." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid reason category", async () => {
    // @ts-expect-error deliberately invalid input
    const result = await moderateDelete("route_reports", "row-1", "reason", "not_a_category");

    expect(result).toEqual({ error: "Invalid reason category." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a missing (whitespace-only) reason", async () => {
    const result = await moderateDelete("route_reports", "row-1", "   ", "spam");

    expect(result).toEqual({ error: "A reason (1-500 characters) is required." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an over-length reason", async () => {
    const result = await moderateDelete("route_reports", "row-1", "x".repeat(501), "spam");

    expect(result).toEqual({ error: "A reason (1-500 characters) is required." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await moderateDelete("route_reports", "row-1", "spam content", "spam");

    expect("error" in result).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls the RPC with trimmed params and invalidates the cache for route_reports", async () => {
    const result = await moderateDelete("route_reports", "row-1", "  spam content  ", "spam");

    expect(result).toEqual({ success: true });
    expect(rpcMock).toHaveBeenCalledWith("moderate_delete_submission", {
      p_target_table: "route_reports",
      p_target_id: "row-1",
      p_moderator_id: "admin-1",
      p_reason: "spam content",
      p_reason_category: "spam",
    });
    expect(updateTagMock).toHaveBeenCalledWith("needs-fresh-reports");
  });

  it("invalidates the cache for route_requests too", async () => {
    await moderateDelete("route_requests", "row-1", "duplicate request", "duplicate");
    expect(updateTagMock).toHaveBeenCalledWith("needs-fresh-reports");
  });

  it("never invalidates the cache for edd_reports, which has no unstable_cache in front of it", async () => {
    const result = await moderateDelete("edd_reports", "row-1", "spam content", "spam");

    expect(result).toEqual({ success: true });
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it("surfaces the not_found (P0002) RPC error as an already-removed message", async () => {
    rpcResult = { error: { code: "P0002", message: "not_found" } };

    const result = await moderateDelete("route_reports", "row-1", "spam content", "spam");

    expect(result).toEqual({ error: "This submission was already removed." });
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it("logs and returns a generic failure for any other RPC error, without leaking details", async () => {
    rpcResult = { error: { code: "23514", message: "constraint violation detail" } };

    const result = await moderateDelete("route_reports", "row-1", "spam content", "spam");

    expect(result).toEqual({ error: "Failed to remove submission." });
    expect(logErrorMock).toHaveBeenCalledWith(
      "moderateDelete RPC failed",
      expect.objectContaining({ error: "constraint violation detail" })
    );
  });

  it("swallows an updateTag failure and still reports success, since the delete already committed", async () => {
    updateTagMock.mockImplementation(() => {
      throw new Error("cache backend unavailable");
    });

    const result = await moderateDelete("route_reports", "row-1", "spam content", "spam");

    expect(result).toEqual({ success: true });
    expect(logErrorMock).toHaveBeenCalledWith(
      "Failed to invalidate needs-fresh-reports cache after moderation delete",
      expect.objectContaining({ error: "cache backend unavailable" })
    );
  });
});
