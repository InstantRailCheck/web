"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type UnfollowBankResult = { success: true } | { error: string };

export async function unfollowBank(bankId: string): Promise<UnfollowBankResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("watchlist_bank_follows")
    .delete()
    .eq("user_id", user.id)
    .eq("bank_id", bankId);

  if (error) return { error: "Failed to unfollow this bank." };

  return { success: true };
}
