import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let banksCheckResult: { data: Array<{ id: string; is_active: boolean }> } = {
  data: [
    { id: "bank-a", is_active: true },
    { id: "bank-b", is_active: true },
  ],
};
const banksInMock = vi.fn(() => Promise.resolve(banksCheckResult));
const banksSelectMock = vi.fn(() => ({ in: banksInMock }));

// A minimal thenable query-builder stand-in: every chain method (eq/in/is)
// returns the same object, and the object itself resolves (via `then`) to
// whatever the test configured — regardless of how many chain calls
// preceded the await, mirroring how supabase-js's real builder is awaited
// directly without a manual `.then()` call at the use site.
function chainable<T>(result: T) {
  const obj = {
    eq: vi.fn(() => obj),
    in: vi.fn(() => obj),
    is: vi.fn(() => obj),
    then: (resolve: (v: T) => void) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

type MockReportRow = { id: string; user_id: string | null; status: string; tested_at: string };

// route_reports rows existing for this (from, to, rail) — the action
// queries this same shape twice (pre-insert, then again post-insert to
// build the authoritative "after" state) — see submitRouteReport.ts.
// Defaults to "first-ever report on this route".
let routeReportsResult: { data: MockReportRow[]; error: { message?: string } | null } = { data: [], error: null };
// Count of route_requests with fulfilled_by_report_id = this new report's id.
let fulfilledCountResult: { count: number; error: { message?: string } | null } = { count: 0, error: null };

let insertResult: { data: { id: string; created_at: string } | null; error: { message?: string } | null } = {
  data: { id: "report-1", created_at: "2026-07-01T00:00:00Z" },
  error: null,
};
const insertMock = vi.fn(() => ({
  select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve(insertResult)) })),
}));

const routeReportsSelectMock = vi.fn(() => chainable(routeReportsResult));
const routeRequestsSelectMock = vi.fn(() => chainable(fulfilledCountResult));

