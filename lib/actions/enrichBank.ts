"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupFdicBank } from "@/lib/fdicLookup";
import { lookupNcuaCreditUnion } from "@/lib/ncuaLookup";

export async function enrichBank(bankId: string, bankName: string) {
  const fdicMatch = await lookupFdicBank(bankName);
  const ncuaMatch = fdicMatch ? null : await lookupNcuaCreditUnion(bankName);
  const match = fdicMatch ?? ncuaMatch;

  if (!match) return;

  const supabase = createAdminClient();
  await supabase
    .from("banks")
    .update({
      website: match.website,
      address: match.address,
      phone: "phone" in match ? match.phone : null,
    })
    .eq("id", bankId)
    .or("website.is.null,website.eq.");
}
