import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let bankCheckResult: { data: { id: string; is_active: boolean } | null } = {
  data: { id: "bank-a", is_active: true },
};
const bankMaybeSingleMock = vi.fn(() => Promise.resolve(bankCheckResult));
const bankEqMock = vi.fn(() => ({ maybeSingle: bankMaybeSingleMock }));
const banksSelectMock = vi.fn(() => ({ eq: bankEqMock }));

// A minimal thenable query-builder stand-in — every chain method returns
// the same object, which resolves (via `then`) to whatever the test
// configured, regardless of how many chain calls preceded the await.
function chainable<T>(result: T) {
  const obj = {
    eq: vi.fn(() => obj),
    then: (resolve: (v: T) => void) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

type MockEddRow = {
  id: string;
  bank_id: string;
  user_id: string | null;
  days_early: number;
  created_at: string;
  deposit_type: string | null;
  payroll_provider: string | null;
};

// Same mocked rows are returned for both the pre-insert and post-insert
// edd_reports queries (the action re-reads after the write — see
// submitEddReport.ts) — this fixture represents "what's in the table",
// consistent across both reads in a non-concurrent test scenario.
let beforeReportsResult: { data: MockEddRow[]; error: { message?: string } | null } = { data: [], error: null };
const eddReportsSelectMock = vi.fn(() => chainable(beforeReportsResult));

let insertResult: {
  data: MockEddRow | null;
  error: { message?: string } | null;
} = {
  data: {
    id: "new-edd-report",
    bank_id: "bank-a",
    user_id: "user-1",
    days_early: 2,
    created_at: "2026-07-01T00:00:00Z",
    deposit_type: null,
    payroll_provider: null,
  },
  error: null,
};
const insertMock = vi.fn(() => ({
  select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve(insertResult)) })),
}));

