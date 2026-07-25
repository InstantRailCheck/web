"use server";
import "server-only";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";
import { getUserModerationStatus } from "@/lib/moderationStatus";
import { logError } from "@/lib/logger";
import { buildRouteReportReceipt, type RouteReportReceipt } from "@/lib/receipts";
import type { RouteReportInput } from "@/lib/routeConfidence";

export type SubmitRouteReportInput = {
  fromBankId: string;
  toBankId: string;
  fromBankName: string;
  toBankName: string;
  railUsed: string;
  direction: string;
  status: string;
  testedAt: string;
  settlementTimeMinutes: number | null;
  sameDay: boolean | null;
  notes: string;
};

export type SubmitRouteReportResult = { success: true; receipt: RouteReportReceipt } | { error: string };

// Moved off a direct client-side RLS insert (v6.x) so route_reports
// insertion and cache invalidation can happen together, authenticated and
// rate-limited, in one place — see the "Cache invalidation" section of the
// v7.0.0 plan. route_requests_fulfill_on_report_trigger (a DB trigger on
// route_reports) fires on this insert regardless of which client performs
// it, so no application-level fulfillment logic is needed here.
export async function submitRouteReport(input: SubmitRouteReportInput): Promise<SubmitRouteReportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  // App-level check for a clear message — check_route_report_quota (the
  // DB trigger) is the actual backstop, since route_reports' RLS insert
  // policy is still directly reachable by a client that bypasses this
  // Server Action entirely.
  const moderationStatus = await getUserModerationStatus(admin, user.id);
  if (moderationStatus.blocked) return { error: moderationStatus.message };

  if (input.fromBankId === input.toBankId) {
    return { error: "Sender and receiver banks must be different." };
  }

  if (await isActionRateLimited("submitRouteReport", user.id, { userLimit: 20, ipLimit: 40, windowSeconds: 600 })) {
    return { error: "Too many route reports submitted recently. Please wait a few minutes and try again." };
  }

  // route_reports_derive_bank_names_trigger (the DB trigger) is the real
  // guard and rejects this unconditionally on INSERT — this is only a
  // clearer, faster message than the generic "Failed to submit report."
  // the raw trigger error would otherwise collapse into below.
  const { data: banksToCheck } = await admin
    .from("banks")
    .select("id, is_active")
    .in("id", [input.fromBankId, input.toBankId]);
  if (banksToCheck?.some((b) => !b.is_active)) {
    return { error: "One of the selected institutions is no longer listed and can't receive new reports." };
  }

  const routeReportsQuery = () =>
    admin
      .from("route_reports")
      .select("id, user_id, status, tested_at")
      .eq("from_bank_id", input.fromBankId)
      .eq("to_bank_id", input.toBankId)
      .eq("rail_used", input.railUsed);
  const toReportInput = (r: { user_id: string | null; status: string; tested_at: string }): RouteReportInput => ({
    userId: r.user_id,
    status: r.status as RouteReportInput["status"],
    testedAt: r.tested_at,
  });

  // Read before writing so a snapshot failure aborts cleanly — nothing has
  // been written yet, so it's safe to fail loudly here rather than risk a
  // receipt built on a silently-empty "no prior evidence" fallback (which
  // could falsely claim this is the route's first-ever report).
  const { data: beforeRows, error: beforeError } = await routeReportsQuery();
  if (beforeError) return { error: "Failed to submit report." };
  const preInsertReports = (beforeRows ?? []).map(toReportInput);

  const { data: newRow, error } = await admin
    .from("route_reports")
    .insert({
      from_bank_id: input.fromBankId,
      to_bank_id: input.toBankId,
      from_bank_name: input.fromBankName,
      to_bank_name: input.toBankName,
      rail_used: input.railUsed,
      direction: input.direction,
      status: input.status,
      tested_at: input.testedAt,
      settlement_time_minutes: input.settlementTimeMinutes,
      same_day: input.sameDay,
      notes: input.notes,
      user_id: user.id,
    })
    .select("id, created_at")
    .single();

  if (error || !newRow) return { error: "Failed to submit report." };

  const newReport: RouteReportInput = {
    userId: user.id,
    status: input.status as RouteReportInput["status"],
    testedAt: input.testedAt,
  };

  // Re-read AFTER the write (rather than reusing the pre-insert snapshot
  // plus this one known row) so a concurrent submitter's report for the
  // same route+rail — landing in between our own snapshot and insert — is
  // reflected too, instead of two simultaneous submissions each computing
  // "before + only me" and both claiming the same evidence-state crossing.
  // The write already committed by this point, so a failure here can only
  // degrade the receipt, never the submission itself — fall back to the
  // pre-insert snapshot (the old, still-correct-if-slightly-racier
  // behavior) rather than failing an already-successful report.
  const { data: afterRows, error: afterError } = await routeReportsQuery();
  const beforeReports: RouteReportInput[] = afterError
    ? preInsertReports
    : (afterRows ?? []).filter((r) => r.id !== newRow.id).map(toReportInput);
  if (afterError) {
    logError("Failed to re-fetch route_reports after insert; receipt may be based on a stale snapshot", {
      error: afterError.message,
    });
  }

  // fulfilled_by_report_id is set directly to this report's own id by
  // route_requests_fulfill_on_report_trigger (migration
  // 20260713060000_add_admin_moderation.sql) — an exact identifier, not an
  // inferred one, so this can never attribute another report's fulfillment
  // to this one regardless of timing.
  const { count, error: countError } = await admin
    .from("route_requests")
    .select("id", { count: "exact", head: true })
    .eq("fulfilled_by_report_id", newRow.id);
  if (countError) {
    logError("Failed to count fulfilled route_requests after insert; receipt will understate fulfillment", {
      error: countError.message,
    });
  }
  const fulfilledRequestCount = countError ? 0 : (count ?? 0);

  const receipt = buildRouteReportReceipt({
    beforeReports,
    newReport,
    fulfilledRequestCount,
  });

  // Same never-fail-the-write guarantee as requestRoute: the report is
  // already committed by this point, so a cache-layer failure here must
  // only ever be logged, never surfaced as a submission failure.
  try {
    updateTag("needs-fresh-reports");
  } catch (err) {
    logError("Failed to invalidate needs-fresh-reports cache after report fulfillment", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { success: true, receipt };
}
