"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";

export type FollowRouteResult = { success: true } | { error: string };

// watchlist_route_follows has zero RLS policies (see its migration); this
// is the only write path, using the admin client. No moderation-status
// check, same reasoning as followBank.ts — a private row nobody else ever
// sees.
export async function followRoute(fromBankId: string, toBankId: string): Promise<FollowRouteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  if (fromBankId === toBankId) return { error: "Sender and receiver banks must be different." };

  if (await isActionRateLimited("followRoute", user.id, { userLimit: 60, ipLimit: 120, windowSeconds: 600 })) {
    return { error: "Too many requests. Please wait a few minutes and try again." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("watchlist_route_follows")
    .insert({ user_id: user.id, from_bank_id: fromBankId, to_bank_id: toBankId });

  // 23505 = unique_violation against (user_id, from_bank_id, to_bank_id):
  // already watching this route — treated as success, not an error, same
  // idempotent-repeat-click handling as requestRoute.ts.
  if (error && error.code !== "23505") return { error: "Failed to watch this route." };

  return { success: true };
}
