"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActionRateLimited } from "@/lib/rateLimit";

export type FollowBankResult = { success: true } | { error: string };

// watchlist_bank_follows has zero RLS policies (see its migration); this is
// the only write path, using the admin client so follower identity is
// never client-suppliable. No moderation-status check (unlike
// requestRoute.ts) — following isn't content that can be abused the way a
// public demand signal or report can, it's a private row nobody else ever
// sees.
export async function followBank(bankId: string): Promise<FollowBankResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  if (await isActionRateLimited("followBank", user.id, { userLimit: 60, ipLimit: 120, windowSeconds: 600 })) {
    return { error: "Too many requests. Please wait a few minutes and try again." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("watchlist_bank_follows").insert({ user_id: user.id, bank_id: bankId });

  // 23505 = unique_violation against (user_id, bank_id): already following
  // this bank — treated as success, not an error, same idempotent-repeat-
  // click handling as requestRoute.ts.
  if (error && error.code !== "23505") return { error: "Failed to follow this bank." };

  return { success: true };
}
