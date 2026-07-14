import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

function fakeTable(rows: Row[]) {
  return {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      const filters: ((r: Row) => boolean)[] = [];
      const api = {
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return api;
        },
        in(col: string, vals: unknown[]) {
          filters.push((r) => vals.includes(r[col]));
          return api;
        },
        gte(col: string, val: unknown) {
          filters.push((r) => (r[col] as string) >= (val as string));
          return api;
        },
        lte(col: string, val: unknown) {
          filters.push((r) => (r[col] as string) <= (val as string));
          return api;
        },
        not(col: string, _op: string, val: unknown) {
          filters.push((r) => (val === null ? r[col] !== null : r[col] !== val));
          return api;
        },
        ilike(col: string, pattern: string) {
          const re = new RegExp(String(pattern).replaceAll("%", ".*"), "i");
          filters.push((r) => re.test(String(r[col] ?? "")));
          return api;
        },
        order() {
          return api;
        },
        then(resolve: (v: { data: Row[] | null; count: number; error: null }) => void) {
          const data = rows.filter((r) => filters.every((f) => f(r)));
          resolve(opts?.head ? { data: null, count: data.length, error: null } : { data, count: data.length, error: null });
        },
      };
      return api;
    },
  };
}

type Fixtures = {
  routeReports?: Row[];
  eddReports?: Row[];
  banks?: Row[];
  moderationActions?: Row[];
  userModerationStatus?: Row[];
};

function mockAdmin(fixtures: Fixtures) {
  const tables: Record<string, Row[]> = {
    route_reports: fixtures.routeReports ?? [],
    edd_reports: fixtures.eddReports ?? [],
    banks: fixtures.banks ?? [],
    moderation_actions: fixtures.moderationActions ?? [],
    user_moderation_status: fixtures.userModerationStatus ?? [],
  };
  return { from: (table: string) => fakeTable(tables[table] ?? []) };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => currentAdmin }));

let currentAdmin: ReturnType<typeof mockAdmin>;

const { fetchTriageQueue } = await import("./riskTriage");

const NOW = new Date("2026-07-14T12:00:00.000Z");

const BANK_A = { id: "bank-a", name: "Bank A", fednow_participant: true, rtp_participant: true };
const BANK_B = { id: "bank-b", name: "Bank B", fednow_participant: true, rtp_participant: true };

function baseFilters(overrides: Partial<Parameters<typeof fetchTriageQueue>[0]> = {}) {
  return {
    page: 1,
    table: "all" as const,
    minSeverity: "info" as const,
    signalTypes: null,
    bankFilter: "",
    accountFilter: null,
    dateFrom: null,
    dateTo: null,
    showReviewed: false,
    ...overrides,
  };
}

