import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string; app_metadata?: Record<string, unknown> } | null = null;
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

const { requireAdmin, isAdminUser } = await import("./requireAdmin");

beforeEach(() => {
  currentUser = null;
  getUserMock.mockClear();
});

describe("requireAdmin", () => {
  it("returns null when signed out", async () => {
    currentUser = null;
    expect(await requireAdmin()).toBeNull();
  });

  it("returns null when signed in without an admin role", async () => {
    currentUser = { id: "user-1", app_metadata: {} };
    expect(await requireAdmin()).toBeNull();
  });

  // user_metadata is client-writable, so a spoofed value there must never
  // grant access — only app_metadata.role, which the client can never set.
  it("returns null for a spoofed user_metadata.role, ignoring it entirely", async () => {
    currentUser = {
      id: "user-1",
      app_metadata: {},
      // @ts-expect-error deliberately shaping a spoof attempt for the test
      user_metadata: { role: "admin" },
    };
    expect(await requireAdmin()).toBeNull();
  });

  it("returns the user id when app_metadata.role is admin", async () => {
    currentUser = { id: "user-1", app_metadata: { role: "admin" } };
    expect(await requireAdmin()).toEqual({ id: "user-1" });
  });

  it("returns null for a non-admin role value", async () => {
    currentUser = { id: "user-1", app_metadata: { role: "editor" } };
    expect(await requireAdmin()).toBeNull();
  });
});

describe("isAdminUser", () => {
  it("returns true when app_metadata.role is admin", () => {
    expect(isAdminUser({ app_metadata: { role: "admin" } })).toBe(true);
  });

  it("returns false when app_metadata.role is missing or not admin", () => {
    expect(isAdminUser({ app_metadata: {} })).toBe(false);
    expect(isAdminUser({ app_metadata: { role: "editor" } })).toBe(false);
  });
});
