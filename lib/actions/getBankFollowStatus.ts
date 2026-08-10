"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getBankFollowStatus(bankId: string): Promise<{ following: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { following: false };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("watchlist_bank_follows")
    .select("id")
    .eq("user_id", user.id)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (error) return { following: false };
  return { following: data !== null };
}
