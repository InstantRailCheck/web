import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = null;
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

class NotFoundError extends Error {}
const notFoundMock = vi.fn(() => {
  throw new NotFoundError("not found");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

let getUserByIdResult: {
  data: { user: { id: string; email?: string; created_at?: string } | null } | null;
  error: { message?: string } | null;
} = { data: { user: { id: "target-1", email: "person@example.com", created_at: "2026-01-01T00:00:00Z" } }, error: null };
const getUserByIdMock = vi.fn(() => Promise.resolve(getUserByIdResult));

let moderationStatusRow: unknown = null;
const maybeSingleMock = vi.fn(() => Promise.resolve({ data: moderationStatusRow }));
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { getUserById: getUserByIdMock } }, from: fromMock }),
}));

const fetchUserSubmissionPageMock = vi.fn();
vi.mock("@/lib/moderation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/moderation")>("@/lib/moderation");
  return {
    ...actual,
    fetchUserSubmissionPage: (...args: unknown[]) => fetchUserSubmissionPageMock(...args),
  };
});

const { default: AdminUserProfilePage } = await import("./page");

beforeEach(() => {
  adminUser = null;
  getUserByIdResult = { data: { user: { id: "target-1", email: "person@example.com", created_at: "2026-01-01T00:00:00Z" } }, error: null };
  moderationStatusRow = null;
  requireAdminMock.mockClear();
  notFoundMock.mockClear();
  getUserByIdMock.mockClear();
  fromMock.mockClear();
  fetchUserSubmissionPageMock.mockClear();
  fetchUserSubmissionPageMock.mockResolvedValue({ rows: [], total: 0 });
});

const baseParams = { params: Promise.resolve({ id: "target-1" }), searchParams: Promise.resolve({}) };

describe("AdminUserProfilePage", () => {
  it("calls notFound() and never looks up the target for a non-admin/unauthenticated visitor", async () => {
    adminUser = null;

    await expect(AdminUserProfilePage(baseParams)).rejects.toBeInstanceOf(NotFoundError);

    expect(notFoundMock).toHaveBeenCalled();
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for an unknown UUID", async () => {
    adminUser = { id: "admin-1" };
    getUserByIdResult = { data: { user: null }, error: null };

    await expect(AdminUserProfilePage(baseParams)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fetches route_reports history by default for an admin", async () => {
    adminUser = { id: "admin-1" };

    await AdminUserProfilePage(baseParams);

    expect(fetchUserSubmissionPageMock).toHaveBeenCalledWith("target-1", "route_reports", 1);
  });

  it("passes through the type and page search params", async () => {
    adminUser = { id: "admin-1" };

    await AdminUserProfilePage({
      params: Promise.resolve({ id: "target-1" }),
      searchParams: Promise.resolve({ type: "bank_corrections", page: "2" }),
    });

    expect(fetchUserSubmissionPageMock).toHaveBeenCalledWith("target-1", "bank_corrections", 2);
  });

  it("renders without throwing when the target has an active moderation status row", async () => {
    adminUser = { id: "admin-1" };
    moderationStatusRow = {
      status: "restricted",
      reason_category: "spam",
      note: "repeat spam",
      ban_expires_at: null,
      auth_sync_status: "pending",
      auth_sync_error: "provider unavailable",
      updated_at: "2026-01-02T00:00:00Z",
    };

    await expect(AdminUserProfilePage(baseParams)).resolves.toBeTruthy();
  });
});
