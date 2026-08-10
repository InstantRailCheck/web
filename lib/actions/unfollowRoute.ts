"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type UnfollowRouteResult = { success: true } | { error: string };

export async function unfollowRoute(fromBankId: string, toBankId: string): Promise<UnfollowRouteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("watchlist_route_follows")
    .delete()
    .eq("user_id", user.id)
    .eq("from_bank_id", fromBankId)
    .eq("to_bank_id", toBankId);

  if (error) return { error: "Failed to unwatch this route." };

  return { success: true };
}
