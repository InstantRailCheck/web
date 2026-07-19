import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

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

vi.mock("@/lib/actions/enrichBank", () => ({ enrichBank: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/actions/triggerWebhooks", () => ({ triggerWebhooks: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/indexNow", () => ({ submitUrlsToIndexNow: vi.fn(() => Promise.resolve()) }));

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
});
