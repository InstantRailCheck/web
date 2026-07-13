import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { unstable_cache } from "next/cache";
import { logError } from "@/lib/logger";
import {
  computeRouteEvidence,
  NO_EVIDENCE_LABEL,
  type RouteEvidence,
  type RouteReportInput,
} from "@/lib/routeConfidence";

type RouteReportRow = {
  from_bank_id: string | null;
  to_bank_id: string | null;
  rail_used: string | null;
  status: string;
  tested_at: string | null;
  user_id: string | null;
};

// Only active (fulfilled_at is null) rows are ever fetched — see
// fetchAllRouteRequests below.
type RouteRequestRow = {
  from_bank_id: string;
  to_bank_id: string;
  user_id: string | null;
};

type BankRow = { id: string; slug: string; name: string };

export type NeedsFreshReportReason = "no_evidence" | "stale" | "limited_evidence" | "requested_only";

export type NeedsFreshReportRoute = {
  fromBankId: string;
  fromBankSlug: string;
  fromBankName: string;
  toBankId: string;
  toBankSlug: string;
  toBankName: string;
  reason: NeedsFreshReportReason;
  // Absent for no_evidence/requested_only (nothing attributable was ever
  // observed); otherwise the date driving this route's position in the
  // ranking — see representativeDate() below for which rails it's drawn
  // from.
  lastObservationDate: string | null;
  // Count of distinct active (unfulfilled) route_requests rows for this
  // pair — 0 if none. A demand signal, not evidence: see compareRoutes for
  // how it's used as a tiebreaker only, never a severity override.
  requestCount: number;
};

// limited_evidence means every present rail individually has exactly one
// fresh reporter (per computeRouteEvidence) — not that the pair as a whole
// has exactly one report. A pair with two weak rails (e.g. ACH and RTP),
// each confirmed by a different single reporter, is still classified
// limited_evidence but has two distinct reports, so the label can't claim
// a specific count.
export const REASON_LABELS: Record<NeedsFreshReportReason, string> = {
  no_evidence: NO_EVIDENCE_LABEL,
  stale: "Evidence is over 180 days old",
  limited_evidence: "Limited evidence — needs another confirmation",
  // Zero rows in route_reports at all — never appears in pairGroups below.
  // Never implies evidence exists; the count itself is composed separately
  // by callers (see ReasonLine in app/routes/needs-fresh-reports/page.tsx).
  requested_only: "Requested by the community — no reports yet",
};

