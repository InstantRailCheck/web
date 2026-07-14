"use server";

import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUrlSafeForWebhook } from "@/lib/webhookSafety";
import { isActionRateLimited } from "@/lib/rateLimit";
import { getUserModerationStatus } from "@/lib/moderationStatus";

const MAX_WEBHOOKS_PER_USER = 5;
export const VALID_WEBHOOK_EVENTS = ["bank_added"] as const;
export type WebhookEvent = (typeof VALID_WEBHOOK_EVENTS)[number];

export type Webhook = {
  id: string;
  url: string;
  event: string;
  is_active: boolean;
  created_at: string;
};

export async function registerWebhook(
  url: string,
  event: string
): Promise<{ id: string; secret: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  // Creation only — a restricted/banned user must still be able to view
  // and delete their existing webhooks (listWebhooks/deleteWebhook below
  // are deliberately unchecked).
  const moderationStatus = await getUserModerationStatus(admin, user.id);
  if (moderationStatus.blocked) return { error: moderationStatus.message };

  if (!VALID_WEBHOOK_EVENTS.includes(event as WebhookEvent)) {
    return { error: "Invalid event type." };
  }

  // The 5-webhook cap below only bounds how many can exist at once — nothing
  // stopped repeated registration attempts (each running a real DNS lookup
  // via isUrlSafeForWebhook) from being called indefinitely, e.g. by
  // churning register/delete to burn through lookups or secrets.
  if (await isActionRateLimited("registerWebhook", user.id, { userLimit: 10, ipLimit: 20, windowSeconds: 600 })) {
    return { error: "Too many webhook registration attempts recently. Please wait a few minutes and try again." };
  }

  const trimmedUrl = url.trim();
  const safety = await isUrlSafeForWebhook(trimmedUrl);
  if (!safety.safe) {
    return { error: `URL not allowed: ${safety.reason}` };
  }

  const { count } = await admin
    .from("webhooks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) >= MAX_WEBHOOKS_PER_USER) {
    return { error: `Limit of ${MAX_WEBHOOKS_PER_USER} webhooks per account reached.` };
  }

  const secret = crypto.randomBytes(32).toString("hex");

  const { data, error } = await admin
    .from("webhooks")
    .insert({ user_id: user.id, url: trimmedUrl, event, secret, is_active: true })
    .select("id, secret")
    .single();

  if (error) return { error: "Failed to register webhook." };

  return { id: data.id, secret: data.secret };
}

export async function listWebhooks(): Promise<Webhook[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("webhooks")
    .select("id, url, event, is_active, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return data ?? [];
}

export async function deleteWebhook(id: string): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  const { error } = await admin.from("webhooks").delete().eq("id", id).eq("user_id", user.id);

  if (error) return { error: "Failed to delete webhook." };
  return { success: true };
}
