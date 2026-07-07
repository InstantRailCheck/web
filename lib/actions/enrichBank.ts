"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupFdicBank } from "@/lib/fdicLookup";
import { lookupNcuaCreditUnion } from "@/lib/ncuaLookup";
import { lookupFinraBroker } from "@/lib/finraLookup";

export async function enrichBank(bankId: string, bankName: string) {
  const fdicMatch = await lookupFdicBank(bankName);
  const ncuaMatch = fdicMatch ? null : await lookupNcuaCreditUnion(bankName);
  const finraMatch = fdicMatch || ncuaMatch ? null : await lookupFinraBroker(bankName);

  const website = fdicMatch?.website ?? ncuaMatch?.website ?? null;
  const address = fdicMatch?.address ?? ncuaMatch?.address ?? finraMatch?.address ?? null;
  const phone = ncuaMatch?.phone ?? finraMatch?.phone ?? null;

  if (!website && !address && !phone) return;

  const supabase = createAdminClient();
  await supabase
    .from("banks")
    .update({ website, address, phone })
    .eq("id", bankId)
    .or("website.is.null,website.eq.");
}
