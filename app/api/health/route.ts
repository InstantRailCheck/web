import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

// Must run fresh on every hit — an external uptime monitor polling this is
// the whole point, and Next.js would otherwise be free to statically
// optimize a route handler that takes no request-derived input.
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;

// Cadences come straight from .github/workflows/sync-data.yml: rail
// participants and the FDIC-scoped institution directory both run weekly
// (Sundays 09:00 UTC); NCUA data (institution-directory-full and its own
// reference log) runs monthly (1st of the month). Each threshold adds a
// buffer over the real interval so one slightly late run doesn't
// false-positive this into "degraded".
const WEEKLY_MAX_AGE_HOURS = 24 * 9; // ~9 days
const MONTHLY_MAX_AGE_HOURS = 24 * 40; // ~40 days

type CheckResult = {
  ok: boolean;
  detail: string;
  lastSyncedAt: string | null;
  ageHours: number | null;
};

function ageCheck(label: string, timestamp: string | null | undefined, maxAgeHours: number): CheckResult {
  if (!timestamp) {
    return { ok: false, detail: `${label}: no successful sync recorded`, lastSyncedAt: null, ageHours: null };
  }
  const ageHours = (Date.now() - new Date(timestamp).getTime()) / HOUR_MS;
  const ok = ageHours <= maxAgeHours;
  return {
    ok,
    detail: ok
      ? `${label}: last synced ${ageHours.toFixed(1)}h ago`
      : `${label}: stale — last synced ${ageHours.toFixed(1)}h ago (expected within ${maxAgeHours}h)`,
    lastSyncedAt: timestamp,
    ageHours: Math.round(ageHours * 10) / 10,
  };
}

// Institution directory sync ships staged-only (PROJECT.md: "no --apply
// wired into CI yet") — applying a staged run to `banks` is a deliberate,
// unscheduled human review step, so gating this on sync_runs.status='applied'
// would report "stale" essentially forever regardless of whether the
// automated pipeline is healthy. What CI actually guarantees on a schedule is
// a fresh *staged* run, so freshness is measured from the latest run's
// started_at (any status) instead — a real failure is still surfaced via its
// status, just independently of how long ago someone last ran --apply.
const UNHEALTHY_SYNC_RUN_STATUSES = new Set(["failed", "guard_blocked"]);

function institutionDirectorySyncCheck(
  run: { started_at: string; status: string } | null | undefined
): CheckResult {
  if (!run) {
    return { ok: false, detail: "institutionDirectorySync: no sync run recorded", lastSyncedAt: null, ageHours: null };
  }
  const ageHours = (Date.now() - new Date(run.started_at).getTime()) / HOUR_MS;
  const fresh = ageHours <= WEEKLY_MAX_AGE_HOURS;
  const healthyStatus = !UNHEALTHY_SYNC_RUN_STATUSES.has(run.status);
  const ok = fresh && healthyStatus;
  let detail = `institutionDirectorySync: last run ${ageHours.toFixed(1)}h ago, status "${run.status}"`;
  if (!fresh) detail += ` (expected a run within ${WEEKLY_MAX_AGE_HOURS}h)`;
  if (!healthyStatus) detail += " — run requires attention";
  return { ok, detail, lastSyncedAt: run.started_at, ageHours: Math.round(ageHours * 10) / 10 };
}

export async function GET() {
  const admin = createAdminClient();
  const startedAt = Date.now();

  const [
    { error: bankError },
    { data: latestSyncRun },
    { data: fednowRow },
    { data: rtpRow },
    { data: zelleRow },
    { data: ncuaLog },
  ] = await Promise.all([
    admin.from("banks").select("id", { count: "exact", head: true }),
    admin
      .from("sync_runs")
      .select("started_at, status")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("fednow_participants").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("rtp_participants").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("zelle_participants").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("ncua_reference_sync_log").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (bankError) {
    logError("health check: database probe failed", { error: bankError.message });
  }

  const checks = {
    database: {
      ok: !bankError,
      detail: bankError ? `database: query failed — ${bankError.message}` : `database: reachable (${Date.now() - startedAt}ms)`,
    },
    institutionDirectorySync: institutionDirectorySyncCheck(latestSyncRun),
    fednowSync: ageCheck("fednowSync", fednowRow?.updated_at, WEEKLY_MAX_AGE_HOURS),
    rtpSync: ageCheck("rtpSync", rtpRow?.updated_at, WEEKLY_MAX_AGE_HOURS),
    zelleSync: ageCheck("zelleSync", zelleRow?.updated_at, WEEKLY_MAX_AGE_HOURS),
    ncuaDirectorySync: ageCheck("ncuaDirectorySync", ncuaLog?.synced_at, MONTHLY_MAX_AGE_HOURS),
  };

  const allOk = Object.values(checks).every((check) => check.ok);

  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    {
      status: allOk ? 200 : 503,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
    }
  );
}
