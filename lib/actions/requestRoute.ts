"use server";
import "server-only";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";
import { logError } from "@/lib/logger";

export type RequestRouteResult = { success: true } | { error: string };

// A request is a demand signal ("please someone check this"), never
// transfer evidence — it must never be confused with a route_reports row.
// route_requests has zero RLS policies (see its migration); this is the
// only write path, using the admin client so requester identity is never
// client-suppliable and the insert is never reachable except through this
// authenticated, rate-limited function.
export async function requestRoute(fromBankId: string, toBankId: string): Promise<RequestRouteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };
  if (fromBankId === toBankId) return { error: "Sender and receiver banks must be different." };

  if (await isActionRateLimited("requestRoute", user.id, { userLimit: 20, ipLimit: 40, windowSeconds: 600 })) {
    return { error: "Too many requests submitted recently. Please wait a few minutes and try again." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("route_requests")
    .insert({ from_bank_id: fromBankId, to_bank_id: toBankId, user_id: user.id });

  // 23505 = unique_violation against route_requests_active_unique_idx: this
  // user already has an active (unfulfilled) request for this exact pair —
  // no row was created. Treated as success, not an error (a repeat click is
  // idempotent, not a failure), but deliberately NOT followed by
  // updateTag(): nothing changed in the database, so nothing needs
  // invalidating. Without this split, an authenticated caller could
  // repeatedly resubmit an already-active request and force the expensive
  // full-table recomputation on every call with zero underlying writes.
  //
  // Deliberately a plain insert + catch rather than .upsert(), since
  // supabase-js's upsert(onConflict: ...) generates a plain
  // `ON CONFLICT (columns)` clause that Postgres can't match against a
  // *partial* unique index (route_requests_active_unique_idx only applies
  // where fulfilled_at is null) — there's no onConflict syntax for a
  // WHERE-qualified conflict target, so letting the index itself reject the
  // duplicate and catching that is the correct tool.
  if (error?.code === "23505") return { success: true };
  if (error) return { error: "Failed to submit request." };

  // updateTag (Next 16) — not the deprecated single-argument
  // revalidateTag(tag) — is the read-your-own-writes primitive: callable
  // only from a Server Action, expires the tag immediately so the next
  // request to getCachedRoutesNeedingFreshReports blocks for fresh data
  // instead of serving a stale hourly snapshot. Only reached once a real
  // row has actually been inserted (see the 23505 branch above). Wrapped so
  // a cache-layer hiccup can never turn an already-successful request into
  // a reported failure — the row is safely in the database either way.
  try {
    updateTag("needs-fresh-reports");
  } catch (err) {
    logError("Failed to invalidate needs-fresh-reports cache after request creation", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { success: true };
}
