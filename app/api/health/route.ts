import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
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

const UNAUTHORIZED_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.HEALTH_CHECK_TOKEN;
  if (!expected) return false; // fail closed if the token isn't configured yet

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided) return false;

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, so the length check has to happen first.
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

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
// unscheduled human review step, so gating this on status='applied' would
// report stale almost permanently regardless of whether the automated
// staging pipeline is healthy. 'staged' and 'applied' are the only statuses
// that mean "the pipeline did its job" — everything else (a run stuck in
// 'running'/'applying', 'failed', 'guard_blocked', or an 'expired' staged
// run that was never applied in time) means it needs attention, so this is
// an allowlist rather than a blocklist: an unrecognized/incomplete status
// defaults to unhealthy, not the other way around.
const HEALTHY_SYNC_RUN_STATUSES = new Set(["staged", "applied"]);

type SyncRunRow = { started_at: string; status: string };

// fdic (weekly) and both (monthly, covers NCUA) are tracked as two
// independent checks rather than "the single latest run regardless of
// scope" — the weekly FDIC-only run is always more recent than the monthly
// full run, so a combined check would let a broken/stuck monthly NCUA sync
// hide behind the next successful weekly FDIC run indefinitely.
function directorySyncCheck(label: string, run: SyncRunRow | null | undefined, maxAgeHours: number): CheckResult {
  if (!run) {
    return { ok: false, detail: `${label}: no sync run recorded`, lastSyncedAt: null, ageHours: null };
  }
  const ageHours = (Date.now() - new Date(run.started_at).getTime()) / HOUR_MS;
  const fresh = ageHours <= maxAgeHours;
  const healthyStatus = HEALTHY_SYNC_RUN_STATUSES.has(run.status);
  const ok = fresh && healthyStatus;
  let detail = `${label}: last run ${ageHours.toFixed(1)}h ago, status "${run.status}"`;
  if (!fresh) detail += ` (expected a run within ${maxAgeHours}h)`;
  if (!healthyStatus) detail += " — run requires attention";
  return { ok, detail, lastSyncedAt: run.started_at, ageHours: Math.round(ageHours * 10) / 10 };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: UNAUTHORIZED_HEADERS });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();

  const [
    { error: bankError },
    { data: latestFdicRun },
    { data: latestFullRun },
    { data: fednowRow },
    { data: rtpRow },
    { data: zelleRow },
    { data: ncuaLog },
  ] = await Promise.all([
    admin.from("banks").select("id", { count: "exact", head: true }),
    admin
      .from("sync_runs")
      .select("started_at, status")
      .eq("source_scope", "fdic")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("sync_runs")
      .select("started_at, status")
      .eq("source_scope", "both")
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
      // Deliberately generic in the public response — the real message
      // goes to logError above so it's visible in Vercel's log viewer
      // without handing an unauthenticated (well, token-gated, but still
      // externally-facing) caller raw Postgres error text.
      detail: bankError ? "database: query failed" : `database: reachable (${Date.now() - startedAt}ms)`,
    },
    fdicDirectorySync: directorySyncCheck("fdicDirectorySync", latestFdicRun, WEEKLY_MAX_AGE_HOURS),
    fullDirectorySync: directorySyncCheck("fullDirectorySync", latestFullRun, MONTHLY_MAX_AGE_HOURS),
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
