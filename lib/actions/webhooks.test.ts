import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let countResult: { count: number } = { count: 0 };
let listResult: { data: unknown[] } = { data: [] };
let insertSingleResult: { data: { id: string; secret: string } | null; error: { message?: string } | null } = {
  data: { id: "wh-1", secret: "secret-hex" },
  error: null,
};
let deleteResult: { error: { message?: string } | null } = { error: null };

const selectMock = vi.fn((_cols: string, opts?: { head?: boolean }) => {
  if (opts?.head) return { eq: () => Promise.resolve(countResult) };
  return { eq: () => ({ order: () => Promise.resolve(listResult) }) };
});
const insertMock = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve(insertSingleResult) }) }));
const deleteMock = vi.fn(() => ({ eq: () => ({ eq: () => Promise.resolve(deleteResult) }) }));
const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock, delete: deleteMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const getUserModerationStatusMock = vi.fn();
vi.mock("@/lib/moderationStatus", () => ({
  getUserModerationStatus: (...args: unknown[]) => getUserModerationStatusMock(...args),
}));

const isActionRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isActionRateLimited: (...args: unknown[]) => isActionRateLimitedMock(...args),
}));

const isUrlSafeForWebhookMock = vi.fn();
vi.mock("@/lib/webhookSafety", () => ({
  isUrlSafeForWebhook: (...args: unknown[]) => isUrlSafeForWebhookMock(...args),
}));

const { registerWebhook, listWebhooks, deleteWebhook } = await import("./webhooks");

beforeEach(() => {
  currentUser = { id: "user-1" };
  countResult = { count: 0 };
  listResult = { data: [] };
  insertSingleResult = { data: { id: "wh-1", secret: "secret-hex" }, error: null };
  deleteResult = { error: null };
  getUserMock.mockClear();
  fromMock.mockClear();
  selectMock.mockClear();
  insertMock.mockClear();
  deleteMock.mockClear();
  getUserModerationStatusMock.mockClear();
  getUserModerationStatusMock.mockResolvedValue({ blocked: false });
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  isUrlSafeForWebhookMock.mockClear();
  isUrlSafeForWebhookMock.mockResolvedValue({ safe: true });
});

describe("registerWebhook", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await registerWebhook("https://example.com/hook", "bank_added");

    expect(result).toEqual({ error: "You must be signed in." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns the moderation status message and never registers when restricted/banned", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "Your account is currently restricted from submitting." });

    const result = await registerWebhook("https://example.com/hook", "bank_added");

    expect(result).toEqual({ error: "Your account is currently restricted from submitting." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("registers successfully when active", async () => {
    const result = await registerWebhook("https://example.com/hook", "bank_added");

    expect(result).toEqual({ id: "wh-1", secret: "secret-hex" });
    expect(insertMock).toHaveBeenCalled();
  });

  it("still enforces the 5-webhook cap on an active account", async () => {
    countResult = { count: 5 };

    const result = await registerWebhook("https://example.com/hook", "bank_added");

    expect(result).toEqual({ error: "Limit of 5 webhooks per account reached." });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

// Regression guard: restriction/suspension only ever blocks NEW submissions
// — a restricted/banned user must still be able to view and delete their
// existing webhooks. Neither of these calls the moderation-status check
// at all.
describe("listWebhooks / deleteWebhook (unaffected by moderation status)", () => {
  it("listWebhooks never checks moderation status", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "blocked" });
    listResult = { data: [{ id: "wh-1", url: "https://example.com", event: "bank_added", is_active: true, created_at: "now" }] };

    const result = await listWebhooks();

    expect(result).toHaveLength(1);
    expect(getUserModerationStatusMock).not.toHaveBeenCalled();
  });

  it("deleteWebhook never checks moderation status", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "blocked" });

    const result = await deleteWebhook("wh-1");

    expect(result).toEqual({ success: true });
    expect(getUserModerationStatusMock).not.toHaveBeenCalled();
  });
});
