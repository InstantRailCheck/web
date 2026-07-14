import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let adminUser: { id: string } | null = { id: "admin-1" };
const requireAdminMock = vi.fn(() => Promise.resolve(adminUser));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireAdmin: () => requireAdminMock(),
}));

let targetRow: { user_id: string } | null = { user_id: "target-1" };
let targetLookupError: { message: string } | null = null;
const maybeSingleMock = vi.fn(() => Promise.resolve({ data: targetRow, error: targetLookupError }));
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));

const insertMock = vi.fn<() => Promise<{ data: null; error: { message: string } | null }>>(() => Promise.resolve({ data: null, error: null }));
const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { reviewFlag } = await import("./reviewFlag");

const SIGNALS = [{ signal: "velocity" as const, severity: "high" as const, reason: "3 route reports in the last hour." }];

beforeEach(() => {
  adminUser = { id: "admin-1" };
  targetRow = { user_id: "target-1" };
  targetLookupError = null;
  requireAdminMock.mockClear();
  insertMock.mockClear();
  insertMock.mockResolvedValue({ data: null, error: null });
  selectMock.mockClear();
  eqMock.mockClear();
  maybeSingleMock.mockClear();
  fromMock.mockClear();
});

describe("reviewFlag", () => {
  it("returns unauthorized and never looks up or writes when not an admin", async () => {
    adminUser = null;

    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "");

    expect(result).toEqual({ error: "Unauthorized." });
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an overly long note", async () => {
    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "x".repeat(501));

    expect(result).toEqual({ error: "Note must be 500 characters or fewer." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a non-finite or negative score", async () => {
    expect(await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, NaN, "")).toEqual({ error: "Invalid score." });
    expect(await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, -1, "")).toEqual({ error: "Invalid score." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects malformed signal data", async () => {
    const bad = [{ signal: "velocity", severity: "extremely-bad", reason: "x" }] as never;
    const result = await reviewFlag("route_reports", "report-1", "target-1", bad, 3, "");

    expect(result).toEqual({ error: "Invalid signal data." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a review against a submission that no longer exists", async () => {
    targetRow = null;

    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "");

    expect(result).toEqual({ error: "Submission not found." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a review whose claimed subject doesn't match the row's real owner", async () => {
    targetRow = { user_id: "someone-else" };

    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "");

    expect(result).toEqual({ error: "Submission not found." });
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
    targetRow = { user_id: "target-2" };
    const result = await reviewFlag("edd_reports", "edd-1", "target-2", SIGNALS, 3, "Checked, this is a legitimate report.");

    expect(result).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ reason: "Checked, this is a legitimate report." }));
  });

  it("surfaces an error when the target lookup fails", async () => {
    targetLookupError = { message: "read failed" };

    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "");

    expect(result).toEqual({ error: "Failed to record the review." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces an error when the audit write fails", async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: "write failed" } });

    const result = await reviewFlag("route_reports", "report-1", "target-1", SIGNALS, 3, "");

    expect(result).toEqual({ error: "Failed to record the review." });
  });
});
