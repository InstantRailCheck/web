import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
// after() requires a real Next.js request-scope context that doesn't exist
// under vitest. Rather than auto-invoking the callback (which would hide
// bugs like "never registered with after() at all"), this captures it so
// tests can assert it was scheduled and then explicitly await it to
// exercise what runs after the response would have been sent.
let capturedAfterCallback: (() => void | Promise<void>) | null = null;
vi.mock("next/server", () => ({
  after: (fn: () => void | Promise<void>) => {
    capturedAfterCallback = fn;
  },
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

type ExistingBankRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  source_authority: "fdic" | "ncua" | null;
};
let existingBankResult: { data: ExistingBankRow[] } = { data: [] };
const eqMock = vi.fn(() => Promise.resolve(existingBankResult));

let similarSlugsResult: { data: { slug: string }[] } = { data: [] };
const ilikeMock = vi.fn(() => Promise.resolve(similarSlugsResult));

const selectMock = vi.fn(() => ({ eq: eqMock, ilike: ilikeMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

let rpcSingleResult: { data: { id: string; slug: string; name: string } | null; error: { message?: string } | null } = {
  data: { id: "bank-1", slug: "test-bank", name: "Test Bank" },
  error: null,
};
const rpcSingleMock = vi.fn(() => Promise.resolve(rpcSingleResult));
const rpcMock = vi.fn(() => ({ single: rpcSingleMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

const getUserModerationStatusMock = vi.fn();
vi.mock("@/lib/moderationStatus", () => ({
  getUserModerationStatus: (...args: unknown[]) => getUserModerationStatusMock(...args),
}));

const isActionRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isActionRateLimited: (...args: unknown[]) => isActionRateLimitedMock(...args),
}));

const enrichBankMock = vi.fn();
vi.mock("@/lib/actions/enrichBank", () => ({ enrichBank: (...args: unknown[]) => enrichBankMock(...args) }));

const triggerWebhooksMock = vi.fn();
vi.mock("@/lib/actions/triggerWebhooks", () => ({ triggerWebhooks: (...args: unknown[]) => triggerWebhooksMock(...args) }));

const submitUrlsToIndexNowMock = vi.fn();
vi.mock("@/lib/indexNow", () => ({ submitUrlsToIndexNow: (...args: unknown[]) => submitUrlsToIndexNowMock(...args) }));

const { addBank } = await import("./addBank");

beforeEach(() => {
  currentUser = { id: "user-1" };
  existingBankResult = { data: [] };
  similarSlugsResult = { data: [] };
  rpcSingleResult = { data: { id: "bank-1", slug: "test-bank", name: "Test Bank" }, error: null };
  getUserMock.mockClear();
  fromMock.mockClear();
  rpcMock.mockClear();
  rpcSingleMock.mockClear();
  getUserModerationStatusMock.mockClear();
  getUserModerationStatusMock.mockResolvedValue({ blocked: false });
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  capturedAfterCallback = null;
  logErrorMock.mockClear();
  enrichBankMock.mockClear();
  enrichBankMock.mockResolvedValue(undefined);
  triggerWebhooksMock.mockClear();
  triggerWebhooksMock.mockResolvedValue(undefined);
  submitUrlsToIndexNowMock.mockClear();
  submitUrlsToIndexNowMock.mockResolvedValue(undefined);
});

describe("addBank", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await addBank("Test Bank");

    expect(result).toEqual({ error: "You must be signed in." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the moderation status message and never inserts when restricted/banned", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "Your account is currently restricted from submitting." });

    const result = await addBank("Test Bank");

    expect(result).toEqual({ error: "Your account is currently restricted from submitting." });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await addBank("Test Bank");

    expect("error" in result).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the existing bank without calling the RPC when exactly one name-normalized match exists", async () => {
    existingBankResult = {
      data: [{ id: "existing-1", slug: "existing-bank", name: "Existing Bank", city: null, state: null, source_authority: null }],
    };

    const result = await addBank("Existing Bank");

    expect(result).toEqual({ id: "existing-1", slug: "existing-bank", name: "Existing Bank" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an ambiguous result with every candidate when more than one name-normalized match exists, never inserting or picking one", async () => {
    existingBankResult = {
      data: [
        { id: "bank-a", slug: "pinnacle-bank-tn", name: "Pinnacle Bank", city: "Nashville", state: "TN", source_authority: "fdic" },
        { id: "bank-b", slug: "pinnacle-bank-ga", name: "Pinnacle Bank", city: "Elberton", state: "GA", source_authority: "fdic" },
      ],
    };

    const result = await addBank("Pinnacle Bank");

    expect(result).toEqual({
      ambiguous: true,
      candidates: [
        { id: "bank-a", slug: "pinnacle-bank-tn", name: "Pinnacle Bank", city: "Nashville", state: "TN", sourceAuthority: "fdic" },
        { id: "bank-b", slug: "pinnacle-bank-ga", name: "Pinnacle Bank", city: "Elberton", state: "GA", sourceAuthority: "fdic" },
      ],
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls the atomic add_bank_with_attribution RPC with the current user's id", async () => {
    const result = await addBank("Test Bank");

    expect(result).toEqual({ id: "bank-1", slug: "test-bank", name: "Test Bank" });
    expect(rpcMock).toHaveBeenCalledWith("add_bank_with_attribution", {
      p_name: "Test Bank",
      p_slug: "test-bank",
      p_user_id: "user-1",
    });
  });

  it("surfaces an RPC failure as a plain error (atomicity means no partial state to recover from here)", async () => {
    rpcSingleResult = { data: null, error: { message: "attribution FK violation" } };

    const result = await addBank("Test Bank");

    expect(result).toEqual({ error: "Failed to add bank." });
  });

  describe("post-insert background work", () => {
    it("registers enrichment, webhook delivery, and IndexNow submission through a single after() call", async () => {
      const result = await addBank("Test Bank");

      expect(result).toEqual({ id: "bank-1", slug: "test-bank", name: "Test Bank" });
      // None of the background work runs until the captured after() callback
      // is actually invoked — the action returning must not have run it inline.
      expect(enrichBankMock).not.toHaveBeenCalled();
      expect(triggerWebhooksMock).not.toHaveBeenCalled();
      expect(submitUrlsToIndexNowMock).not.toHaveBeenCalled();
      expect(capturedAfterCallback).not.toBeNull();

      await capturedAfterCallback?.();

      expect(enrichBankMock).toHaveBeenCalledWith("bank-1");
      expect(triggerWebhooksMock).toHaveBeenCalledWith("bank_added", { bankId: "bank-1", bankName: "Test Bank" });
      expect(submitUrlsToIndexNowMock).toHaveBeenCalledWith(["https://www.instantrailcheck.com/banks/test-bank"]);
      expect(logErrorMock).not.toHaveBeenCalled();
    });

    it("does not throw and still runs the other tasks when one background task rejects", async () => {
      enrichBankMock.mockRejectedValue(new Error("FDIC lookup timed out"));

      await addBank("Test Bank");

      await expect(capturedAfterCallback?.()).resolves.toBeUndefined();

      expect(triggerWebhooksMock).toHaveBeenCalled();
      expect(submitUrlsToIndexNowMock).toHaveBeenCalled();
      expect(logErrorMock).toHaveBeenCalledWith(
        "addBank background task failed: enrichBank",
        expect.objectContaining({ task: "enrichBank", bankId: "bank-1", bankSlug: "test-bank", error: "FDIC lookup timed out" })
      );
    });

    it("logs every task that rejects, not just the first", async () => {
      enrichBankMock.mockRejectedValue(new Error("enrich failed"));
      triggerWebhooksMock.mockRejectedValue(new Error("webhook failed"));

      await addBank("Test Bank");
      await capturedAfterCallback?.();

      expect(logErrorMock).toHaveBeenCalledTimes(2);
      expect(logErrorMock).toHaveBeenCalledWith("addBank background task failed: enrichBank", expect.objectContaining({ error: "enrich failed" }));
      expect(logErrorMock).toHaveBeenCalledWith("addBank background task failed: triggerWebhooks", expect.objectContaining({ error: "webhook failed" }));
      // submitUrlsToIndexNow still succeeded, so it must not be logged as a failure.
      expect(logErrorMock).not.toHaveBeenCalledWith(expect.stringContaining("submitUrlsToIndexNow"), expect.anything());
    });
  });
});
