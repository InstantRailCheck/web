import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: currentUser } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: getUserMock } }),
}));

type BankRow = {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  fdic_cert: number | null;
  ncua_charter_number: number | null;
};
let bankResult: { data: BankRow | null } = {
  data: { id: "bank-1", name: "Test Bank", website: "https://old.example.com", phone: null, fdic_cert: null, ncua_charter_number: null },
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

const lookupFdicBankByCertMock = vi.fn();
const lookupNcuaCreditUnionByCharterMock = vi.fn();
vi.mock("@/lib/fdicLookup", () => ({
  lookupFdicBank: vi.fn(() => Promise.resolve(null)),
  lookupFdicBankByCert: (...args: unknown[]) => lookupFdicBankByCertMock(...args),
}));
vi.mock("@/lib/ncuaLookup", () => ({
  lookupNcuaCreditUnion: vi.fn(() => Promise.resolve(null)),
  lookupNcuaCreditUnionByCharter: (...args: unknown[]) => lookupNcuaCreditUnionByCharterMock(...args),
}));
vi.mock("@/lib/finraLookup", () => ({ lookupFinraBroker: vi.fn(() => Promise.resolve(null)) }));

const { submitCorrection } = await import("./submitCorrection");

beforeEach(() => {
  currentUser = { id: "user-1" };
  bankResult = {
    data: { id: "bank-1", name: "Test Bank", website: "https://old.example.com", phone: null, fdic_cert: null, ncua_charter_number: null },
  };
  getUserMock.mockClear();
  fromMock.mockClear();
  insertMock.mockClear();
  getUserModerationStatusMock.mockClear();
  getUserModerationStatusMock.mockResolvedValue({ blocked: false });
  isActionRateLimitedMock.mockClear();
  isActionRateLimitedMock.mockResolvedValue(false);
  lookupFdicBankByCertMock.mockClear();
  lookupFdicBankByCertMock.mockResolvedValue(null);
  lookupNcuaCreditUnionByCharterMock.mockClear();
  lookupNcuaCreditUnionByCharterMock.mockResolvedValue(null);
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

  it("uses the identifier-based FDIC lookup, not a name search, when the bank is already fdic_cert-linked", async () => {
    bankResult = {
      data: { id: "bank-1", name: "Pinnacle Bank", website: null, phone: null, fdic_cert: 12345, ncua_charter_number: null },
    };
    lookupFdicBankByCertMock.mockResolvedValue({ website: "https://real-charter.example.com", address: null });

    const result = await submitCorrection("bank-1", "website", "https://real-charter.example.com");

    expect(lookupFdicBankByCertMock).toHaveBeenCalledWith(12345);
    expect(result.status).toBe("auto_applied");
  });

  it("uses the identifier-based NCUA lookup, not a name search, when the bank is already ncua-linked", async () => {
    bankResult = {
      data: { id: "bank-1", name: "Pinnacle Bank", website: null, phone: "555-0100", fdic_cert: null, ncua_charter_number: 9876 },
    };
    lookupNcuaCreditUnionByCharterMock.mockResolvedValue({ website: null, address: null, phone: "555-0100" });

    const result = await submitCorrection("bank-1", "phone", "555-0100");

    expect(lookupNcuaCreditUnionByCharterMock).toHaveBeenCalledWith(9876);
    expect(result.status).toBe("auto_applied");
  });
});
