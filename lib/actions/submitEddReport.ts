"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";
import { getUserModerationStatus } from "@/lib/moderationStatus";
import { logError } from "@/lib/logger";
import { buildEddReportReceipt, type EddReportReceipt } from "@/lib/receipts";
import type { EddReportRow } from "@/lib/bankProfile";

export type SubmitEddReportInput = {
  bankId: string;
  daysEarly: number;
  depositType: string | null;
  payrollProvider: string | null;
};

export type SubmitEddReportResult = { success: true; receipt: EddReportReceipt } | { error: string };

// Moved off a direct client-side RLS insert — edd_reports has no SELECT
// policy at all (see migration 20260710233000_lock_down_report_table_reads.
// sql), so there was never a way for the client to read back the inserted
// row or any before/after state; the receipt this action returns can only
// be computed server-side. This brings EDD submission in line with
// submitRouteReport.ts, which made the same move for route reports back in
// v6.x — EDD was the one remaining holdout of the older pattern.
export async function submitEddReport(input: SubmitEddReportInput): Promise<SubmitEddReportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  // App-level check for a clear message — check_edd_report_quota (the DB
  // trigger) is the actual backstop, since edd_reports' RLS insert policy
  // is still directly reachable by a client that bypasses this Server
  // Action entirely.
  const moderationStatus = await getUserModerationStatus(admin, user.id);
  if (moderationStatus.blocked) return { error: moderationStatus.message };

  if (await isActionRateLimited("submitEddReport", user.id, { userLimit: 10, ipLimit: 20, windowSeconds: 600 })) {
    return { error: "Too many EDD reports submitted recently. Please wait a few minutes and try again." };
  }

  // edd_reports_reject_inactive_bank_trigger (the DB trigger) is the real
  // guard and rejects this unconditionally on INSERT — this is only a
  // clearer, faster message than the generic "Failed to submit report."
  // the raw trigger error would otherwise collapse into below.
  const { data: bankToCheck } = await admin.from("banks").select("id, is_active").eq("id", input.bankId).maybeSingle();
  if (bankToCheck && !bankToCheck.is_active) {
    return { error: "This institution is no longer listed and can't receive new reports." };
  }

  const eddReportsQuery = () =>
    admin
      .from("edd_reports")
      .select("id, bank_id, user_id, days_early, created_at, deposit_type, payroll_provider")
      .eq("bank_id", input.bankId);

  // Read before writing so a snapshot failure aborts cleanly — nothing has
  // been written yet, so it's safe to fail loudly here rather than risk a
  // receipt built on a silently-empty "no prior contributors" fallback
  // (which could falsely claim a visibility/leaderboard threshold crossing).
  const { data: beforeRows, error: beforeError } = await eddReportsQuery();
  if (beforeError) return { error: "Failed to submit report." };
  const preInsertReports: EddReportRow[] = beforeRows ?? [];

  const { data: newRow, error } = await admin
    .from("edd_reports")
    .insert({
      bank_id: input.bankId,
      days_early: input.daysEarly,
      deposit_type: input.depositType,
      payroll_provider: input.payrollProvider,
      user_id: user.id,
    })
    .select("id, bank_id, user_id, days_early, created_at, deposit_type, payroll_provider")
    .single();

  if (error || !newRow) return { error: "Failed to submit report." };

  // Re-read AFTER the write (rather than reusing the pre-insert snapshot
  // plus this one known row) so a concurrent submitter's EDD report for the
  // same bank — landing in between our own snapshot and insert — is
  // reflected too, instead of two simultaneous submissions each computing
  // "before + only me" and both claiming the same threshold crossing. The
  // write already committed by this point, so a failure here can only
  // degrade the receipt, never the submission itself — fall back to the
  // pre-insert snapshot (the old, still-correct-if-slightly-racier
  // behavior) rather than failing an already-successful report.
  const { data: afterRows, error: afterError } = await eddReportsQuery();
  const beforeReports: EddReportRow[] = afterError
    ? preInsertReports
    : (afterRows ?? []).filter((r) => r.id !== newRow.id);
  if (afterError) {
    logError("Failed to re-fetch edd_reports after insert; receipt may be based on a stale snapshot", {
      error: afterError.message,
    });
  }

  const receipt = buildEddReportReceipt({ beforeReports, newReport: newRow });

  return { success: true, receipt };
}
