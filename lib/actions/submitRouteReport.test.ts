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

// route_reports rows existing for this (from, to, rail) BEFORE this
// submission — defaults to "first-ever report on this route".
let beforeRouteReportsResult: { data: Array<{ user_id: string | null; status: string; tested_at: string }> } = {
  data: [],
};
// Currently-open route_requests ids for this (from, to) pair before insert.
let openRequestsResult: { data: Array<{ id: string }> } = { data: [] };
// How many of those ids this exact insert's transaction actually fulfilled.
let fulfilledCountResult: { count: number } = { count: 0 };

let insertResult: { data: { id: string; created_at: string } | null; error: { message?: string } | null } = {
  data: { id: "report-1", created_at: "2026-07-01T00:00:00Z" },
  error: null,
};
const insertMock = vi.fn(() => ({
  select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve(insertResult)) })),
}));

const routeReportsSelectMock = vi.fn(() => chainable(beforeRouteReportsResult));

const routeRequestsSelectMock = vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) =>
  opts?.count ? chainable(fulfilledCountResult) : chainable(openRequestsResult)
);

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
  beforeRouteReportsResult = { data: [] };
  openRequestsResult = { data: [] };
  fulfilledCountResult = { count: 0 };
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

  it("surfaces a genuine evidence-state transition in the receipt", async () => {
    beforeRouteReportsResult = {
      data: [{ user_id: "user-2", status: "success", tested_at: "2026-06-15" }],
    };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.evidenceBeforeState).toBe("limited_evidence");
    expect(result.receipt.evidenceAfterState).toBe("observed_working");
    expect(result.receipt.isRepeatReporter).toBe(false);
  });

  it("recognizes the submitting user as a repeat reporter for this exact route+rail", async () => {
    beforeRouteReportsResult = {
      data: [{ user_id: "user-1", status: "success", tested_at: "2026-06-15" }],
    };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.isRepeatReporter).toBe(true);
    expect(result.receipt.lines).toContain("Your evidence for this route was updated.");
  });

  it("only queries the fulfilled-request count when there are open requests to check", async () => {
    openRequestsResult = { data: [] };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.fulfilledRequestCount).toBe(0);
    expect(routeRequestsSelectMock).not.toHaveBeenCalledWith("id", expect.objectContaining({ count: "exact" }));
  });

  it("reports the exact fulfilled-request count from the post-insert timestamp match", async () => {
    openRequestsResult = { data: [{ id: "req-1" }, { id: "req-2" }] };
    fulfilledCountResult = { count: 2 };

    const result = await submitRouteReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.fulfilledRequestCount).toBe(2);
    expect(result.receipt.lines[0]).toBe("Your report fulfilled 2 open route requests.");
  });

  it("never lets a losing concurrent submitter overclaim credit for requests another report actually fulfilled", async () => {
    // Two users both see the same two open requests as still-open before
    // either of their reports commits. In reality only one insert's
    // trigger actually flips fulfilled_at (the other's conditional UPDATE
    // matches zero rows, since they're already fulfilled by the winner) —
    // simulated here by the winner's post-insert count query returning 2
    // and the loser's returning 0, exactly as Postgres would report it.
    openRequestsResult = { data: [{ id: "req-1" }, { id: "req-2" }] };

    fulfilledCountResult = { count: 2 };
    const winner = await submitRouteReport(baseInput);

    fulfilledCountResult = { count: 0 };
    const loser = await submitRouteReport({ ...baseInput, testedAt: "2026-07-02" });

    if ("error" in winner) throw new Error(winner.error);
    if ("error" in loser) throw new Error(loser.error);
    expect(winner.receipt.fulfilledRequestCount).toBe(2);
    expect(loser.receipt.fulfilledRequestCount).toBe(0);
    expect(loser.receipt.lines.some((l) => l.includes("fulfilled"))).toBe(false);
  });
});
