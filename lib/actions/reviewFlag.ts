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
function isValidSignalShape(signals: Signal[]): boolean {
  return (
    Array.isArray(signals) &&
    signals.every(
      (s) =>
        s && typeof s.signal === "string" && typeof s.reason === "string" && (s.severity === "info" || s.severity === "warning" || s.severity === "high")
    )
  );
}

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
  if (!Number.isFinite(score) || score < 0) return { error: "Invalid score." };
  if (!isValidSignalShape(signals)) return { error: "Invalid signal data." };

  const admin = createAdminClient();

  // The score/signal snapshot is still caller-supplied (recomputing the
  // full batched signal set for one row server-side would mean duplicating
  // lib/riskTriage.ts's cross-row query logic here) — this isn't a
  // privilege-escalation risk since the action is already admin-only, but
  // the row's own existence and ownership are independently verified
  // before writing anything, so a review can't be recorded against a
  // submission that doesn't exist or against the wrong account.
  const { data: targetRow, error: lookupError } = await admin.from(targetTable).select("user_id").eq("id", targetId).maybeSingle();
  if (lookupError) {
    logError("Failed to verify triage flag target before review", { targetTable, targetId, error: lookupError.message });
    return { error: "Failed to record the review." };
  }
  if (!targetRow || targetRow.user_id !== subjectUserId) {
    return { error: "Submission not found." };
  }

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
