"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupFdicBank } from "@/lib/fdicLookup";
import { lookupNcuaCreditUnion } from "@/lib/ncuaLookup";
import { lookupFinraBroker } from "@/lib/finraLookup";
import { isActionRateLimited } from "@/lib/rateLimit";
import { getUserModerationStatus } from "@/lib/moderationStatus";

export type CorrectionField = "website" | "phone";

export type CorrectionResult =
  | { status: "auto_applied"; message: string }
  | { status: "pending_review"; message: string }
  | { status: "error"; message: string };

export async function submitCorrection(
  bankId: string,
  field: CorrectionField,
  value: string
): Promise<CorrectionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "You must be signed in to submit a correction." };
  }

  const admin = createAdminClient();
  const moderationStatus = await getUserModerationStatus(admin, user.id);
  if (moderationStatus.blocked) return { status: "error", message: moderationStatus.message };

  // Each call re-runs the same FDIC/NCUA/FINRA lookups enrichment uses —
  // real outbound requests to external services, not just a DB write.
  if (await isActionRateLimited("submitCorrection", user.id, { userLimit: 15, ipLimit: 30, windowSeconds: 600 })) {
    return { status: "error", message: "Too many corrections submitted recently. Please wait a few minutes and try again." };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { status: "error", message: "Please enter a value." };
  }

  const { data: bank } = await admin
    .from("banks")
    .select("id, name, website, phone")
    .eq("id", bankId)
    .maybeSingle();

  if (!bank) {
    return { status: "error", message: "Bank not found." };
  }

  const previousValue = field === "website" ? bank.website : bank.phone;

  // Re-run the same official lookups used for enrichment, in the same priority order.
  const fdicMatch = await lookupFdicBank(bank.name);
  const ncuaMatch = fdicMatch ? null : await lookupNcuaCreditUnion(bank.name);
  const finraMatch = fdicMatch || ncuaMatch ? null : await lookupFinraBroker(bank.name);

  const officialValue =
    field === "website"
      ? fdicMatch?.website ?? ncuaMatch?.website ?? null
      : ncuaMatch?.phone ?? finraMatch?.phone ?? null;

  const matches = officialValue ? valuesMatch(field, trimmed, officialValue) : false;

  await admin.from("bank_corrections").insert({
    bank_id: bankId,
    user_id: user.id,
    field,
    submitted_value: trimmed,
    previous_value: previousValue,
    status: matches ? "auto_applied" : "pending_review",
  });

  if (matches) {
    await admin
      .from("banks")
      .update({ [field]: officialValue })
      .eq("id", bankId);

    return {
      status: "auto_applied",
      message: "Thanks — this matched our official source and has been updated.",
    };
  }

  return {
    status: "pending_review",
    message:
      "Thanks — we couldn't confirm this against an official source, so it's been flagged for review rather than applied automatically.",
  };
}

function valuesMatch(field: CorrectionField, submitted: string, official: string): boolean {
  if (field === "phone") {
    return normalizePhone(submitted) === normalizePhone(official);
  }
  return normalizeWebsite(submitted) === normalizeWebsite(official);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
}

function normalizeWebsite(url: string): string {
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}
