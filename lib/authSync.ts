import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";

export const USER_STATUS_VALUES = ["active", "restricted", "temporarily_banned", "permanently_banned"] as const;
export type UserStatusValue = (typeof USER_STATUS_VALUES)[number];

const MAX_RECONCILE_ATTEMPTS = 3;
// Supabase's ban_duration has no first-class "permanent" value — a very
// long duration is the conventional stand-in (matches Supabase's own
// documented example).
const PERMANENT_BAN_DURATION = "876000h";

// Every status maps to an explicit desired Auth ban_duration — none is
// skipped. Transitioning out of a real ban (into 'active' OR 'restricted')
// must actively un-ban at the Auth layer, or a prior temporarily_banned/
// permanently_banned state stays stuck there even though the database
// says the user should be able to sign in again.
export function computeBanDuration(status: UserStatusValue, banExpiresAt: string | null): string {
  if (status === "permanently_banned") return PERMANENT_BAN_DURATION;
  if (status === "temporarily_banned" && banExpiresAt) {
    const remainingMs = new Date(banExpiresAt).getTime() - Date.now();
    if (remainingMs <= 0) return "none"; // already expired — reconcile to unbanned
    return `${Math.max(1, Math.ceil(remainingMs / 3_600_000))}h`;
  }
  return "none"; // active or restricted
}

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CREDENTIAL_URL_PATTERN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/g;
const TOKEN_LIKE_PATTERN = /\b[A-Za-z0-9_-]{20,}\b/g;
const MAX_SANITIZED_LENGTH = 300;

// Supabase Auth Admin API errors are operator-facing strings, not
// something this codebase controls the shape of — before either logging
// or persisting one, strip control characters and redact anything shaped
// like a token, email address, or credential-bearing URL, then cap
// length. Applied identically whether the destination is a moderation
// audit snapshot or an operational log line — internal logging isn't a
// blanket exemption for retaining secrets either.
export function sanitizeProviderError(message: string): string {
  const stripped = message.replace(CONTROL_CHARS, " ");
  const redacted = stripped
    .replace(CREDENTIAL_URL_PATTERN, "[redacted-url]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(TOKEN_LIKE_PATTERN, "[redacted-token]");
  return redacted.length > MAX_SANITIZED_LENGTH ? `${redacted.slice(0, MAX_SANITIZED_LENGTH - 1)}…` : redacted;
}

type ReconcileResult = { synced: true } | { synced: false; warning: string };

// The single place that applies Auth state for a user_moderation_status
// row and resolves the ordering race an external Auth call is exposed to:
// the advisory lock inside moderate_set_user_status only protects that
// RPC's own transaction, not the Auth API call a caller makes afterward,
// so a slow call from an OLDER transition can still land after a NEWER
// transition's own call already completed and marked itself synced. A
// `synced` flag only ever proves "this transition's own call landed
// cleanly" — never "no other call could still be in flight" — so this
// function never short-circuits just because the row already says
// synced; it always re-applies the current desired state, which is what
// lets a stale write get discarded (via the transition_id check) and
// immediately superseded by a fresh, correct one within the SAME call,
// rather than leaving Auth silently wrong until something else happens
// to run reconciliation again.
export async function reconcileAuthSync(admin: SupabaseClient, userId: string): Promise<ReconcileResult> {
  for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt++) {
    const { data: row, error: rowError } = await admin
      .from("user_moderation_status")
      .select("status, ban_expires_at, transition_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (rowError) {
      logError("Failed to read moderation state before Auth sync", { userId, error: rowError.message });
      return { synced: false, warning: "Unable to read the current moderation state for Auth sync." };
    }

    if (!row) return { synced: true }; // never moderated — nothing to sync

    const banDuration = computeBanDuration(row.status as UserStatusValue, row.ban_expires_at);
    const { error: authError } = await admin.auth.admin.updateUserById(userId, { ban_duration: banDuration });

    const { data: current, error: currentError } = await admin
      .from("user_moderation_status")
      .select("transition_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (currentError) {
      logError("Failed to verify moderation transition after Auth sync", { userId, error: currentError.message });
      return { synced: false, warning: "Unable to verify the current moderation state after Auth sync." };
    }

    if (!current || current.transition_id !== row.transition_id) {
      // Superseded by a newer action while this Auth call was in flight —
      // discard this result and loop, reconciling against the newest
      // state instead of writing a stale result over it.
      continue;
    }

    const sanitizedError = authError ? sanitizeProviderError(authError.message) : null;

    const { data: updated, error: updateError } = await admin
      .from("user_moderation_status")
      .update({
        auth_sync_status: authError ? "pending" : "synced",
        auth_sync_error: sanitizedError,
      })
      .eq("user_id", userId)
      .eq("transition_id", row.transition_id)
      .select("transition_id")
      .maybeSingle();

    if (updateError) {
      logError("Failed to persist Auth sync outcome", { userId, error: updateError.message });
      return { synced: false, warning: "Auth was updated, but its sync outcome could not be recorded." };
    }

    if (!updated) {
      // The transition changed between the verification read and conditional
      // update. Loop and apply the new desired state before returning.
      continue;
    }

    if (authError) {
      logError("Failed to sync Supabase Auth ban state", { userId, error: sanitizedError });
      return { synced: false, warning: sanitizedError ?? "Auth sync failed." };
    }
    return { synced: true };
  }

  return {
    synced: false,
    warning: "Auth sync still pending after multiple attempts — another change may be in progress. Try retrying shortly.",
  };
}
