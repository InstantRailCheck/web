import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = { id: "admin-1" };
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

let getUserByIdResult: { data: { user: { email?: string } | null } | null; error: { message?: string } | null } = {
  data: { user: { email: "person@example.com" } },
  error: null,
};
const getUserByIdMock = vi.fn(() => Promise.resolve(getUserByIdResult));

const insertMock = vi.fn<() => Promise<{ data: null; error: { message: string } | null }>>(
  () => Promise.resolve({ data: null, error: null })
);
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { getUserById: getUserByIdMock } }, from: fromMock }),
}));

const { revealUserEmail } = await import("./revealUserEmail");

beforeEach(() => {
  adminUser = { id: "admin-1" };
  getUserByIdResult = { data: { user: { email: "person@example.com" } }, error: null };
  requireAdminMock.mockClear();
  getUserByIdMock.mockClear();
  insertMock.mockClear();
  insertMock.mockResolvedValue({ data: null, error: null });
  fromMock.mockClear();
});

describe("revealUserEmail", () => {
  it("returns unauthorized and never looks up the user when not an admin", async () => {
    adminUser = null;

    const result = await revealUserEmail("target-1");

    expect(result).toEqual({ error: "Unauthorized." });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("returns an error when the user doesn't exist", async () => {
    getUserByIdResult = { data: { user: null }, error: null };

    const result = await revealUserEmail("target-1");

    expect(result).toEqual({ error: "User not found." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns the email and writes an audit row with the fixed reason/category", async () => {
    const result = await revealUserEmail("target-1");

    expect(result).toEqual({ email: "person@example.com" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "reveal_email",
        target_table: "auth_users",
        target_id: null,
        subject_user_id: "target-1",
        reason: "Viewed on user profile page",
        reason_category: "other",
      })
    );
  });

  it("does not reveal the email when its audit row cannot be written", async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: "write failed" } });

    const result = await revealUserEmail("target-1");

    expect(result).toEqual({ error: "Failed to record email access." });
  });
});
