import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOfficialMatch } from "@/lib/officialInstitutionMatch";
import { checkRailParticipation } from "@/lib/railParticipation";

// Plain server-only function, not a Server Action — its only legitimate
// caller is addBank.ts right after a verified insert. It used to accept a
// caller-supplied bankName as well as bankId and was directly client-
// callable via "use server", which let anyone overwrite an arbitrary
// existing bank's contact info/rail flags with a *different* institution's
// real data just by supplying a mismatched name. Deriving the name from
// bankId here instead closes that off at the signature level.
export async function enrichBank(bankId: string) {
  const admin = createAdminClient();
  const { data: bank } = await admin
    .from("banks")
    .select("name, city, state, fdic_cert, ncua_charter_number")
    .eq("id", bankId)
    .maybeSingle();
  if (!bank) return;

  const [{ fdicMatch, ncuaMatch, finraMatch }, railParticipation] = await Promise.all([
    resolveOfficialMatch(bank),
    checkRailParticipation(bank),
  ]);

  const website = fdicMatch?.website ?? ncuaMatch?.website ?? null;
  const address = fdicMatch?.address ?? ncuaMatch?.address ?? finraMatch?.address ?? null;
  const phone = ncuaMatch?.phone ?? finraMatch?.phone ?? null;

  // Never let an automated re-check downgrade a rail from true back to
  // false — a positive confirmation (even a manual one) outweighs an
  // absence in a source that can be incomplete (e.g. Zelle's directory).
  const { data: current } = await admin
    .from("banks")
    .select("fednow_participant, rtp_participant, zelle_participant")
    .eq("id", bankId)
    .maybeSingle();

  await admin
    .from("banks")
    .update({
      fednow_participant: current?.fednow_participant || railParticipation.fednow,
      rtp_participant: current?.rtp_participant || railParticipation.rtp,
      zelle_participant: current?.zelle_participant || railParticipation.zelle,
    })
    .eq("id", bankId);

  if (!website && !address && !phone) return;

  await admin
    .from("banks")
    .update({ website, address, phone })
    .eq("id", bankId)
    .or("website.is.null,website.eq.");
}
