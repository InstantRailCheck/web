import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let insertResult: { error: { message?: string } | null } = { error: null };
const insertMock = vi.fn(() => Promise.resolve(insertResult));
const fromMock = vi.fn(() => ({ insert: insertMock }));
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

const updateTagMock = vi.fn();
vi.mock("next/cache", () => ({
  updateTag: (...args: unknown[]) => updateTagMock(...args),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const { submitRouteReport } = await import("./submitRouteReport");

const baseInput = {
  fromBankId: "bank-a",
  toBankId: "bank-b",
  fromBankName: "Bank A",
  toBankName: "Bank B",
  railUsed: "ACH",
  direction: "push",
  status: "success",
  testedAt: "2026-07-01",
  settlementTimeMinutes: null,
  sameDay: null,
  notes: "",
};

beforeEach(() => {
  currentUser = { id: "user-1" };
  insertResult = { error: null };
  getUserMock.mockClear();
  insertMock.mockClear();
  fromMock.mockClear();
  getUserModerationStatusMock.mockClear();
  getUserModerationStatusMock.mockResolvedValue({ blocked: false });
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  updateTagMock.mockClear();
  updateTagMock.mockReset();
  logErrorMock.mockClear();
});

describe("submitRouteReport", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ error: "You must be signed in." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns the moderation status message and never inserts when the user is restricted/banned", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "Your account is currently suspended from submitting." });

    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ error: "Your account is currently suspended from submitting." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when the banks are the same", async () => {
    const result = await submitRouteReport({ ...baseInput, toBankId: baseInput.fromBankId });

    expect(result).toEqual({ error: "Sender and receiver banks must be different." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await submitRouteReport(baseInput);

    expect("error" in result).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts and invalidates the needs-fresh-reports cache on success", async () => {
    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ success: true });
    expect(fromMock).toHaveBeenCalledWith("route_reports");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from_bank_id: "bank-a",
        to_bank_id: "bank-b",
        user_id: "user-1",
        rail_used: "ACH",
      })
    );
    expect(updateTagMock).toHaveBeenCalledWith("needs-fresh-reports");
  });

  it("surfaces an insert error as a failure and does not invalidate the cache", async () => {
    insertResult = { error: { message: "constraint violation" } };

    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ error: "Failed to submit report." });
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it("swallows an updateTag failure and still reports success, since the report already committed", async () => {
    updateTagMock.mockImplementation(() => {
      throw new Error("cache backend unavailable");
    });

    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ success: true });
    expect(logErrorMock).toHaveBeenCalledWith(
      "Failed to invalidate needs-fresh-reports cache after report fulfillment",
      expect.objectContaining({ error: "cache backend unavailable" })
    );
  });
});