// Mirrors lib/allBanks.ts's fetchAllBanks — same 1000-row PostgREST default
// that already truncated `banks` once. Ordered by `id` (route_reports' PK)
// purely for a stable, deterministic .range() cursor; the ordering itself
// carries no meaning downstream. A page shorter than pageSize is the one
// reliable "that was the last page" signal — this table is written to
// rarely enough (report submissions only) that a row landing/leaving mid-
// pagination is not a practical concern.
//
// A hard cap of 500 pages (500k rows) is a circuit breaker against a
// runaway loop bug, not a truncation mechanism: hitting it throws instead
// of returning a partial result, because a silently-partial fetch here
// would corrupt classification (a pair's real evidence could be split
// across rows on both sides of a missing cutoff), not just trim the list.
export async function fetchAllRouteReports(
  supabase: ReturnType<typeof createAdminClient>
): Promise<RouteReportRow[]> {
  const pageSize = 1000;
  const rows: RouteReportRow[] = [];
  for (let page = 0; ; page++) {
    if (page >= 500) throw new Error("route_reports fetch exceeded 500 pages — refusing partial data");
    const offset = page * pageSize;
    const { data, error } = await supabase
      .from("route_reports")
      .select("from_bank_id, to_bank_id, rail_used, status, tested_at, user_id")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RouteReportRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// Byte-for-byte the same paginated-fetch shape as fetchAllRouteReports —
// same 1000-row-page/500-page-circuit-breaker justification: this table
// only grows with real user activity, never combinatorially with bank
// count. Only fulfilled_at is null (active) rows are selected at the query
// itself — fulfilled requests are invisible to requestCount/requested_only
// classification, same as route_reports' own user_id IS NULL seed rows are
// invisible to evidence.
export async function fetchAllRouteRequests(
  supabase: ReturnType<typeof createAdminClient>
): Promise<RouteRequestRow[]> {
  const pageSize = 1000;
  const rows: RouteRequestRow[] = [];
  for (let page = 0; ; page++) {
    if (page >= 500) throw new Error("route_requests fetch exceeded 500 pages — refusing partial data");
    const offset = page * pageSize;
    const { data, error } = await supabase
      .from("route_requests")
      .select("from_bank_id, to_bank_id, user_id")
      .is("fulfilled_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RouteRequestRow[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// Deliberately not fetchAllBanks() — that helper orders by `name`, which
// isn't unique, so .range()-based offset pagination against it can skip or
// duplicate rows at a page boundary shared by several same-named banks.
// Fine for fetchAllBanks's existing callers (they consume the whole table
// and don't depend on exact boundary behavior), not something to build new
// correctness-sensitive logic on. Only the handful of bank ids actually
// referenced by route_reports are needed here, so an exact-match .in() over
// bounded chunks sidesteps the ordering question entirely — no pagination
// loop required per chunk.
export async function fetchBanksByIds(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[]
): Promise<BankRow[]> {
  const chunkSize = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase.from("banks").select("id, slug, name").in("id", chunk);
      if (error) throw error;
      return (data ?? []) as BankRow[];
    })
  );
  return results.flat();
}

// A pair's evidence is judged rail by rail (RTP/ACH/Wire/etc. can each be in
// a different state), then rolled up here into one reason for the whole
// pair. "sufficient" means at least one rail already has real, non-
// borderline evidence — that pair is excluded from the list entirely, even
// if another rail on it is weak, mirroring the same all-or-nothing
// intuition components/HomeRouteChecker.tsx's isStaleOnly CTA uses (both
// independently call computeRouteEvidence; neither reimplements the other).
export function classifyRoute(railEvidences: (RouteEvidence | null)[]): NeedsFreshReportReason | "sufficient" {
  const present = railEvidences.filter((e): e is RouteEvidence => e !== null);
  if (present.length === 0) return "no_evidence";
  const hasStrongRail = present.some(
    (e) => e.state !== "previously_observed" && e.state !== "limited_evidence"
  );
  if (hasStrongRail) return "sufficient";
  return present.some((e) => e.state === "previously_observed") ? "stale" : "limited_evidence";
}

// The date that drives a route's position in the ranking (see
// compareRoutes below) — not just a display value. `stale` uses the
// freshest of its previously_observed rails (the best-case last known good
// signal); `limited_evidence` uses the oldest of its limited_evidence rails
// (the one closest to falling off the 180-day cliff). `no_evidence` has no
// attributable observation at all.
export function representativeDate(
  reason: NeedsFreshReportReason,
  present: RouteEvidence[]
): string | null {
  if (reason === "no_evidence" || reason === "requested_only") return null;
  if (reason === "stale") {
    const dates = present.filter((e) => e.state === "previously_observed").map((e) => e.latestObservationDate);
    return dates.reduce((max, d) => (d > max ? d : max));
  }
  const dates = present.filter((e) => e.state === "limited_evidence").map((e) => e.latestObservationDate);
  return dates.reduce((min, d) => (d < min ? d : min));
}

const REASON_WEIGHT: Record<NeedsFreshReportReason, number> = {
  no_evidence: 0,
  requested_only: 0, // same severity tier as no_evidence: "nothing usable exists yet"
  stale: 1,
  limited_evidence: 2,
};

// Deterministic: reason severity first, then how overdue (oldest/most-
// overdue first within a group), then request demand as a tiebreaker
// (never a severity override — see below), then bank names as a final
// tiebreak — never relies on Map/object iteration order.
export function compareRoutes(a: NeedsFreshReportRoute, b: NeedsFreshReportRoute): number {
  const weightDiff = REASON_WEIGHT[a.reason] - REASON_WEIGHT[b.reason];
  if (weightDiff !== 0) return weightDiff;

  if (a.lastObservationDate !== b.lastObservationDate) {
    if (a.lastObservationDate === null) return 1;
    if (b.lastObservationDate === null) return -1;
    return a.lastObservationDate < b.lastObservationDate ? -1 : 1;
  }

  // Deliberately after the date tiebreak, not before: demand must never
  // let a route reorder ahead of another on staleness grounds — it only
  // ever breaks a true tie (in practice, almost every no_evidence/
  // requested_only pair, since both have no observation date at all).
  if (a.requestCount !== b.requestCount) return b.requestCount - a.requestCount; // higher demand first

  if (a.fromBankName !== b.fromBankName) return a.fromBankName < b.fromBankName ? -1 : 1;
  if (a.toBankName !== b.toBankName) return a.toBankName < b.toBankName ? -1 : 1;
  return 0;
}

function toReportInputs(rows: RouteReportRow[]): RouteReportInput[] {
  return rows
    .filter((r): r is RouteReportRow & { tested_at: string; status: RouteReportInput["status"] } =>
      !!r.tested_at && (r.status === "success" || r.status === "failed" || r.status === "delayed")
    )
    .map((r) => ({ userId: r.user_id, status: r.status, testedAt: r.tested_at }));
}

// Pure aggregation over already-fetched rows — split out from the DB round
// trips above so classification/ranking can be unit tested with plain
// fixtures, no Supabase mocking required.
export function buildNeedsFreshReportRoutes(
  reportRows: RouteReportRow[],
  requestRows: RouteRequestRow[],
  banks: BankRow[],
  now: Date
): NeedsFreshReportRoute[] {
  const bankById = new Map(banks.map((b) => [b.id, b]));

  const pairGroups = new Map<string, RouteReportRow[]>();
  for (const row of reportRows) {
    if (!row.from_bank_id || !row.to_bank_id) continue;
    const key = `${row.from_bank_id}::${row.to_bank_id}`;
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key)!.push(row);
  }

  // requestRows is already filtered to active (fulfilled_at is null) rows
  // by fetchAllRouteRequests — every row here counts toward demand,
  // including anonymized (user_id null) ones, same "trusted, uncounted-for-
  // abuse" treatment route_reports gives its own user_id IS NULL rows.
  const requestCounts = new Map<string, number>();
  for (const row of requestRows) {
    const key = `${row.from_bank_id}::${row.to_bank_id}`;
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  }

  const routes: NeedsFreshReportRoute[] = [];

  for (const [key, rows] of pairGroups) {
    const fromBank = bankById.get(rows[0].from_bank_id!);
    const toBank = bankById.get(rows[0].to_bank_id!);
    // "Blank over wrong": a pair referencing a since-deleted bank is dropped
    // rather than shown with a missing name.
    if (!fromBank || !toBank) continue;

    const railGroups = new Map<string, RouteReportRow[]>();
    for (const row of rows) {
      const rail = row.rail_used || "unknown";
      if (!railGroups.has(rail)) railGroups.set(rail, []);
      railGroups.get(rail)!.push(row);
    }

    const railEvidences: (RouteEvidence | null)[] = [...railGroups.values()].map((railRows) =>
      computeRouteEvidence(toReportInputs(railRows), now)
    );

    const reason = classifyRoute(railEvidences);
    if (reason === "sufficient") continue;

    const present = railEvidences.filter((e): e is RouteEvidence => e !== null);

    routes.push({
      fromBankId: fromBank.id,
      fromBankSlug: fromBank.slug,
      fromBankName: fromBank.name,
      toBankId: toBank.id,
      toBankSlug: toBank.slug,
      toBankName: toBank.name,
      reason,
      lastObservationDate: representativeDate(reason, present),
      requestCount: requestCounts.get(key) ?? 0,
    });
  }

  // requested_only: pairs with zero rows in route_reports at all (never
  // appear in pairGroups above) but at least one active request — the fix
  // for the blind spot described in the module comment. A pair present in
  // pairGroups is always classified via classifyRoute above regardless of
  // its request count; this only covers pairs classifyRoute never sees.
  for (const [key, count] of requestCounts) {
    if (pairGroups.has(key)) continue;
    const [fromBankId, toBankId] = key.split("::");
    const fromBank = bankById.get(fromBankId);
    const toBank = bankById.get(toBankId);
    if (!fromBank || !toBank) continue;

    routes.push({
      fromBankId: fromBank.id,
      fromBankSlug: fromBank.slug,
      fromBankName: fromBank.name,
      toBankId: toBank.id,
      toBankSlug: toBank.slug,
      toBankName: toBank.name,
      reason: "requested_only",
      lastObservationDate: null,
      requestCount: count,
    });
  }

  return routes.sort(compareRoutes);
}

// True only when routes exist overall but this specific page number is
// past the end of them — distinguishes "nothing needs a fresh report at
// all" from "you asked for a page that doesn't exist," which otherwise
// render as the same false "everything's fine" empty state.
export function isPageOutOfRange(page: number, total: number, pageSize: number): boolean {
  if (total === 0) return false;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return page > totalPages;
}

// The DB round trip: fetches route_reports and route_requests (both fully,
// paginated) and the distinct banks either one references, then hands off
// to the pure aggregation above. One `now` is captured here and threaded
// through every computeRouteEvidence call in the run, so every rail of
// every pair is judged against the same instant.
export async function getRoutesNeedingFreshReports(): Promise<NeedsFreshReportRoute[]> {
  const supabase = createAdminClient();
  const now = new Date();

  const [reportRows, requestRows] = await Promise.all([
    fetchAllRouteReports(supabase),
    fetchAllRouteRequests(supabase),
  ]);
  const reportBankIds = reportRows.flatMap((r) => [r.from_bank_id, r.to_bank_id]);
  const requestBankIds = requestRows.flatMap((r) => [r.from_bank_id, r.to_bank_id]);
  const bankIds = [...new Set([...reportBankIds, ...requestBankIds].filter((id): id is string => !!id))];
  const banks = await fetchBanksByIds(supabase, bankIds);

  return buildNeedsFreshReportRoutes(reportRows, requestRows, banks, now);
}

// Exported (not just used inline below) so the log-then-rethrow behavior is
// directly testable without invoking unstable_cache itself, which throws
// when called outside a real Next.js request context (e.g. under vitest).
export async function getRoutesNeedingFreshReportsLogged(): Promise<NeedsFreshReportRoute[]> {
  try {
    return await getRoutesNeedingFreshReports();
  } catch (err) {
    logError("Failed to build needs-fresh-reports list", {
      route: "/routes/needs-fresh-reports",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// Wrapped in unstable_cache, not a route-level `revalidate` export: the page
// reads searchParams (for its ?page= param), which opts the segment into
// dynamic rendering regardless of any route-segment cache config, so
// `export const revalidate` would be a silent no-op there. Caching the
// query-independent aggregation itself (instead) means the expensive
// full-table fetch + classify + rank runs at most once an hour no matter how
// many different ?page= values are requested in between; page-number
// parsing and slicing happen per-request, outside this cache, in the page.
//
// Failure handling follows the Data Cache's stale-while-revalidate model:
// getRoutesNeedingFreshReportsLogged logs and rethrows rather than
// swallowing, so a failed background revalidation never gets cached as a
// result — Next keeps serving the last successful value and retries later.
// The one case with nothing to fall back to is the very first call ever
// (a true cache miss); app/routes/needs-fresh-reports/error.tsx handles that.
//
// tags: ["needs-fresh-reports"] lets requestRoute (lib/actions/
// requestRoute.ts) and submitRouteReport (lib/actions/submitRouteReport.ts)
// call updateTag("needs-fresh-reports") right after a real write, so a new
// request or a report that fulfills one shows up immediately instead of
// waiting on the hourly revalidate.
export const getCachedRoutesNeedingFreshReports = unstable_cache(
  getRoutesNeedingFreshReportsLogged,
  ["needs-fresh-reports-v1"],
  { revalidate: 3600, tags: ["needs-fresh-reports"] }
);
