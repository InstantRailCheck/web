"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOfficialMatch } from "@/lib/officialInstitutionMatch";
import { isActionRateLimited } from "@/lib/rateLimit";
import { getUserModerationStatus } from "@/lib/moderationStatus";

export type CorrectionField = "website" | "phone";

const VALID_CORRECTION_FIELDS: readonly CorrectionField[] = ["website", "phone"];

function isValidCorrectionField(field: unknown): field is CorrectionField {
  return typeof field === "string" && (VALID_CORRECTION_FIELDS as readonly string[]).includes(field);
}

export type CorrectionResult =
  | { status: "auto_applied"; message: string }
  | { status: "pending_review"; message: string }
  | { status: "error"; message: string };

export async function submitCorrection(
  bankId: string,
  field: CorrectionField,
  value: string
): Promise<CorrectionResult> {
  // `field`'s TS type is not enforced at runtime — a Server Action is a
  // real endpoint, callable with arbitrary JSON regardless of what the
  // exported signature says. Everything below assumes field is exactly
  // "website" or "phone"; this is what actually guarantees that, not the
  // TypeScript union.
  if (!isValidCorrectionField(field)) {
    return { status: "error", message: "Invalid correction field." };
  }

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

  const { data: bank, error: bankLookupError } = await admin
    .from("banks")
    .select("id, name, website, phone, fdic_cert, ncua_charter_number, is_active")
    .eq("id", bankId)
    .maybeSingle();

  if (bankLookupError) {
    return { status: "error", message: "Something went wrong looking up this institution. Please try again." };
  }

  if (!bank) {
    return { status: "error", message: "Bank not found." };
  }

  // The RPC below enforces this too (real guard, can't be bypassed) — this
  // is only a friendlier early exit that skips a pointless outbound lookup.
  if (!bank.is_active) {
    return { status: "error", message: "This institution is no longer listed and can't accept corrections." };
  }

  const previousValue = field === "website" ? bank.website : bank.phone;

  // Same official lookups enrichment uses, in the same priority order —
  // identifier-based whenever this bank is already linked, so a
  // duplicate-name group can never have its correction verified against a
  // *different* charter's official data (v8.0 §2).
  const { fdicMatch, ncuaMatch, finraMatch } = await resolveOfficialMatch(bank);

  const officialValue =
    field === "website"
      ? fdicMatch?.website ?? ncuaMatch?.website ?? null
      : ncuaMatch?.phone ?? finraMatch?.phone ?? null;

  const matches = officialValue ? valuesMatch(field, trimmed, officialValue) : false;

  // One atomic RPC: inserts the bank_corrections row and (only when
  // matched) updates exactly one hardcoded column, in a single
  // transaction — no computed update key, and an insert failure rolls
  // back the update too rather than leaving them independently fallible.
  const { error: applyError } = await admin.rpc("apply_bank_correction", {
    p_bank_id: bankId,
    p_user_id: user.id,
    p_field: field,
    p_submitted_value: trimmed,
    p_previous_value: previousValue,
    p_matched: matches,
    p_official_value: officialValue,
  });

  if (applyError) {
    return { status: "error", message: "Something went wrong submitting this correction. Please try again." };
  }

  if (matches) {
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
