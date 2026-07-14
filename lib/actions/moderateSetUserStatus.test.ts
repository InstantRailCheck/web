import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = { id: "admin-1" };
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
let targetIsAdmin = false;
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
  isAdminUser: () => targetIsAdmin,
}));

let getUserByIdResult: { data: { user: { id: string; app_metadata?: Record<string, unknown> } | null } | null; error: { message?: string } | null } = {
  data: { user: { id: "target-1" } },
  error: null,
};
const getUserByIdMock = vi.fn(() => Promise.resolve(getUserByIdResult));

let rpcResult: { error: { message?: string } | null } = { error: null };
const rpcMock = vi.fn(() => Promise.resolve(rpcResult));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { getUserById: getUserByIdMock } }, rpc: rpcMock }),
}));

const isActionRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isActionRateLimited: (...args: unknown[]) => isActionRateLimitedMock(...args),
}));

const reconcileAuthSyncMock = vi.fn();
vi.mock("@/lib/authSync", () => ({
  reconcileAuthSync: (...args: unknown[]) => reconcileAuthSyncMock(...args),
  USER_STATUS_VALUES: ["active", "restricted", "temporarily_banned", "permanently_banned"],
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const { moderateSetUserStatus } = await import("./moderateSetUserStatus");

beforeEach(() => {
  adminUser = { id: "admin-1" };
  targetIsAdmin = false;
  getUserByIdResult = { data: { user: { id: "target-1" } }, error: null };
  rpcResult = { error: null };
  requireAdminMock.mockClear();
  getUserByIdMock.mockClear();
  rpcMock.mockClear();
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  reconcileAuthSyncMock.mockClear();
  reconcileAuthSyncMock.mockResolvedValue({ synced: true });
  logErrorMock.mockClear();
});

describe("moderateSetUserStatus", () => {
  it("returns unauthorized and never calls the RPC when not an admin", async () => {
    adminUser = null;

    const result = await moderateSetUserStatus("target-1", "restricted", "spam", "spam");

    expect(result).toEqual({ error: "Unauthorized." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects self-action before ever calling the RPC", async () => {
    const result = await moderateSetUserStatus("admin-1", "restricted", "spam", "spam");

    expect(result).toEqual({ error: "You cannot moderate your own account." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a target whose app_metadata.role is administrative", async () => {
    targetIsAdmin = true;

    const result = await moderateSetUserStatus("target-1", "restricted", "spam", "spam");

    expect(result).toEqual({ error: "Cannot moderate another administrator." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid status", async () => {
    // @ts-expect-error deliberately invalid input
    const result = await moderateSetUserStatus("target-1", "banned_forever", "reason", "spam");

    expect(result).toEqual({ error: "Invalid status." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid reason category", async () => {
    // @ts-expect-error deliberately invalid input
    const result = await moderateSetUserStatus("target-1", "restricted", "reason", "not_a_category");

    expect(result).toEqual({ error: "Invalid reason category." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a missing reason", async () => {
    const result = await moderateSetUserStatus("target-1", "restricted", "   ", "spam");

    expect(result).toEqual({ error: "A reason (1-500 characters) is required." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("requires the typed confirmation for a permanent ban on the server", async () => {
    const result = await moderateSetUserStatus("target-1", "permanently_banned", "reason", "abuse");

    expect(result).toEqual({ error: "Type BAN to confirm a permanent ban." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("accepts an exact typed confirmation for a permanent ban", async () => {
    const result = await moderateSetUserStatus("target-1", "permanently_banned", "reason", "abuse", undefined, "BAN");

    expect(result).toEqual({ success: true });
    expect(rpcMock).toHaveBeenCalled();
  });

  it("rejects a temporary ban with no duration", async () => {
    const result = await moderateSetUserStatus("target-1", "temporarily_banned", "reason", "spam");

    expect("error" in result).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a temporary ban duration outside 1-8760 hours", async () => {
    const tooLow = await moderateSetUserStatus("target-1", "temporarily_banned", "reason", "spam", 0);
    const tooHigh = await moderateSetUserStatus("target-1", "temporarily_banned", "reason", "spam", 8761);

    expect("error" in tooLow).toBe(true);
    expect("error" in tooHigh).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await moderateSetUserStatus("target-1", "restricted", "reason", "spam");

    expect("error" in result).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an error when the target user doesn't exist", async () => {
    getUserByIdResult = { data: { user: null }, error: null };

    const result = await moderateSetUserStatus("target-1", "restricted", "reason", "spam");

    expect(result).toEqual({ error: "User not found." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls the RPC with trimmed params, including ban hours for a temporary suspension", async () => {
    const result = await moderateSetUserStatus("target-1", "temporarily_banned", "  abuse pattern  ", "abuse", 24);

    expect(result).toEqual({ success: true });
    expect(rpcMock).toHaveBeenCalledWith("moderate_set_user_status", {
      p_user_id: "target-1",
      p_moderator_id: "admin-1",
      p_status: "temporarily_banned",
      p_reason: "abuse pattern",
      p_reason_category: "abuse",
      p_ban_hours: 24,
    });
  });

  it("calls reconcileAuthSync for every status, including restricted (never skipped)", async () => {
    await moderateSetUserStatus("target-1", "restricted", "reason", "spam");
    expect(reconcileAuthSyncMock).toHaveBeenCalledWith(expect.anything(), "target-1");
  });

  it("logs and returns a generic failure for an RPC error", async () => {
    rpcResult = { error: { message: "constraint violation" } };

    const result = await moderateSetUserStatus("target-1", "restricted", "reason", "spam");

    expect(result).toEqual({ error: "Failed to update user status." });
    expect(logErrorMock).toHaveBeenCalled();
    expect(reconcileAuthSyncMock).not.toHaveBeenCalled();
  });

  it("returns success with an authSyncWarning when Auth sync fails, never silently reporting full success", async () => {
    reconcileAuthSyncMock.mockResolvedValue({ synced: false, warning: "Auth provider unavailable" });

    const result = await moderateSetUserStatus("target-1", "restricted", "reason", "spam");

    expect(result).toEqual({ success: true, authSyncWarning: "Auth provider unavailable" });
  });
});
