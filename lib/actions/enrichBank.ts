"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupFdicBank } from "@/lib/fdicLookup";
import { lookupNcuaCreditUnion } from "@/lib/ncuaLookup";
import { lookupFinraBroker } from "@/lib/finraLookup";
import { checkRailParticipation } from "@/lib/railParticipation";

export async function enrichBank(bankId: string, bankName: string) {
  const [fdicMatch, ncuaMatchPromise, finraMatchPromise, railParticipation] = await Promise.all([
    lookupFdicBank(bankName),
    lookupNcuaCreditUnion(bankName),
    lookupFinraBroker(bankName),
    checkRailParticipation(bankName),
  ]);

  const ncuaMatch = fdicMatch ? null : ncuaMatchPromise;
  const finraMatch = fdicMatch || ncuaMatch ? null : finraMatchPromise;

  const website = fdicMatch?.website ?? ncuaMatch?.website ?? null;
  const address = fdicMatch?.address ?? ncuaMatch?.address ?? finraMatch?.address ?? null;
  const phone = ncuaMatch?.phone ?? finraMatch?.phone ?? null;

  const supabase = createAdminClient();

  // Never let an automated re-check downgrade a rail from true back to
  // false — a positive confirmation (even a manual one) outweighs an
  // absence in a source that can be incomplete (e.g. Zelle's directory).
  const { data: current } = await supabase
    .from("banks")
    .select("fednow_participant, rtp_participant, zelle_participant")
    .eq("id", bankId)
    .maybeSingle();

  await supabase
    .from("banks")
    .update({
      fednow_participant: current?.fednow_participant || railParticipation.fednow,
      rtp_participant: current?.rtp_participant || railParticipation.rtp,
      zelle_participant: current?.zelle_participant || railParticipation.zelle,
    })
    .eq("id", bankId);

  if (!website && !address && !phone) return;

  await supabase
    .from("banks")
    .update({ website, address, phone })
    .eq("id", bankId)
    .or("website.is.null,website.eq.");
}
