import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

let bankResult: { data: { id: string; name: string; website: string | null; phone: string | null } | null } = {
  data: { id: "bank-1", name: "Test Bank", website: "https://old.example.com", phone: null },
};
const maybeSingleMock = vi.fn(() => Promise.resolve(bankResult));
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const updateEqMock = vi.fn(() => Promise.resolve({ error: null }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));
const insertMock = vi.fn(() => Promise.resolve({ error: null }));
const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock, insert: insertMock }));

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

vi.mock("@/lib/fdicLookup", () => ({ lookupFdicBank: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/lib/ncuaLookup", () => ({ lookupNcuaCreditUnion: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/lib/finraLookup", () => ({ lookupFinraBroker: vi.fn(() => Promise.resolve(null)) }));

const { submitCorrection } = await import("./submitCorrection");

beforeEach(() => {
  currentUser = { id: "user-1" };
  bankResult = { data: { id: "bank-1", name: "Test Bank", website: "https://old.example.com", phone: null } };
  getUserMock.mockClear();
  fromMock.mockClear();
  insertMock.mockClear();
  getUserModerationStatusMock.mockClear();
  getUserModerationStatusMock.mockResolvedValue({ blocked: false });
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
});

describe("submitCorrection", () => {
  it("returns an error when unauthenticated", async () => {
    currentUser = null;

    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result).toEqual({ status: "error", message: "You must be signed in to submit a correction." });
  });

  it("returns the moderation status message and never submits when restricted/banned", async () => {
    getUserModerationStatusMock.mockResolvedValue({ blocked: true, message: "Your account is currently restricted from submitting." });

    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result).toEqual({ status: "error", message: "Your account is currently restricted from submitting." });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result.status).toBe("error");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("submits pending_review when the value can't be confirmed against an official source", async () => {
    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result.status).toBe("pending_review");
    expect(insertMock).toHaveBeenCalled();
  });
});
