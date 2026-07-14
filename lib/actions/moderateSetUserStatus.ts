"use server";
import "server-only";

import { requireAdmin, isAdminUser } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";
import { reconcileAuthSync, USER_STATUS_VALUES, type UserStatusValue } from "@/lib/authSync";
import { logError } from "@/lib/logger";

export { USER_STATUS_VALUES };
export type { UserStatusValue };

export const USER_STATUS_REASON_CATEGORIES = [
  "spam",
  "fabricated",
  "duplicate",
  "privacy",
  "abuse",
  "harassment",
  "other",
] as const;
export type UserStatusReasonCategory = (typeof USER_STATUS_REASON_CATEGORIES)[number];

export type ModerateSetUserStatusResult = { success: true; authSyncWarning?: string } | { error: string };

const MIN_BAN_HOURS = 1;
const MAX_BAN_HOURS = 8760; // 1 year — beyond this, use permanently_banned instead.

export async function moderateSetUserStatus(
  targetUserId: string,
  status: UserStatusValue,
  reason: string,
  reasonCategory: UserStatusReasonCategory,
  banHours?: number
): Promise<ModerateSetUserStatusResult> {
  const admin_ = await requireAdmin();
  if (!admin_) return { error: "Unauthorized." };
  if (admin_.id === targetUserId) return { error: "You cannot moderate your own account." };

  if (!USER_STATUS_VALUES.includes(status)) return { error: "Invalid status." };
  if (!USER_STATUS_REASON_CATEGORIES.includes(reasonCategory)) return { error: "Invalid reason category." };

  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 500) {
    return { error: "A reason (1-500 characters) is required." };
  }

  if (status === "temporarily_banned") {
    if (!Number.isInteger(banHours) || (banHours as number) < MIN_BAN_HOURS || (banHours as number) > MAX_BAN_HOURS) {
      return { error: `A suspension duration between ${MIN_BAN_HOURS} and ${MAX_BAN_HOURS} hours is required.` };
    }
  }

  if (await isActionRateLimited("moderateSetUserStatus", admin_.id, { userLimit: 60, ipLimit: 60, windowSeconds: 600 })) {
    return { error: "Too many moderation actions recently. Please wait a few minutes and try again." };
  }

  const admin = createAdminClient();

  const { data: targetUser, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
  if (targetError || !targetUser?.user) return { error: "User not found." };
  if (isAdminUser(targetUser.user)) return { error: "Cannot moderate another administrator." };

  const { error } = await admin.rpc("moderate_set_user_status", {
    p_user_id: targetUserId,
    p_moderator_id: admin_.id,
    p_status: status,
    p_reason: trimmedReason,
    p_reason_category: reasonCategory,
    p_ban_hours: status === "temporarily_banned" ? banHours : null,
  });

  if (error) {
    logError("moderateSetUserStatus RPC failed", { error: error.message, targetUserId, status });
    return { error: "Failed to update user status." };
  }

  const syncResult = await reconcileAuthSync(admin, targetUserId);
  if (!syncResult.synced) {
    return { success: true, authSyncWarning: syncResult.warning };
  }

  return { success: true };
}
