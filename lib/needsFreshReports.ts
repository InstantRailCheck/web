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

type BankRow = { id: string; slug: string; name: string };

export type NeedsFreshReportReason = "no_evidence" | "stale" | "limited_evidence";

export type NeedsFreshReportRoute = {
  fromBankId: string;
  fromBankSlug: string;
  fromBankName: string;
  toBankId: string;
  toBankSlug: string;
  toBankName: string;
  reason: NeedsFreshReportReason;
  // Absent for no_evidence (nothing attributable was ever observed);
  // otherwise the date driving this route's position in the ranking — see
  // representativeDate() below for which rails it's drawn from.
  lastObservationDate: string | null;
};

export const REASON_LABELS: Record<NeedsFreshReportReason, string> = {
  no_evidence: NO_EVIDENCE_LABEL,
  stale: "Evidence is over 180 days old",
  limited_evidence: "Only one report — needs a second confirmation",
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
  if (reason === "no_evidence") return null;
  if (reason === "stale") {
    const dates = present.filter((e) => e.state === "previously_observed").map((e) => e.latestObservationDate);
    return dates.reduce((max, d) => (d > max ? d : max));
  }
  const dates = present.filter((e) => e.state === "limited_evidence").map((e) => e.latestObservationDate);
  return dates.reduce((min, d) => (d < min ? d : min));
}

const REASON_WEIGHT: Record<NeedsFreshReportReason, number> = {
  no_evidence: 0,
  stale: 1,
  limited_evidence: 2,
};

// Deterministic: reason severity first, then how overdue (oldest/most-
// overdue first within a group), then bank names as a final tiebreak — never
// relies on Map/object iteration order.
export function compareRoutes(a: NeedsFreshReportRoute, b: NeedsFreshReportRoute): number {
  const weightDiff = REASON_WEIGHT[a.reason] - REASON_WEIGHT[b.reason];
  if (weightDiff !== 0) return weightDiff;

  if (a.lastObservationDate !== b.lastObservationDate) {
    if (a.lastObservationDate === null) return 1;
    if (b.lastObservationDate === null) return -1;
    return a.lastObservationDate < b.lastObservationDate ? -1 : 1;
  }

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

  const routes: NeedsFreshReportRoute[] = [];

  for (const [, rows] of pairGroups) {
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
    });
  }

  return routes.sort(compareRoutes);
}

// The DB round trip: fetches route_reports (fully, paginated) and the
// distinct banks it references, then hands off to the pure aggregation
// above. One `now` is captured here and threaded through every
// computeRouteEvidence call in the run, so every rail of every pair is
// judged against the same instant.
export async function getRoutesNeedingFreshReports(): Promise<NeedsFreshReportRoute[]> {
  const supabase = createAdminClient();
  const now = new Date();

  const reportRows = await fetchAllRouteReports(supabase);
  const bankIds = [
    ...new Set(reportRows.flatMap((r) => [r.from_bank_id, r.to_bank_id]).filter((id): id is string => !!id)),
  ];
  const banks = await fetchBanksByIds(supabase, bankIds);

  return buildNeedsFreshReportRoutes(reportRows, banks, now);
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
export const getCachedRoutesNeedingFreshReports = unstable_cache(
  getRoutesNeedingFreshReportsLogged,
  ["needs-fresh-reports-v1"],
  { revalidate: 3600 }
);
