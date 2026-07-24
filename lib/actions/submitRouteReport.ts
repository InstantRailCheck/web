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

  // Snapshotted just before the write so the receipt can report exactly
  // what THIS submission changed, holding everything else fixed — a
  // concurrent submitter's report landing around the same time doesn't
  // bias this, since it simply isn't part of either snapshot. See
  // lib/receipts.ts for why this is the honest, non-overclaiming framing.
  const [{ data: beforeRows }, { data: openRequests }] = await Promise.all([
    admin
      .from("route_reports")
      .select("user_id, status, tested_at")
      .eq("from_bank_id", input.fromBankId)
      .eq("to_bank_id", input.toBankId)
      .eq("rail_used", input.railUsed),
    admin
      .from("route_requests")
      .select("id")
      .eq("from_bank_id", input.fromBankId)
      .eq("to_bank_id", input.toBankId)
      .is("fulfilled_at", null),
  ]);
  const beforeReports: RouteReportInput[] = (beforeRows ?? []).map((r) => ({
    userId: r.user_id,
    status: r.status as RouteReportInput["status"],
    testedAt: r.tested_at,
  }));
  const openRequestIds = (openRequests ?? []).map((r) => r.id);

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

  // check_route_report_quota (a BEFORE INSERT trigger) forces
  // new.created_at := now() unconditionally, in the same transaction that
  // route_requests_fulfill_on_report_trigger (AFTER INSERT) later sets
  // fulfilled_at = now() for every request this report just fulfilled —
  // both values come from the same transaction's now(), so they're
  // bit-for-bit identical here and differ from any other transaction's.
  // Matching on that exact timestamp is what lets a "losing" concurrent
  // submitter's receipt correctly show 0 fulfilled requests instead of
  // double-claiming credit for ones a different report actually fulfilled.
  let fulfilledRequestCount = 0;
  if (openRequestIds.length > 0) {
    const { count } = await admin
      .from("route_requests")
      .select("id", { count: "exact", head: true })
      .in("id", openRequestIds)
      .eq("fulfilled_at", newRow.created_at);
    fulfilledRequestCount = count ?? 0;
  }

  const receipt = buildRouteReportReceipt({
    beforeReports,
    newReport: {
      userId: user.id,
      status: input.status as RouteReportInput["status"],
      testedAt: input.testedAt,
    },
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