function routeReport(overrides: Partial<Row>): Row {
  return {
    id: "r1",
    from_bank_id: "bank-a",
    to_bank_id: "bank-b",
    from_bank_name: "Bank A",
    to_bank_name: "Bank B",
    rail_used: "ACH",
    direction: "push",
    status: "success",
    tested_at: "2026-07-14",
    settlement_time_minutes: 30,
    user_id: "user-1",
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("fetchTriageQueue", () => {
  it("flags a new reporter submitting a burst of reports and never surfaces a lone, unremarkable report", async () => {
    const burst = [0, 1, 2].map((i) =>
      routeReport({
        id: `burst-${i}`,
        user_id: "new-user",
        created_at: new Date(NOW.getTime() - i * 5 * 60_000).toISOString(),
        to_bank_id: `bank-${i}`,
        to_bank_name: `Other Bank ${i}`,
      })
    );
    const lonely = routeReport({ id: "lonely", user_id: "quiet-user", created_at: NOW.toISOString() });

    currentAdmin = mockAdmin({ routeReports: [...burst, lonely], banks: [BANK_A, BANK_B] });

    const { rows, total } = await fetchTriageQueue(baseFilters(), NOW);

    expect(total).toBe(3);
    expect(rows.every((r) => r.userId === "new-user")).toBe(true);
    expect(rows.some((r) => r.id === "lonely")).toBe(false);
    expect(rows[0].signals.some((s) => s.signal === "new_reporter_high_volume")).toBe(true);
  });

  it("respects the table filter", async () => {
    const burst = [0, 1, 2].map((i) =>
      routeReport({ id: `r-${i}`, user_id: "new-user", created_at: new Date(NOW.getTime() - i * 5 * 60_000).toISOString() })
    );
    currentAdmin = mockAdmin({ routeReports: burst, banks: [BANK_A, BANK_B] });

    const { rows } = await fetchTriageQueue(baseFilters({ table: "edd_reports" }), NOW);
    expect(rows).toEqual([]);
  });

  it("respects the bank filter", async () => {
    const burst = [0, 1, 2].map((i) =>
      routeReport({ id: `r-${i}`, user_id: "new-user", created_at: new Date(NOW.getTime() - i * 5 * 60_000).toISOString() })
    );
    currentAdmin = mockAdmin({ routeReports: burst, banks: [BANK_A, BANK_B] });

    const { rows } = await fetchTriageQueue(baseFilters({ bankFilter: "Nonexistent" }), NOW);
    expect(rows).toEqual([]);
  });

  it("excludes info-severity-only flags when minSeverity is warning", async () => {
    const fednowMissing = routeReport({
      id: "fednow-missing",
      rail_used: "FedNow",
      to_bank_id: "bank-unknown",
      to_bank_name: "Unknown Participant Bank",
      user_id: "solo-user",
    });
    currentAdmin = mockAdmin({
      routeReports: [fednowMissing],
      banks: [BANK_A, { id: "bank-unknown", name: "Unknown Participant Bank", fednow_participant: null, rtp_participant: null }],
    });

    const infoLevel = await fetchTriageQueue(baseFilters({ minSeverity: "info" }), NOW);
    expect(infoLevel.rows).toHaveLength(1);

    const warningLevel = await fetchTriageQueue(baseFilters({ minSeverity: "warning" }), NOW);
    expect(warningLevel.rows).toHaveLength(0);
  });

  it("excludes already-reviewed flags by default and includes them when showReviewed is set", async () => {
    const burst = [0, 1, 2].map((i) =>
      routeReport({ id: `r-${i}`, user_id: "new-user", created_at: new Date(NOW.getTime() - i * 5 * 60_000).toISOString() })
    );
    currentAdmin = mockAdmin({
      routeReports: burst,
      banks: [BANK_A, BANK_B],
      moderationActions: [{ action_type: "review_flag", target_table: "route_reports", target_id: "r-0", snapshot: { signals: [], score: 100 } }],
    });

    const hidden = await fetchTriageQueue(baseFilters(), NOW);
    expect(hidden.rows.some((r) => r.id === "r-0")).toBe(false);
    expect(hidden.total).toBe(2);

    const shown = await fetchTriageQueue(baseFilters({ showReviewed: true }), NOW);
    expect(shown.rows.some((r) => r.id === "r-0")).toBe(true);
    expect(shown.total).toBe(3);
  });

  it("resurfaces a reviewed flag once its currently-computed score exceeds what was reviewed", async () => {
    const burst = [0, 1, 2].map((i) =>
      routeReport({ id: `r-${i}`, user_id: "new-user", created_at: new Date(NOW.getTime() - i * 5 * 60_000).toISOString() })
    );
    // Reviewed back when its score was only 1 (e.g. a lone info-level
    // signal) — since it now scores higher (new_reporter_high_volume is
    // "high" severity, weight 3), it must resurface rather than stay
    // hidden behind a stale, lower-scored review.
    currentAdmin = mockAdmin({
      routeReports: burst,
      banks: [BANK_A, BANK_B],
      moderationActions: [{ action_type: "review_flag", target_table: "route_reports", target_id: "r-0", snapshot: { signals: [], score: 1 } }],
    });

    const { rows } = await fetchTriageQueue(baseFilters(), NOW);
    expect(rows.some((r) => r.id === "r-0")).toBe(true);
  });

  it("surfaces currently-restricted account history as a high-severity signal", async () => {
    const report = routeReport({ id: "r1", user_id: "restricted-user" });
    currentAdmin = mockAdmin({
      routeReports: [report],
      banks: [BANK_A, BANK_B],
      userModerationStatus: [{ user_id: "restricted-user", status: "restricted" }],
    });

    const { rows } = await fetchTriageQueue(baseFilters(), NOW);
    expect(rows).toHaveLength(1);
    const historySignal = rows[0].signals.find((s) => s.signal === "moderation_history");
    expect(historySignal?.severity).toBe("high");
  });

  it("does not let one reporter's repeated submissions dominate the settlement-time outlier baseline", async () => {
    const sixtyDaysAgo = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
    const candidate = routeReport({ id: "candidate", user_id: "normal-user", status: "success", settlement_time_minutes: 35 });
    // A single account's 4 identical old reports would, undeduped, satisfy
    // evaluateSettlementTimeOutlier's 4-comparison-point minimum and plant
    // a fake "typical" value of 1000 minutes for this route/rail.
    const spammerPool = [0, 1, 2, 3].map((i) =>
      routeReport({
        id: `spam-${i}`,
        user_id: "spammer-user",
        status: "success",
        settlement_time_minutes: 1000,
        tested_at: `2026-05-${10 + i}`,
        created_at: new Date(sixtyDaysAgo.getTime() + i * 60_000).toISOString(),
      })
    );
    currentAdmin = mockAdmin({ routeReports: [candidate, ...spammerPool], banks: [BANK_A, BANK_B] });

    const { rows } = await fetchTriageQueue(baseFilters(), NOW);
    const candidateRow = rows.find((r) => r.id === "candidate");
    // Either the candidate doesn't appear at all (no signal fired, since a
    // single deduped comparison point is below the outlier minimum) or it
    // appears without the outlier signal — either way, the fake 1000-minute
    // "baseline" from one repeating account must not flag it.
    expect(candidateRow?.signals.some((s) => s.signal === "settlement_time_outlier") ?? false).toBe(false);
  });

  it("still detects a velocity burst inside a custom historical date range, not just near 'now'", async () => {
    const rangeStart = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(NOW.getTime() - 59 * 24 * 60 * 60 * 1000);
    const anchor = new Date(rangeStart.getTime() + 12 * 60 * 60 * 1000);
    const burst = [0, 1, 2].map((i) =>
      routeReport({ id: `hist-${i}`, user_id: "new-user", created_at: new Date(anchor.getTime() - i * 5 * 60_000).toISOString() })
    );
    currentAdmin = mockAdmin({ routeReports: burst, banks: [BANK_A, BANK_B] });

    const { rows } = await fetchTriageQueue(baseFilters({ dateFrom: rangeStart.toISOString(), dateTo: rangeEnd.toISOString() }), NOW);
    expect(rows.some((r) => r.signals.some((s) => s.signal === "new_reporter_high_volume" || s.signal === "velocity"))).toBe(true);
  });

  it("paginates: total reflects every match even when the requested page is empty", async () => {
    const burst = [0, 1, 2].map((i) =>
      routeReport({ id: `r-${i}`, user_id: "new-user", created_at: new Date(NOW.getTime() - i * 5 * 60_000).toISOString() })
    );
    currentAdmin = mockAdmin({ routeReports: burst, banks: [BANK_A, BANK_B] });

    const { rows, total } = await fetchTriageQueue(baseFilters({ page: 2 }), NOW);
    expect(total).toBe(3);
    expect(rows).toEqual([]);
  });
});
