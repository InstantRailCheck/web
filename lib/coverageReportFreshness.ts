import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { fetchAllBanks } from "@/lib/allBanks";
import { computeCoverageReport, type CoverageBankRow, type CoverageReport } from "@/lib/coverageReport";

export type CoverageFreshness = {
  // Kept separate rather than collapsed into one "directory" date — a fresh
  // weekly fdic-scope run would otherwise mask NCUA data that's only ever
  // touched by the monthly 'both'-scope run (fdicDirectoryAsOf legitimately
  // considers both scopes, since 'both' refreshes FDIC banks too;
  // ncuaDirectoryAsOf can only ever come from 'both').
  fdicDirectoryAsOf: string | null;
  ncuaDirectoryAsOf: string | null;
  // Marks when each raw source list was downloaded into
  // fednow_participants/rtp_participants/zelle_participants — NOT when
  // banks.fednow_participant/etc. were last backfilled from them.
  // backfill-rail-participation.mjs logs nothing to the database about its
  // own runs, so that step's completion time genuinely isn't knowable yet.
  // Deliberately not called "coverage last verified" anywhere this is
  // displayed — see PROJECT.md v10.0.0 notes. Kept as three separate dates
  // (not one collapsed "rail" date) for the same reason as the directory
  // split above: one freshly-downloaded rail shouldn't visually mask two
  // stale ones.
  fednowListDownloadedAt: string | null;
  rtpListDownloadedAt: string | null;
  zelleListDownloadedAt: string | null;
};

type SyncRunRow = { finished_at: string | null };
type ParticipantRow = { updated_at: string };

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

// sync_runs has RLS enabled with only a service_role grant (no anon/
// authenticated policy) — the regular request-scoped client wouldn't error
// here, it would silently return zero rows. createAdminClient() is required,
// not optional, for this query to mean anything.
async function latestAppliedFinishedAt(
  supabase: SupabaseClient,
  sourceScope: "fdic" | "both"
): Promise<string | null> {
  const { data, error } = await supabase
    .from("sync_runs")
    .select("finished_at")
    .eq("source_scope", sourceScope)
    .eq("status", "applied")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`sync_runs query failed (source_scope=${sourceScope}): ${error.message}`);
  return (data as SyncRunRow | null)?.finished_at ?? null;
}

async function latestParticipantUpdatedAt(
  supabase: SupabaseClient,
  table: "fednow_participants" | "rtp_participants" | "zelle_participants"
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return (data as ParticipantRow | null)?.updated_at ?? null;
}

async function fetchCoverageFreshness(): Promise<CoverageFreshness> {
  const supabase = createAdminClient();
  const [fdicAppliedAt, bothAppliedAt, fednowAt, rtpAt, zelleAt] = await Promise.all([
    latestAppliedFinishedAt(supabase, "fdic"),
    latestAppliedFinishedAt(supabase, "both"),
    latestParticipantUpdatedAt(supabase, "fednow_participants"),
    latestParticipantUpdatedAt(supabase, "rtp_participants"),
    latestParticipantUpdatedAt(supabase, "zelle_participants"),
  ]);

  return {
    fdicDirectoryAsOf: maxDate(fdicAppliedAt, bothAppliedAt),
    ncuaDirectoryAsOf: bothAppliedAt,
    fednowListDownloadedAt: fednowAt,
    rtpListDownloadedAt: rtpAt,
    zelleListDownloadedAt: zelleAt,
  };
}

// A real DB error must never collapse into `null` — that's indistinguishable
// from the genuine "no applied run has ever happened" case. Log and rethrow,
// matching lib/needsFreshReports.ts's getRoutesNeedingFreshReportsLogged: a
// failed background revalidation then can't poison the cache with an error,
// Next just keeps serving the last successful value and retries later.
export async function fetchCoverageFreshnessLogged(): Promise<CoverageFreshness> {
  try {
    return await fetchCoverageFreshness();
  } catch (err) {
    logError("Failed to compute coverage report freshness", {
      route: "/research/instant-payments",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// 4h, not 1h — unlike needs-fresh-reports (which reacts to live report
// submissions), this data only changes on a weekly/monthly sync cadence, and
// nothing calls updateTag() for it, so there's no reason to revalidate more
// eagerly than that.
//
// If this appears to return stale/empty data while running `npm run dev`,
// that's a known unstable_cache + Turbopack dev-mode quirk, not a real bug —
// confirmed by testing fetchCoverageFreshnessLogged() directly (correct
// every time) versus this wrapped export (intermittently stale under dev).
// A real `npm run build && npm run start` returns correct data every time.
export const getCachedCoverageFreshness = unstable_cache(
  fetchCoverageFreshnessLogged,
  ["coverage-freshness-v1"],
  { revalidate: 14400 }
);

async function fetchCoverageReportData(): Promise<CoverageReport> {
  const supabase = createAdminClient();
  const banks = await fetchAllBanks<CoverageBankRow>(
    supabase,
    "is_active, source_authority, state, total_assets, fednow_participant, rtp_participant, zelle_participant"
  );
  return computeCoverageReport(banks);
}

export async function fetchCoverageReportLogged(): Promise<CoverageReport> {
  try {
    return await fetchCoverageReportData();
  } catch (err) {
    logError("Failed to build coverage report", {
      route: "/research/instant-payments",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export const getCachedCoverageReport = unstable_cache(
  fetchCoverageReportLogged,
  ["coverage-report-v1"],
  { revalidate: 14400 }
);
