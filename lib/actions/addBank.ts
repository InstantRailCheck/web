"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify, uniqueSlug } from "@/lib/slugify";
import { normalizeForSearch } from "@/lib/utils";
import { enrichBank } from "@/lib/actions/enrichBank";
import { triggerWebhooks } from "@/lib/actions/triggerWebhooks";

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

  const trimmed = name.trim();
  if (!trimmed) return { error: "Please enter a bank name." };

  const admin = createAdminClient();

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

  const { data, error } = await admin
    .from("banks")
    .insert({ name: trimmed, slug })
    .select("id, slug, name")
    .single();

  if (error || !data) return { error: "Failed to add bank." };

  enrichBank(data.id).catch(() => {});
  triggerWebhooks("bank_added", { bankId: data.id, bankName: data.name }).catch(() => {});

  return data;
}