const fromMock = vi.fn((table: string) => {
  if (table === "banks") return { select: banksSelectMock };
  if (table === "route_reports") return { select: routeReportsSelectMock, insert: insertMock };
  if (table === "route_requests") return { select: routeRequestsSelectMock };
  throw new Error(`unexpected table in test: ${table}`);
});
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
  banksCheckResult = {
    data: [
      { id: "bank-a", is_active: true },
      { id: "bank-b", is_active: true },
    ],
  };
  routeReportsResult = { data: [], error: null };
  fulfilledCountResult = { count: 0, error: null };
  insertResult = { data: { id: "report-1", created_at: "2026-07-01T00:00:00Z" }, error: null };
  getUserMock.mockClear();
  insertMock.mockClear();
  banksSelectMock.mockClear();
  banksInMock.mockClear();
  routeReportsSelectMock.mockClear();
  routeRequestsSelectMock.mockClear();
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

  it("returns a friendly error and never inserts when one of the selected banks is inactive", async () => {
    banksCheckResult = {
      data: [
        { id: "bank-a", is_active: true },
        { id: "bank-b", is_active: false },
      ],
    };

    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ error: "One of the selected institutions is no longer listed and can't receive new reports." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("aborts before writing when the pre-insert snapshot query fails, rather than building a receipt on a silently-empty fallback", async () => {
    routeReportsResult = { data: [], error: { message: "connection reset" } };

    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ error: "Failed to submit report." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts, invalidates the needs-fresh-reports cache, and returns a receipt on success", async () => {
    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.evidenceBeforeState).toBeNull();
    expect(result.receipt.evidenceAfterState).toBe("limited_evidence");
    expect(result.receipt.fulfilledRequestCount).toBe(0);
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
    insertResult = { data: null, error: { message: "constraint violation" } };

    const result = await submitRouteReport(baseInput);

    expect(result).toEqual({ error: "Failed to submit report." });
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it("swallows an updateTag failure and still reports success, since the report already committed", async () => {
    updateTagMock.mockImplementation(() => {
      throw new Error("cache backend unavailable");
    });

    const result = await submitRouteReport(baseInput);

    expect("error" in result).toBe(false);
    expect(logErrorMock).toHaveBeenCalledWith(
      "Failed to invalidate needs-fresh-reports cache after report fulfillment",
      expect.objectContaining({ error: "cache backend unavailable" })
    );
  });

  it("falls back to the pre-insert snapshot and still reports success when the post-insert re-fetch fails", async () => {
    routeReportsSelectMock.mockImplementationOnce(() => chainable({ data: [], error: null }));
    routeReportsSelectMock.mockImplementationOnce(() =>
      chainable({ data: [], error: { message: "connection reset" } })
    );

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.evidenceAfterState).toBe("limited_evidence");
    expect(logErrorMock).toHaveBeenCalledWith(
      "Failed to re-fetch route_reports after insert; receipt may be based on a stale snapshot",
      expect.objectContaining({ error: "connection reset" })
    );
  });

  it("surfaces a genuine evidence-state transition in the receipt", async () => {
    routeReportsResult = {
      data: [{ id: "existing-1", user_id: "user-2", status: "success", tested_at: "2026-06-15" }],
      error: null,
    };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.evidenceBeforeState).toBe("limited_evidence");
    expect(result.receipt.evidenceAfterState).toBe("observed_working");
    expect(result.receipt.isRepeatReporter).toBe(false);
  });

  it("recognizes the submitting user as a repeat reporter for this exact route+rail", async () => {
    routeReportsResult = {
      data: [{ id: "existing-1", user_id: "user-1", status: "success", tested_at: "2026-06-15" }],
      error: null,
    };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.isRepeatReporter).toBe(true);
    expect(result.receipt.lines).toContain("Your evidence for this route was updated.");
  });

  it("reflects a concurrent submitter's report picked up by the post-insert re-fetch, not just the pre-insert snapshot", async () => {
    // Pre-insert: route has no evidence yet. A concurrent submitter's
    // report for the same route+rail lands in between our snapshot and our
    // own insert, so the authoritative post-insert re-fetch shows it too —
    // proving the receipt is built from fresh data, not the stale
    // pre-insert snapshot (which would have missed it entirely).
    routeReportsSelectMock.mockImplementationOnce(() => chainable({ data: [], error: null }));
    routeReportsSelectMock.mockImplementationOnce(() =>
      chainable({
        data: [
          { id: "concurrent-1", user_id: "user-2", status: "success", tested_at: "2026-07-01" },
          { id: "report-1", user_id: "user-1", status: "success", tested_at: "2026-07-01" },
        ],
        error: null,
      })
    );

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.evidenceBeforeState).toBe("limited_evidence");
    expect(result.receipt.evidenceAfterState).toBe("observed_working");
  });

  it("counts fulfilled requests by fulfilled_by_report_id, not by matching timestamps", async () => {
    fulfilledCountResult = { count: 2, error: null };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.fulfilledRequestCount).toBe(2);
    expect(result.receipt.lines[0]).toBe("Your report fulfilled 2 open route requests.");
    expect(routeRequestsSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
  });

  it("understates (never overstates) fulfillment when the count query fails, logging the failure", async () => {
    fulfilledCountResult = { count: 0, error: { message: "connection reset" } };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.fulfilledRequestCount).toBe(0);
    expect(logErrorMock).toHaveBeenCalledWith(
      "Failed to count fulfilled route_requests after insert; receipt will understate fulfillment",
      expect.objectContaining({ error: "connection reset" })
    );
  });

  it("never lets a losing concurrent submitter overclaim credit for requests another report actually fulfilled", async () => {
    // Two users submit for the same route pair. In reality, the DB trigger
    // sets fulfilled_by_report_id to whichever report's transaction wins
    // the race — the loser's count query (filtered to its own report id)
    // simply finds zero matching rows, never someone else's.
    fulfilledCountResult = { count: 2, error: null };
    const winner = await submitRouteReport(baseInput);

    fulfilledCountResult = { count: 0, error: null };
    const loser = await submitRouteReport({ ...baseInput, testedAt: "2026-07-02" });

    if ("error" in winner) throw new Error(winner.error);
    if ("error" in loser) throw new Error(loser.error);
    expect(winner.receipt.fulfilledRequestCount).toBe(2);
    expect(loser.receipt.fulfilledRequestCount).toBe(0);
    expect(loser.receipt.lines.some((l) => l.includes("fulfilled"))).toBe(false);
  });
});
