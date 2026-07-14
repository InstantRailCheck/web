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

const fetchModerationPageMock = vi.fn();
vi.mock("@/lib/moderation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/moderation")>("@/lib/moderation");
  return {
    ...actual,
    fetchModerationPage: (...args: unknown[]) => fetchModerationPageMock(...args),
  };
});

const { default: AdminModerationPage } = await import("./page");

beforeEach(() => {
  adminUser = null;
  requireAdminMock.mockClear();
  notFoundMock.mockClear();
  fetchModerationPageMock.mockClear();
  fetchModerationPageMock.mockResolvedValue({ rows: [], total: 0 });
});

describe("AdminModerationPage", () => {
  it("calls notFound() and never queries data for a non-admin/unauthenticated visitor", async () => {
    adminUser = null;

    await expect(AdminModerationPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(NotFoundError);

    expect(notFoundMock).toHaveBeenCalled();
    expect(fetchModerationPageMock).not.toHaveBeenCalled();
  });

  it("fetches route_reports by default for an admin", async () => {
    adminUser = { id: "admin-1" };

    await AdminModerationPage({ searchParams: Promise.resolve({}) });

    expect(fetchModerationPageMock).toHaveBeenCalledWith("route_reports", 1, "");
  });

  it("passes through the type, bank filter, and page search params", async () => {
    adminUser = { id: "admin-1" };

    await AdminModerationPage({ searchParams: Promise.resolve({ type: "edd_reports", q: "Chase", page: "3" }) });

    expect(fetchModerationPageMock).toHaveBeenCalledWith("edd_reports", 3, "Chase");
  });

  it("falls back to route_reports for an unrecognized type param", async () => {
    adminUser = { id: "admin-1" };

    await AdminModerationPage({ searchParams: Promise.resolve({ type: "bank_corrections" }) });

    expect(fetchModerationPageMock).toHaveBeenCalledWith("route_reports", 1, "");
  });
});
