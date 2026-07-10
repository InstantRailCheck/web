// Plain server-only function, not a Server Action. It used to be "use
// server", which made it directly callable from anywhere — since it signs
// whatever payload it's given with each subscriber's real HMAC secret and
// delivers it as a legitimately-signed webhook, that let anyone forge
// arbitrary "bank_added" notifications to every registered subscriber,
// indistinguishable from real ones (the signature only proves the server
// signed it, not that the content is genuine). Its only legitimate caller
// is addBank.ts, right after a verified insert.
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUrlSafeForWebhook } from "@/lib/webhookSafety";

const DELIVERY_TIMEOUT_MS = 5000;

export async function triggerWebhooks(event: string, payload: Record<string, unknown>) {
  const supabase = createAdminClient();
  const { data: webhooks } = await supabase
    .from("webhooks")
    .select("id, url, secret")
    .eq("event", event)
    .eq("is_active", true);

  if (!webhooks || webhooks.length === 0) return;

  await Promise.all(webhooks.map((webhook) => deliverOne(webhook, event, payload)));
}

async function deliverOne(
  webhook: { id: string; url: string; secret: string },
  event: string,
  payload: Record<string, unknown>
) {
  const supabase = createAdminClient();
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });

  // Re-validate at delivery time, not just registration time — a URL that
  // resolved to a safe address when registered could have been repointed
  // at an internal address since (DNS rebinding).
  const safety = await isUrlSafeForWebhook(webhook.url);
  if (!safety.safe) {
    await supabase.from("webhook_deliveries").insert({
      webhook_id: webhook.id,
      event,
      success: false,
      error: `Blocked at delivery time: ${safety.reason}`,
    });
    return;
  }

  const signature = crypto.createHmac("sha256", webhook.secret).update(body).digest("hex");

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-InstantRailCheck-Signature": signature,
      },
      body,
      redirect: "manual", // never follow redirects — a safe URL could redirect to an unsafe one
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    await supabase.from("webhook_deliveries").insert({
      webhook_id: webhook.id,
      event,
      success: res.status >= 200 && res.status < 300,
      response_status: res.status,
    });
  } catch (err) {
    await supabase.from("webhook_deliveries").insert({
      webhook_id: webhook.id,
      event,
      success: false,
      error: err instanceof Error ? err.message : "Delivery failed",
    });
  }
}
