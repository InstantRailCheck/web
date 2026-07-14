"use server";
import "server-only";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { Signal } from "@/lib/riskSignals";

export type ReviewFlagResult = { success: true } | { error: string };

const DEFAULT_NOTE = "Reviewed — no action needed";

// Marks a triage flag as looked-at so lib/riskTriage.ts's queue stops
// resurfacing it. Reuses the existing moderation_actions audit table
// (action_type = 'review_flag') rather than a new table — this is a
// record of "an admin looked at this and what the signals said at the
// time," never a copy of the submission's own free-text content.
export async function reviewFlag(
  targetTable: "route_reports" | "edd_reports",
  targetId: string,
  subjectUserId: string,
  signals: Signal[],
  score: number,
  note: string
): Promise<ReviewFlagResult> {
  const admin_ = await requireAdmin();
  if (!admin_) return { error: "Unauthorized." };

  const trimmedNote = note.trim();
  if (trimmedNote.length > 500) return { error: "Note must be 500 characters or fewer." };

  const admin = createAdminClient();
  const { error } = await admin.from("moderation_actions").insert({
    moderator_user_id: admin_.id,
    action_type: "review_flag",
    target_table: targetTable,
    target_id: targetId,
    subject_user_id: subjectUserId,
    reason: trimmedNote || DEFAULT_NOTE,
    reason_category: "other",
    snapshot: { signals, score },
  });

  if (error) {
    logError("Failed to record triage flag review", { targetTable, targetId, error: error.message });
    return { error: "Failed to record the review." };
  }

  return { success: true };
}
