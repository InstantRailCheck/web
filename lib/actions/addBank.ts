"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
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

  const { data: existing } = await admin
    .from("banks")
    .select("id, slug, name")
    .ilike("name", trimmed)
    .maybeSingle();

  if (existing) return existing;

  const baseSlug = slugify(trimmed);
  const { data: similarSlugs } = await admin
    .from("banks")
    .select("slug")
    .ilike("slug", `${baseSlug}%`);

  const usedSlugs = new Set((similarSlugs ?? []).map((b) => b.slug));
  let slug = baseSlug;
  let suffix = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

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