const fromMock = vi.fn((table: string) => {
  if (table === "banks") return { select: banksSelectMock };
  if (table === "edd_reports") return { select: eddReportsSelectMock, insert: insertMock };
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

const { submitEddReport } = await import("./submitEddReport");

const baseInput = {
  bankId: "bank-a",
  daysEarly: 2,
  depositType: null,
  payrollProvider: null,
};

beforeEach(() => {
  currentUser = { id: "user-1" };
  bankCheckResult = { data: { id: "bank-a", is_active: true } };
  beforeReportsResult = { data: [], error: null };
  insertResult = {
    data: {
      id: "new-edd-report",
      bank_id: "bank-a",
      user_id: "user-1",
      days_early: 2,
      created_at: "2026-07-01T00:00:00Z",
      deposit_type: null,
      payroll_provider: null,
    },
    error: null,
  };
  getUserMock.mockClear();
  insertMock.mockClear();
  banksSelectMock.mockClear();
  bankEqMock.mockClear();
  bankMaybeSingleMock.mockClear();
  eddReportsSelectMock.mockClear();
  fromMock.mockClear();
  getUserModerationStatusMock.mockClear();
  getUserModerationStatusMock.mockResolvedValue({ blocked: false });
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
});

describe("submitEddReport", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await submitEddReport(baseInput);

    expect(result).toEqual({ error: "You must be signed in." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns the moderation status message and never inserts when the user is restricted/banned", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "Your account is currently suspended from submitting." });

    const result = await submitEddReport(baseInput);

    expect(result).toEqual({ error: "Your account is currently suspended from submitting." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await submitEddReport(baseInput);

    expect("error" in result).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns a friendly error and never inserts when the selected bank is inactive", async () => {
    bankCheckResult = { data: { id: "bank-a", is_active: false } };

    const result = await submitEddReport(baseInput);

    expect(result).toEqual({ error: "This institution is no longer listed and can't receive new reports." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("surfaces an insert error as a failure", async () => {
    insertResult = { data: null, error: { message: "constraint violation" } };

    const result = await submitEddReport(baseInput);

    expect(result).toEqual({ error: "Failed to submit report." });
  });

  it("aborts before writing when the pre-insert snapshot query fails, rather than building a receipt on a silently-empty fallback", async () => {
    beforeReportsResult = { data: [], error: { message: "connection reset" } };

    const result = await submitEddReport(baseInput);

    expect(result).toEqual({ error: "Failed to submit report." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts and returns a receipt on success", async () => {
    const result = await submitEddReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ bank_id: "bank-a", user_id: "user-1", days_early: 2 })
    );
    expect(result.receipt.contributorCountBefore).toBe(0);
    expect(result.receipt.contributorCountAfter).toBe(1);
  });

  it("falls back to the pre-insert snapshot and still reports success when the post-insert re-fetch fails", async () => {
    // First call (pre-insert) succeeds normally; second call (post-insert,
    // used to build the authoritative "after" state) fails.
    eddReportsSelectMock.mockImplementationOnce(() => chainable({ data: [], error: null }));
    eddReportsSelectMock.mockImplementationOnce(() => chainable({ data: [], error: { message: "connection reset" } }));

    const result = await submitEddReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.contributorCountAfter).toBe(1);
  });

  it("reflects a concurrent submitter's report picked up by the post-insert re-fetch, not just the pre-insert snapshot", async () => {
    // Pre-insert: only user-2 has reported. Post-insert: user-3's report
    // landed in between our snapshot and our own insert, so the
    // authoritative re-fetch now shows both — proving the receipt is built
    // from the fresh post-insert data, not the stale pre-insert one.
    eddReportsSelectMock.mockImplementationOnce(() =>
      chainable({
        data: [
          {
            id: "existing-1",
            bank_id: "bank-a",
            user_id: "user-2",
            days_early: 1,
            created_at: "2026-06-01T00:00:00Z",
            deposit_type: null,
            payroll_provider: null,
          },
        ],
        error: null,
      })
    );
    eddReportsSelectMock.mockImplementationOnce(() =>
      chainable({
        data: [
          {
            id: "existing-1",
            bank_id: "bank-a",
            user_id: "user-2",
            days_early: 1,
            created_at: "2026-06-01T00:00:00Z",
            deposit_type: null,
            payroll_provider: null,
          },
          {
            id: "existing-2-concurrent",
            bank_id: "bank-a",
            user_id: "user-3",
            days_early: 4,
            created_at: "2026-07-01T00:00:00.500Z",
            deposit_type: null,
            payroll_provider: null,
          },
          {
            id: "new-edd-report",
            bank_id: "bank-a",
            user_id: "user-1",
            days_early: 2,
            created_at: "2026-07-01T00:00:00Z",
            deposit_type: null,
            payroll_provider: null,
          },
        ],
        error: null,
      })
    );

    const result = await submitEddReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    // 3 real distinct contributors after the write (user-1, user-2,
    // user-3), not 2 — the concurrent user-3 row is only visible in the
    // post-insert re-fetch, and would have been missed entirely by the old
    // "pre-insert snapshot + only my own row" reconstruction.
    expect(result.receipt.contributorCountAfter).toBe(3);
  });

  it("surfaces a visibility-threshold crossing in the receipt", async () => {
    beforeReportsResult = {
      data: [
        {
          id: "existing-1",
          bank_id: "bank-a",
          user_id: "user-2",
          days_early: 1,
          created_at: "2026-06-01T00:00:00Z",
          deposit_type: null,
          payroll_provider: null,
        },
      ],
      error: null,
    };

    const result = await submitEddReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.contributorCountBefore).toBe(1);
    expect(result.receipt.contributorCountAfter).toBe(2);
    expect(result.receipt.crossedVisibility).toBe(true);
    expect(result.receipt.lines).toEqual(["EDD evidence is now visible on this bank's profile."]);
  });

  it("recognizes a repeat reporter and never claims the contributor count increased", async () => {
    beforeReportsResult = {
      data: [
        {
          id: "existing-1",
          bank_id: "bank-a",
          user_id: "user-1",
          days_early: 1,
          created_at: "2026-06-01T00:00:00Z",
          deposit_type: null,
          payroll_provider: null,
        },
        {
          id: "existing-2",
          bank_id: "bank-a",
          user_id: "user-2",
          days_early: 1,
          created_at: "2026-06-01T00:00:00Z",
          deposit_type: null,
          payroll_provider: null,
        },
      ],
      error: null,
    };

    const result = await submitEddReport(baseInput);

    if ("error" in result) throw new Error(result.error);
    expect(result.receipt.isRepeatReporter).toBe(true);
    expect(result.receipt.contributorCountBefore).toBe(2);
    expect(result.receipt.contributorCountAfter).toBe(2);
    expect(result.receipt.crossedVisibility).toBe(false);
    expect(result.receipt.lines).toEqual(["Your EDD evidence for this bank was updated."]);
  });
});
