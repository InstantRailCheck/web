import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = { id: "admin-1" };
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
let targetIsAdmin = false;
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
  isAdminUser: () => targetIsAdmin,
}));

let getUserByIdResult: { data: { user: { id: string } | null } | null; error: { message?: string } | null } = {
  data: { user: { id: "target-1" } },
  error: null,
};
const getUserByIdMock = vi.fn(() => Promise.resolve(getUserByIdResult));

let deleteUserResult: { error: { message?: string } | null } = { error: null };
const deleteUserMock = vi.fn(() => Promise.resolve(deleteUserResult));

let insertSingleResult: { data: { id: string } | null; error: { message?: string } | null } = { data: { id: "audit-1" }, error: null };
const singleMock = vi.fn(() => Promise.resolve(insertSingleResult));
const selectMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn(() => ({ select: selectMock }));
let updateEqResult: { data: null; error: { message: string } | null } = { data: null, error: null };
const updateEqMock = vi.fn(() => Promise.resolve(updateEqResult));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));
const fromMock = vi.fn(() => ({ insert: insertMock, update: updateMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock, deleteUser: deleteUserMock } },
    from: fromMock,
  }),
}));

const isActionRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isActionRateLimited: (...args: unknown[]) => isActionRateLimitedMock(...args),
}));

vi.mock("@/lib/authSync", () => ({
  sanitizeProviderError: (message: string) => `sanitized:${message}`,
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const { moderateDeleteUserAccount } = await import("./moderateDeleteUserAccount");

beforeEach(() => {
  adminUser = { id: "admin-1" };
  targetIsAdmin = false;
  getUserByIdResult = { data: { user: { id: "target-1" } }, error: null };
  deleteUserResult = { error: null };
  insertSingleResult = { data: { id: "audit-1" }, error: null };
  updateEqResult = { data: null, error: null };
  requireAdminMock.mockClear();
  getUserByIdMock.mockClear();
  deleteUserMock.mockClear();
  insertMock.mockClear();
  updateMock.mockClear();
  updateEqMock.mockClear();
  fromMock.mockClear();
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  logErrorMock.mockClear();
});

describe("moderateDeleteUserAccount", () => {
  it("returns unauthorized and never attempts deletion when not an admin", async () => {
    adminUser = null;

    const result = await moderateDeleteUserAccount("target-1", "reason", "other", "DELETE");

    expect(result).toEqual({ error: "Unauthorized." });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("rejects self-targeting", async () => {
    const result = await moderateDeleteUserAccount("admin-1", "reason", "other", "DELETE");

    expect(result).toEqual({ error: "You cannot delete your own account through this action." });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("rejects a target whose app_metadata.role is administrative", async () => {
    targetIsAdmin = true;

    const result = await moderateDeleteUserAccount("target-1", "reason", "other", "DELETE");

    expect(result).toEqual({ error: "Cannot delete another administrator." });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid reason category", async () => {
    // @ts-expect-error deliberately invalid input
    const result = await moderateDeleteUserAccount("target-1", "reason", "not_a_category", "DELETE");

    expect(result).toEqual({ error: "Invalid reason category." });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("rejects a missing reason", async () => {
    const result = await moderateDeleteUserAccount("target-1", "   ", "other", "DELETE");

    expect(result).toEqual({ error: "A reason (1-500 characters) is required." });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await moderateDeleteUserAccount("target-1", "reason", "other", "DELETE");

    expect("error" in result).toBe(true);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("writes an audit row before attempting deletion, then updates it to success", async () => {
    const result = await moderateDeleteUserAccount("target-1", "reason", "other", "DELETE");

    expect(result).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "delete_account",
        target_table: "auth_users",
        target_id: null,
        subject_user_id: "target-1",
        snapshot: { outcome: "attempted" },
      })
    );
    // Audit insert happens before the destructive call.
    expect(insertMock.mock.invocationCallOrder[0]).toBeLessThan(deleteUserMock.mock.invocationCallOrder[0]);
    expect(updateMock).toHaveBeenCalledWith({ snapshot: { outcome: "success" } });
    expect(updateEqMock).toHaveBeenCalledWith("id", "audit-1");
  });

  it("still leaves an audit row (marked failed) when deleteUser itself fails", async () => {
    deleteUserResult = { error: { message: "provider error user@example.com" } };

    const result = await moderateDeleteUserAccount("target-1", "reason", "other", "DELETE");

    expect(result).toEqual({ error: "Failed to delete account." });
    expect(updateMock).toHaveBeenCalledWith({
      snapshot: { outcome: "failed", error: "sanitized:provider error user@example.com" },
    });
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("requires the typed confirmation on the server", async () => {
    const result = await moderateDeleteUserAccount("target-1", "reason", "other", "delete");

    expect(result).toEqual({ error: "Type DELETE to confirm account deletion." });
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("reports a warning when deletion succeeds but its final audit update fails", async () => {
    updateEqResult = { data: null, error: { message: "audit update failed" } };

    const result = await moderateDeleteUserAccount("target-1", "reason", "other", "DELETE");

    expect(result).toEqual({
      success: true,
      auditWarning: "The account was deleted, but the final audit outcome could not be recorded.",
    });
    expect(deleteUserMock).toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalled();
  });
});
