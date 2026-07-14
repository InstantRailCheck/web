import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = { id: "admin-1" };
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

const insertMock = vi.fn<() => Promise<{ data: null; error: { message: string } | null }>>(() => Promise.resolve({ data: null, error: null }));
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { reviewFlag } = await import("./reviewFlag");

const SIGNALS = [{ signal: "velocity" as const, severity: "high" as const, reason: "3 route reports in the last hour." }];

beforeEach(() => {
  adminUser = { id: "admin-1" };
  requireAdminMock.mockClear();
  insertMock.mockClear();
  insertMock.mockResolvedValue({ data: null, error: null });
  fromMock.mockClear();
});

describe("reviewFlag", () => {
  it("returns unauthorized and never writes when not an admin", async () => {
    adminUser = null;

    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "");

    expect(result).toEqual({ error: "Unauthorized." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an overly long note", async () => {
    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "x".repeat(501));

    expect(result).toEqual({ error: "Note must be 500 characters or fewer." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("writes the audit row with the default note when none is given", async () => {
    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "  ");

    expect(result).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "review_flag",
        target_table: "route_reports",
        target_id: "report-1",
        subject_user_id: "target-1",
        reason: "Reviewed — no action needed",
        reason_category: "other",
        snapshot: { signals: SIGNALS, score: 3 },
      })
    );
  });

  it("uses a custom note when provided, never the submission's own content", async () => {
    const result = await reviewFlag("edd_reports", "edd-1", "target-2", SIGNALS, 3, "Checked, this is a legitimate report.");

    expect(result).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ reason: "Checked, this is a legitimate report." }));
  });

  it("surfaces an error when the audit write fails", async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: "write failed" } });

    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "");

    expect(result).toEqual({ error: "Failed to record the review." });
  });
});
