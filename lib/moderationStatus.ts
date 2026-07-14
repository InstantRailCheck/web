import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";

export type ModerationStatusCheck = { blocked: false } | { blocked: true; message: string };

const MESSAGES = {
  restricted: "Your account is currently restricted from submitting.",
  temporarily_banned: "Your account is currently suspended from submitting.",
  permanently_banned: "Your account is currently restricted from submitting.",
} as const;

// Checked from every user-generated creation path that isn't already
// covered by a DB-level trigger (route_reports/edd_reports have their own
// enforcement in check_route_report_quota/check_edd_report_quota, since
// those two tables are still reachable via a direct RLS-authenticated
// insert that bypasses this app-level check entirely — see the v7.2
// plan's "Enforcement coverage" table). This is the app-level layer for
// requestRoute, submitCorrection, addBank, and registerWebhook, none of
// which have an RLS-reachable insert path to bypass.
export async function getUserModerationStatus(admin: SupabaseClient, userId: string): Promise<ModerationStatusCheck> {
  const { data, error } = await admin
    .from("user_moderation_status")
    .select("status, ban_expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  // This check is an enforcement boundary, so an unavailable status table
  // must not be interpreted as an active account. A generic message avoids
  // exposing database details while still letting the caller fail closed.
  if (error) {
    logError("Failed to read user moderation status", { userId, error: error.message });
    return { blocked: true, message: "Unable to verify your account status. Please try again shortly." };
  }

  if (!data || data.status === "active") return { blocked: false };

  if (data.status === "temporarily_banned") {
    const expired = data.ban_expires_at !== null && new Date(data.ban_expires_at).getTime() <= Date.now();
    if (expired) return { blocked: false };
  }

  return { blocked: true, message: MESSAGES[data.status as keyof typeof MESSAGES] };
}
