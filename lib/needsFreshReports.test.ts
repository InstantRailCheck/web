import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteEvidence } from "./routeConfidence";
import type { NeedsFreshReportRoute } from "./needsFreshReports";

// needsFreshReports.ts is marked server-only, which throws on import outside
// a real Next.js server build — a build-time guard, not something to
// enforce in a vitest run.
vi.mock("server-only", () => ({}));

// Deliberately far from the real current date (unlike routeConfidence.test.ts's
// NOW fixture, which happens to sit close to real "today"): the fixed-`now`
// test below needs a NOW that would produce an obviously different
// classification than the real wall clock would, to actually prove the code
// uses the injected `now` rather than silently calling `new Date()` somewhere.
const NOW = new Date("2030-06-15T00:00:00Z");

function daysAgo(days: number): string {
  const d = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

function evidence(overrides: Partial<RouteEvidence>): RouteEvidence {
  return { state: "observed_working", reportCount: 1, latestObservationDate: daysAgo(1), ...overrides };
}

type Row = {
  from_bank_id: string | null;
  to_bank_id: string | null;
  rail_used: string | null;
  status: string;
  tested_at: string | null;
  user_id: string | null;
};

let routeReportRows: Row[] = [];
let routeReportsErrorAtOffset: number | null = null;
let banksTable: { id: string; slug: string; name: string }[] = [];
let banksError = false;
const banksInCalls: string[][] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "route_reports") {
        return {
          select: () => ({
            order: () => ({
              range: (offset: number, end: number) => {
                if (routeReportsErrorAtOffset === offset) {
                  return Promise.resolve({ data: null, error: new Error("db error") });
                }
                const page = routeReportRows.slice(offset, end + 1);
                return Promise.resolve({ data: page, error: null });
              },
            }),
          }),
        };
      }
      if (table === "banks") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              banksInCalls.push(ids);
              if (banksError) return Promise.resolve({ data: null, error: new Error("banks db error") });
              const matched = banksTable.filter((b) => ids.includes(b.id));
              return Promise.resolve({ data: matched, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const {
  classifyRoute,
  representativeDate,
  compareRoutes,
  buildNeedsFreshReportRoutes,
  fetchAllRouteReports,
  fetchBanksByIds,
  getRoutesNeedingFreshReports,
  getRoutesNeedingFreshReportsLogged,
  isPageOutOfRange,
  REASON_LABELS,
} = await import("./needsFreshReports");
const { createAdminClient } = await import("@/lib/supabase/admin");

beforeEach(() => {
  routeReportRows = [];
  routeReportsErrorAtOffset = null;
  banksTable = [];
  banksError = false;
  banksInCalls.length = 0;
});

function row(overrides: Partial<Row>): Row {
  return {
    from_bank_id: "bank-a",
    to_bank_id: "bank-b",
    rail_used: "ACH",
    status: "success",
    tested_at: daysAgo(1),
    user_id: "u1",
    ...overrides,
  };
}

describe("classifyRoute", () => {
  it("classifies as no_evidence when every rail has no attributable evidence", () => {
    expect(classifyRoute([null, null])).toBe("no_evidence");
  });

  it("classifies as stale when every present rail is previously_observed", () => {
    expect(classifyRoute([evidence({ state: "previously_observed" }), null])).toBe("stale");
  });

  it("classifies as limited_evidence when every present rail is limited_evidence", () => {
    expect(classifyRoute([evidence({ state: "limited_evidence" })])).toBe("limited_evidence");
  });

  it("classifies a mix of stale and limited_evidence rails as stale", () => {
    expect(
      classifyRoute([evidence({ state: "previously_observed" }), evidence({ state: "limited_evidence" })])
    ).toBe("stale");
  });

  it("classifies as sufficient when any rail has real, non-borderline evidence", () => {
    expect(
      classifyRoute([evidence({ state: "consistently_reported" }), evidence({ state: "limited_evidence" })])
    ).toBe("sufficient");
  });
});

describe("representativeDate", () => {
  it("returns null for no_evidence", () => {
    expect(representativeDate("no_evidence", [])).toBeNull();
  });

  it("returns the freshest previously_observed date for stale", () => {
    const present = [
      evidence({ state: "previously_observed", latestObservationDate: daysAgo(300) }),
      evidence({ state: "previously_observed", latestObservationDate: daysAgo(200) }),
    ];
    expect(representativeDate("stale", present)).toBe(daysAgo(200));
  });

  it("returns the oldest limited_evidence date (closest to the 180-day cliff)", () => {
    const present = [
      evidence({ state: "limited_evidence", latestObservationDate: daysAgo(10) }),
      evidence({ state: "limited_evidence", latestObservationDate: daysAgo(170) }),
    ];
    expect(representativeDate("limited_evidence", present)).toBe(daysAgo(170));
  });
});

describe("compareRoutes (ranking)", () => {
  function route(overrides: Partial<NeedsFreshReportRoute>): NeedsFreshReportRoute {
    return {
      fromBankId: "a",
      fromBankSlug: "a",
      fromBankName: "A Bank",
      toBankId: "b",
      toBankSlug: "b",
      toBankName: "B Bank",
      reason: "no_evidence" as const,
      lastObservationDate: null,
      ...overrides,
    };
  }

  it("orders by reason severity: no_evidence, then stale, then limited_evidence", () => {
    const items = [
      route({ fromBankName: "Z", reason: "limited_evidence", lastObservationDate: daysAgo(5) }),
      route({ fromBankName: "Y", reason: "stale", lastObservationDate: daysAgo(200) }),
      route({ fromBankName: "X", reason: "no_evidence" }),
    ];
    const sorted = [...items].sort(compareRoutes);
    expect(sorted.map((r) => r.reason)).toEqual(["no_evidence", "stale", "limited_evidence"]);
  });

  it("within a group, orders oldest/most-overdue date first", () => {
    const items = [
      route({ fromBankName: "A", reason: "stale", lastObservationDate: daysAgo(190) }),
      route({ fromBankName: "B", reason: "stale", lastObservationDate: daysAgo(300) }),
    ];
    const sorted = [...items].sort(compareRoutes);
    expect(sorted.map((r) => r.lastObservationDate)).toEqual([daysAgo(300), daysAgo(190)]);
  });

  it("breaks ties alphabetically by fromBankName then toBankName when dates match or are absent", () => {
    const items = [
      route({ fromBankName: "Zelle Bank", toBankName: "A", reason: "no_evidence" }),
      route({ fromBankName: "Ally", toBankName: "Z", reason: "no_evidence" }),
      route({ fromBankName: "Ally", toBankName: "A", reason: "no_evidence" }),
    ];
    const sorted = [...items].sort(compareRoutes);
    expect(sorted.map((r) => `${r.fromBankName}->${r.toBankName}`)).toEqual([
      "Ally->A",
      "Ally->Z",
      "Zelle Bank->A",
    ]);
  });
});

describe("buildNeedsFreshReportRoutes", () => {
  const banks = [
    { id: "bank-a", slug: "bank-a", name: "Bank A" },
    { id: "bank-b", slug: "bank-b", name: "Bank B" },
  ];

  it("drops a pair when either referenced bank id no longer resolves (deleted bank)", () => {
    const rows = [row({ from_bank_id: "bank-a", to_bank_id: "ghost-bank" })];
    expect(buildNeedsFreshReportRoutes(rows, banks, NOW)).toEqual([]);
  });

  it("reproduces today's real data shape: unattributed-only, single fresh reporter, and mixed-rail-with-strong-rail pairs", () => {
    const threeBanks = [...banks, { id: "bank-c", slug: "bank-c", name: "Bank C" }];
    const rows = [
      // Chase -> Gesa-style: only unattributed (seed) rows -> no_evidence.
      row({ from_bank_id: "bank-a", to_bank_id: "bank-b", rail_used: "ACH", user_id: null }),
      // US Bank -> Chase-style: one real attributed report -> limited_evidence.
      row({ from_bank_id: "bank-b", to_bank_id: "bank-a", rail_used: "RTP", user_id: "u1" }),
      // A pair with one weak rail and one strong rail -> excluded entirely.
      row({ from_bank_id: "bank-a", to_bank_id: "bank-c", rail_used: "ACH", user_id: null }),
      row({ from_bank_id: "bank-a", to_bank_id: "bank-c", rail_used: "RTP", user_id: "u1", tested_at: daysAgo(1) }),
      row({ from_bank_id: "bank-a", to_bank_id: "bank-c", rail_used: "RTP", user_id: "u2", tested_at: daysAgo(2) }),
      row({ from_bank_id: "bank-a", to_bank_id: "bank-c", rail_used: "RTP", user_id: "u3", tested_at: daysAgo(3) }),
    ];

    const result = buildNeedsFreshReportRoutes(rows, threeBanks, NOW);

    expect(result).toHaveLength(2);
    const byPair = new Map(result.map((r) => [`${r.fromBankSlug}->${r.toBankSlug}`, r]));
    expect(byPair.get("bank-a->bank-b")?.reason).toBe("no_evidence");
    expect(byPair.get("bank-b->bank-a")?.reason).toBe("limited_evidence");
    expect(byPair.has("bank-a->bank-c")).toBe(false);
  });

  it("judges every rail of every pair against the same fixed `now`, not independent wall-clock calls", () => {
    // A report exactly at the freshness boundary: fresh as of NOW, but would
    // be stale one day later. Two rails on two different pairs share this
    // exact report shape — if `now` weren't threaded consistently, they
    // could be classified differently depending on call order/timing.
    const boundaryDate = daysAgo(179);
    const rows = [
      row({ from_bank_id: "bank-a", to_bank_id: "bank-b", rail_used: "ACH", user_id: "u1", tested_at: boundaryDate }),
      row({ from_bank_id: "bank-b", to_bank_id: "bank-a", rail_used: "ACH", user_id: "u1", tested_at: boundaryDate }),
    ];

    const result = buildNeedsFreshReportRoutes(rows, banks, NOW);
    expect(result.map((r) => r.reason)).toEqual(["limited_evidence", "limited_evidence"]);
  });

  it("classifies a pair with two independently-limited rails (two distinct reporters, not one) as limited_evidence", () => {
    // ACH confirmed once by u1, RTP confirmed once by u2 — two real reports
    // total, but each rail only has one, so the pair is still
    // limited_evidence. The label must not claim a specific report count
    // (see REASON_LABELS below) since this case has more than one report.
    const rows = [
      row({ from_bank_id: "bank-a", to_bank_id: "bank-b", rail_used: "ACH", user_id: "u1" }),
      row({ from_bank_id: "bank-a", to_bank_id: "bank-b", rail_used: "RTP", user_id: "u2" }),
    ];
    const result = buildNeedsFreshReportRoutes(rows, banks, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("limited_evidence");
  });
});

describe("REASON_LABELS", () => {
  it("does not claim a specific report count for limited_evidence, since a pair can have more than one report across rails", () => {
    expect(REASON_LABELS.limited_evidence).not.toMatch(/one report/i);
  });
});

describe("isPageOutOfRange", () => {
  it("is false when there are no routes at all, regardless of the requested page", () => {
    expect(isPageOutOfRange(2, 0, 25)).toBe(false);
  });

  it("is false for any page within range", () => {
    expect(isPageOutOfRange(1, 7, 25)).toBe(false);
    expect(isPageOutOfRange(2, 30, 25)).toBe(false);
  });

  it("is true when routes exist but the requested page is past the end of them", () => {
    expect(isPageOutOfRange(2, 7, 25)).toBe(true);
    expect(isPageOutOfRange(999, 7, 25)).toBe(true);
  });
});

describe("fetchAllRouteReports", () => {
  it("aggregates past the 1000-row page cap instead of truncating", async () => {
    routeReportRows = [
      ...Array.from({ length: 1000 }, () => row({})),
      row({ user_id: "the-1001st-row" }),
      row({ user_id: "the-1002nd-row" }),
      row({ user_id: "the-1003rd-row" }),
    ];
    const supabase = createAdminClient();
    const rows = await fetchAllRouteReports(supabase);
    expect(rows).toHaveLength(1003);
  });

  it("throws rather than returning partial rows when a page errors", async () => {
    routeReportRows = Array.from({ length: 1500 }, () => row({}));
    routeReportsErrorAtOffset = 1000;
    const supabase = createAdminClient();
    await expect(fetchAllRouteReports(supabase)).rejects.toThrow("db error");
  });
});

describe("fetchBanksByIds", () => {
  it("splits more than 200 ids into multiple .in() chunks and merges the results completely", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `bank-${i}`);
    banksTable = ids.map((id) => ({ id, slug: id, name: id }));
    const supabase = createAdminClient();
    const result = await fetchBanksByIds(supabase, ids);
    expect(result).toHaveLength(250);
    expect(banksInCalls.length).toBeGreaterThanOrEqual(2);
    expect(banksInCalls.every((chunk) => chunk.length <= 200)).toBe(true);
  });

  it("propagates a chunk-level error rather than swallowing it", async () => {
    banksError = true;
    const supabase = createAdminClient();
    await expect(fetchBanksByIds(supabase, ["bank-a"])).rejects.toThrow("banks db error");
  });
});

describe("getRoutesNeedingFreshReports (end to end, mocked DB)", () => {
  it("assembles, classifies, and ranks routes from the two fetches", async () => {
    banksTable = [
      { id: "bank-a", slug: "bank-a", name: "Bank A" },
      { id: "bank-b", slug: "bank-b", name: "Bank B" },
    ];
    routeReportRows = [row({ from_bank_id: "bank-a", to_bank_id: "bank-b", user_id: null })];

    const result = await getRoutesNeedingFreshReports();
    expect(result).toEqual([
      {
        fromBankId: "bank-a",
        fromBankSlug: "bank-a",
        fromBankName: "Bank A",
        toBankId: "bank-b",
        toBankSlug: "bank-b",
        toBankName: "Bank B",
        reason: "no_evidence",
        lastObservationDate: null,
      },
    ]);
  });

  it("fails closed: a fetch error throws rather than resolving with an empty/partial list", async () => {
    routeReportRows = [row({})];
    routeReportsErrorAtOffset = 0;
    await expect(getRoutesNeedingFreshReports()).rejects.toThrow("db error");
  });
});

describe("getRoutesNeedingFreshReportsLogged", () => {
  it("logs and rethrows on failure instead of swallowing the error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    routeReportRows = [row({})];
    routeReportsErrorAtOffset = 0;

    await expect(getRoutesNeedingFreshReportsLogged()).rejects.toThrow("db error");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
