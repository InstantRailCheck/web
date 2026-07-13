"use server";
import "server-only";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

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

export type SubmitRouteReportResult = { success: true } | { error: string };

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
  if (input.fromBankId === input.toBankId) {
    return { error: "Sender and receiver banks must be different." };
  }

  if (await isActionRateLimited("submitRouteReport", user.id, { userLimit: 20, ipLimit: 40, windowSeconds: 600 })) {
    return { error: "Too many route reports submitted recently. Please wait a few minutes and try again." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("route_reports").insert({
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
  });

  if (error) return { error: "Failed to submit report." };

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

  return { success: true };
}
