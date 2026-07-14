"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify, uniqueSlug } from "@/lib/slugify";
import { normalizeForSearch } from "@/lib/utils";
import { enrichBank } from "@/lib/actions/enrichBank";
import { triggerWebhooks } from "@/lib/actions/triggerWebhooks";
import { isActionRateLimited } from "@/lib/rateLimit";
import { getUserModerationStatus } from "@/lib/moderationStatus";

export type AddBankResult = { id: string; slug: string; name: string } | { error: string };

// The single authenticated entry point for adding a bank from the client.
// Previously the client inserted into `banks` directly (relying on an RLS
// policy with no column restrictions — any signed-in user could set
// fednow_participant/rtp_participant/zelle_participant to true from
// scratch) and then separately invoked enrichBank/triggerWebhooks as
// unauthenticated Server Actions. All three steps now happen here, using
// the admin client, so there's one authenticated path instead of three
// independently-reachable ones.
export async function addBank(name: string): Promise<AddBankResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  const moderationStatus = await getUserModerationStatus(admin, user.id);
  if (moderationStatus.blocked) return { error: moderationStatus.message };

  // Each call triggers a normalized-name lookup, a slug uniqueness scan, an
  // insert, and (on success) an FDIC/NCUA/FINRA enrichment lookup plus
  // webhook delivery — cheap to call, not cheap to run repeatedly. RLS
  // proves ownership of the resulting row, not reasonable call volume.
  if (await isActionRateLimited("addBank", user.id, { userLimit: 10, ipLimit: 20, windowSeconds: 600 })) {
    return { error: "Too many banks added recently. Please wait a few minutes and try again." };
  }

  const trimmed = name.trim();
  if (!trimmed) return { error: "Please enter a bank name." };

  // Normalized comparison so "US Bank National Association" (typed exactly,
  // differing only by punctuation) still matches the real "U.S. Bank
  // National Association" row instead of creating a duplicate. Doesn't
  // catch a short/casual name ("US Bank") against a full legal name - that's
  // a fuzzy-matching problem, not a punctuation one; still a real gap.
  const { data: existing } = await admin
    .from("banks")
    .select("id, slug, name")
    .eq("name_normalized", normalizeForSearch(trimmed))
    .maybeSingle();

  if (existing) return existing;

  const baseSlug = slugify(trimmed);
  const { data: similarSlugs } = await admin
    .from("banks")
    .select("slug")
    .ilike("slug", `${baseSlug}%`);

  const usedSlugs = new Set((similarSlugs ?? []).map((b) => b.slug));
  const slug = uniqueSlug(baseSlug, usedSlugs);

  // One transaction (see 20260714020000_add_user_moderation_status.sql) —
  // a failure writing bank_attributions rolls back the banks insert too,
  // so no orphaned unattributed bank can be created.
  const { data, error } = (await admin
    .rpc("add_bank_with_attribution", { p_name: trimmed, p_slug: slug, p_user_id: user.id })
    .single()) as { data: { id: string; slug: string; name: string } | null; error: { message: string } | null };

  if (error || !data) return { error: "Failed to add bank." };

  enrichBank(data.id).catch(() => {});
  triggerWebhooks("bank_added", { bankId: data.id, bankName: data.name }).catch(() => {});

  return data;
}
