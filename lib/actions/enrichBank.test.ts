import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type BankRow = {
  name: string;
  city: string | null;
  state: string | null;
  fdic_cert: number | null;
  ncua_charter_number: number | null;
};

let bankRow: BankRow = { name: "Test Bank", city: null, state: null, fdic_cert: null, ncua_charter_number: null };
let currentFlags: { fednow_participant: boolean; rtp_participant: boolean; zelle_participant: boolean } = {
  fednow_participant: false,
  rtp_participant: false,
  zelle_participant: false,
};

const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

function fromImpl(table: string) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: bankRow }),
      }),
    }),
    update: (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return {
        eq: () => ({
          or: () => Promise.resolve({ error: null }),
        }),
      };
    },
  };
}

// Declared bare (not vi.fn(fromImpl)) so its type isn't pinned to
// fromImpl's own return shape — one test below installs a different
// implementation whose maybeSingle() resolves a union type.
const fromMock = vi.fn();
fromMock.mockImplementation(fromImpl);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => fromMock(table) }),
}));

const resolveOfficialMatchMock = vi.fn();
vi.mock("@/lib/officialInstitutionMatch", () => ({
  resolveOfficialMatch: (...args: unknown[]) => resolveOfficialMatchMock(...args),
}));

const checkRailParticipationMock = vi.fn();
vi.mock("@/lib/railParticipation", () => ({
  checkRailParticipation: (...args: unknown[]) => checkRailParticipationMock(...args),
}));

const { enrichBank } = await import("./enrichBank");

beforeEach(() => {
  bankRow = { name: "Test Bank", city: null, state: null, fdic_cert: null, ncua_charter_number: null };
  currentFlags = { fednow_participant: false, rtp_participant: false, zelle_participant: false };
  updateCalls.length = 0;
  fromMock.mockClear();
  fromMock.mockImplementation(fromImpl);
  resolveOfficialMatchMock.mockReset();
  resolveOfficialMatchMock.mockResolvedValue({ fdicMatch: null, ncuaMatch: null, finraMatch: null });
  checkRailParticipationMock.mockReset();
  checkRailParticipationMock.mockResolvedValue({ fednow: false, rtp: false, zelle: false });
});

describe("enrichBank", () => {
  it("passes the bank's own identifiers to resolveOfficialMatch, not just its name", async () => {
    bankRow = { name: "Pinnacle Bank", city: "Nashville", state: "TN", fdic_cert: 12345, ncua_charter_number: null };

    await enrichBank("bank-1");

    expect(resolveOfficialMatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Pinnacle Bank", fdic_cert: 12345, ncua_charter_number: null })
    );
  });

  it("passes city/state to checkRailParticipation for duplicate-safe matching", async () => {
    bankRow = { name: "Pinnacle Bank", city: "Nashville", state: "TN", fdic_cert: null, ncua_charter_number: null };

    await enrichBank("bank-1");

    expect(checkRailParticipationMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Pinnacle Bank", city: "Nashville", state: "TN" })
    );
  });

  it("never downgrades an already-true rail flag even when the fresh check finds no match", async () => {
    currentFlags = { fednow_participant: true, rtp_participant: false, zelle_participant: false };
    checkRailParticipationMock.mockResolvedValue({ fednow: false, rtp: true, zelle: false });

    // enrichBank's first banks select() fetches the bank row itself; its
    // second fetches current flags — selectCallCount must live outside the
    // per-from() factory since enrichBank calls admin.from("banks")
    // separately for each.
    let selectCallCount = 0;
    fromMock.mockImplementation((table: string) => ({
      select: () => {
        selectCallCount++;
        return {
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: selectCallCount === 1 ? bankRow : currentFlags }),
          }),
        };
      },
      update: (payload: Record<string, unknown>) => {
        updateCalls.push({ table, payload });
        return { eq: () => ({ or: () => Promise.resolve({ error: null }) }) };
      },
    }));

    await enrichBank("bank-1");

    const flagsUpdate = updateCalls.find((c) => "fednow_participant" in c.payload);
    expect(flagsUpdate?.payload).toEqual({
      fednow_participant: true, // stayed true despite a false fresh check
      rtp_participant: true, // newly set true
      zelle_participant: false,
    });
  });
});
