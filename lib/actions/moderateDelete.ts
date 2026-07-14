"use server";
import "server-only";

import { updateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

export const MODERATION_TARGET_TABLES = ["route_reports", "edd_reports", "route_requests"] as const;
export type ModerationTargetTable = (typeof MODERATION_TARGET_TABLES)[number];

export const MODERATION_REASON_CATEGORIES = ["spam", "fabricated", "duplicate", "privacy", "other"] as const;
export type ModerationReasonCategory = (typeof MODERATION_REASON_CATEGORIES)[number];

export type ModerateDeleteResult = { success: true } | { error: string };

// The only write path for removing a route_reports/edd_reports/
// route_requests row — everything else about these tables' RLS is zero
// client-facing SELECT/UPDATE/DELETE policies, so a dashboard edit was
// previously the only option, bypassing rate limiting, authorization,
// auditing, and cache invalidation entirely. requireAdmin() is checked here
// independently of the admin page's own check — never relying on one to
// protect the other.
export async function moderateDelete(
  targetTable: ModerationTargetTable,
  targetId: string,
  reason: string,
  reasonCategory: ModerationReasonCategory
): Promise<ModerateDeleteResult> {
  const admin_ = await requireAdmin();
  if (!admin_) return { error: "Unauthorized." };
  if (!MODERATION_TARGET_TABLES.includes(targetTable)) return { error: "Invalid target." };
  if (!MODERATION_REASON_CATEGORIES.includes(reasonCategory)) return { error: "Invalid reason category." };

  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 500) {
    return { error: "A reason (1-500 characters) is required." };
  }

  // Generous relative to requestRoute/submitRouteReport's limits — this is
  // an authenticated-admin surface, not public-abuse-prone, so the limit is
  // a backstop against a stuck client retry-looping, not a real threat
  // model concern.
  if (
    await isActionRateLimited("moderateDelete", admin_.id, { userLimit: 60, ipLimit: 60, windowSeconds: 600 })
  ) {
    return { error: "Too many moderation actions recently. Please wait a few minutes." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("moderate_delete_submission", {
    p_target_table: targetTable,
    p_target_id: targetId,
    p_moderator_id: admin_.id,
    p_reason: trimmedReason,
    p_reason_category: reasonCategory,
  });

  // P0002 is the not_found errcode moderate_delete_submission raises when
  // the row is already gone (double click, or a second admin) — the
  // function's own SELECT ... INTO check makes this idempotent: no second,
  // contradictory audit row is ever created.
  if (error?.code === "P0002") return { error: "This submission was already removed." };
  if (error) {
    logError("moderateDelete RPC failed", { error: error.message, targetTable, targetId });
    return { error: "Failed to remove submission." };
  }

  // edd_reports has no unstable_cache in front of any of its consumers
  // (app/banks/page.tsx's EDD filter, lib/bankProfile.ts's EDD evidence are
  // both already force-dynamic/admin-client-fresh) — only route_reports and
  // route_requests feed /routes/needs-fresh-reports, the one page wrapped
  // in unstable_cache.
  if (targetTable === "route_reports" || targetTable === "route_requests") {
    try {
      updateTag("needs-fresh-reports");
    } catch (err) {
      logError("Failed to invalidate needs-fresh-reports cache after moderation delete", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { success: true };
}
