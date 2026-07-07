"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupFdicBank } from "@/lib/fdicLookup";

export async function enrichBank(bankId: string, bankName: string) {
  const match = await lookupFdicBank(bankName);
  if (!match) return;

  const supabase = createAdminClient();
  await supabase
    .from("banks")
    .update({ website: match.website, address: match.address })
    .eq("id", bankId)
    .or("website.is.null,website.eq.");
}
