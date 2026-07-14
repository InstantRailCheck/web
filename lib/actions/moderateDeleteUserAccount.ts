"use server";
import "server-only";

import { requireAdmin, isAdminUser } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";
import { sanitizeProviderError } from "@/lib/authSync";
import { logError } from "@/lib/logger";
import { USER_STATUS_REASON_CATEGORIES, type UserStatusReasonCategory } from "@/lib/actions/moderateSetUserStatus";

export type ModerateDeleteUserAccountResult = { success: true } | { error: string };

// Distinct from the self-service lib/actions/deleteAccount.ts — this is an
// admin-initiated destructive workflow, not abuse enforcement (that's what
// moderateSetUserStatus.ts's ban/restrict actions are for). Reuses the
// existing anonymize-on-delete FK chain
// (20260711033000_add_account_deletion_fk_actions.sql) unchanged:
// submissions are anonymized, not hard-deleted, exactly like self-service
// deletion. An admin who also wants the content gone still uses the
// existing per-row moderateDelete flow separately.
export async function moderateDeleteUserAccount(
  targetUserId: string,
  reason: string,
  reasonCategory: UserStatusReasonCategory
): Promise<ModerateDeleteUserAccountResult> {
  const admin_ = await requireAdmin();
  if (!admin_) return { error: "Unauthorized." };
  if (admin_.id === targetUserId) return { error: "You cannot delete your own account through this action." };

  if (!USER_STATUS_REASON_CATEGORIES.includes(reasonCategory)) return { error: "Invalid reason category." };

  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 500) {
    return { error: "A reason (1-500 characters) is required." };
  }

  if (await isActionRateLimited("moderateDeleteUserAccount", admin_.id, { userLimit: 20, ipLimit: 20, windowSeconds: 600 })) {
    return { error: "Too many moderation actions recently. Please wait a few minutes and try again." };
  }

  const admin = createAdminClient();

  const { data: targetUser, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
  if (targetError || !targetUser?.user) return { error: "User not found." };
  if (isAdminUser(targetUser.user)) return { error: "Cannot delete another administrator." };

  // Audited before the destructive call is even attempted — the deletion
  // itself is an external Auth API call, not a Postgres statement, so
  // there's no atomicity to gain from a stored procedure here (unlike
  // moderate_delete_submission, whose delete IS a Postgres statement).
  // Both the attempt and the eventual outcome are always recorded.
  const { data: auditRow, error: auditError } = await admin
    .from("moderation_actions")
    .insert({
      moderator_user_id: admin_.id,
      action_type: "delete_account",
      target_table: "auth_users",
      target_id: null,
      subject_user_id: targetUserId,
      reason: trimmedReason,
      reason_category: reasonCategory,
      snapshot: { outcome: "attempted" },
    })
    .select("id")
    .single();

  if (auditError || !auditRow) {
    logError("Failed to write pre-deletion audit row", { error: auditError?.message, targetUserId });
    return { error: "Failed to record moderation action." };
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);

  if (deleteError) {
    const sanitized = sanitizeProviderError(deleteError.message);
    logError("Admin-initiated account deletion failed", { error: sanitized, targetUserId });
    await admin
      .from("moderation_actions")
      .update({ snapshot: { outcome: "failed", error: sanitized } })
      .eq("id", auditRow.id);
    return { error: "Failed to delete account." };
  }

  // This row's own subject_user_id gets nulled by its FK the moment the
  // referenced user is gone, same as every other record referencing
  // them — the bare fact ("a user was deleted, for this reason") persists
  // via the row itself; the "who" pointer doesn't.
  await admin.from("moderation_actions").update({ snapshot: { outcome: "success" } }).eq("id", auditRow.id);

  return { success: true };
}
