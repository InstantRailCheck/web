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
  is_active: boolean;
};
let bankResult: { data: BankRow | null; error: { message: string } | null } = {
  data: {
    id: "bank-1",
    name: "Test Bank",
    website: "https://old.example.com",
    phone: null,
    fdic_cert: null,
    ncua_charter_number: null,
    is_active: true,
  },
  error: null,
};
const maybeSingleMock = vi.fn(() => Promise.resolve(bankResult));
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

let rpcResult: { error: { message: string } | null } = { error: null };
const rpcMock = vi.fn(() => Promise.resolve(rpcResult));

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
    data: {
      id: "bank-1",
      name: "Test Bank",
      website: "https://old.example.com",
      phone: null,
      fdic_cert: null,
      ncua_charter_number: null,
      is_active: true,
    },
    error: null,
  };
  rpcResult = { error: null };
  getUserMock.mockClear();
  fromMock.mockClear();
  rpcMock.mockClear();
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
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an error when rate-limited", async () => {
    isActionRateLimitedMock.mockResolvedValue(true);

    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result.status).toBe("error");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a field outside the runtime allowlist before any lookup or write, regardless of what the caller passes", async () => {
    // A Server Action is a real endpoint — an attacker can send any string
    // here no matter what the exported TS signature claims. Cast to
    // simulate that: the TS union type alone must not be the only guard.
    const result = await submitCorrection("bank-1", "role" as unknown as "website", "admin");

    expect(result).toEqual({ status: "error", message: "Invalid correction field." });
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string value before any lookup or write, instead of throwing inside .trim()", async () => {
    // Same reasoning as the field cast above — a Server Action can be
    // called with any JSON payload regardless of the TS signature.
    const result = await submitCorrection("bank-1", "website", { toString: () => "hi" } as unknown as string);

    expect(result).toEqual({ status: "error", message: "Invalid correction value." });
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a value longer than bank_corrections.submitted_value's own 500-char limit", async () => {
    const result = await submitCorrection("bank-1", "website", "a".repeat(501));

    expect(result).toEqual({ status: "error", message: "Invalid correction value." });
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an error and never calls the apply RPC when the bank lookup itself errors", async () => {
    bankResult = { data: null, error: { message: "connection reset" } };

    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result.status).toBe("error");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a correction for an inactive institution without calling the apply RPC", async () => {
    bankResult = {
      data: {
        id: "bank-1",
        name: "Closed Bank",
        website: "https://old.example.com",
        phone: null,
        fdic_cert: null,
        ncua_charter_number: null,
        is_active: false,
      },
      error: null,
    };

    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/no longer listed/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("submits pending_review when the value can't be confirmed against an official source", async () => {
    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result.status).toBe("pending_review");
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_bank_correction",
      expect.objectContaining({ p_bank_id: "bank-1", p_field: "website", p_matched: false })
    );
  });

  it("returns an error and does not report success when the apply RPC itself fails", async () => {
    // Covers the insert-succeeds-but-update-fails (and vice versa) case:
    // both statements now live inside one RPC transaction, so any failure
    // there must surface as a plain error, never a false auto_applied.
    lookupFdicBankByCertMock.mockResolvedValue(null);
    rpcResult = { error: { message: "constraint violation" } };

    const result = await submitCorrection("bank-1", "website", "https://new.example.com");

    expect(result.status).toBe("error");
  });

  it("uses the identifier-based FDIC lookup, not a name search, when the bank is already fdic_cert-linked", async () => {
    bankResult = {
      data: {
        id: "bank-1",
        name: "Pinnacle Bank",
        website: null,
        phone: null,
        fdic_cert: 12345,
        ncua_charter_number: null,
        is_active: true,
      },
      error: null,
    };
    lookupFdicBankByCertMock.mockResolvedValue({ website: "https://real-charter.example.com", address: null });

    const result = await submitCorrection("bank-1", "website", "https://real-charter.example.com");

    expect(lookupFdicBankByCertMock).toHaveBeenCalledWith(12345);
    expect(result.status).toBe("auto_applied");
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_bank_correction",
      expect.objectContaining({ p_matched: true, p_official_value: "https://real-charter.example.com" })
    );
  });

  it("uses the identifier-based NCUA lookup, not a name search, when the bank is already ncua-linked", async () => {
    bankResult = {
      data: {
        id: "bank-1",
        name: "Pinnacle Bank",
        website: null,
        phone: "555-0100",
        fdic_cert: null,
        ncua_charter_number: 9876,
        is_active: true,
      },
      error: null,
    };
    lookupNcuaCreditUnionByCharterMock.mockResolvedValue({ website: null, address: null, phone: "555-0100" });

    const result = await submitCorrection("bank-1", "phone", "555-0100");

    expect(lookupNcuaCreditUnionByCharterMock).toHaveBeenCalledWith(9876);
    expect(result.status).toBe("auto_applied");
  });
});
