// Plain server-only function, not a Server Action. It used to be "use
// server", which made it directly callable from anywhere — since it signs
// whatever payload it's given with each subscriber's real HMAC secret and
// delivers it as a legitimately-signed webhook, that let anyone forge
// arbitrary "bank_added" notifications to every registered subscriber,
// indistinguishable from real ones (the signature only proves the server
// signed it, not that the content is genuine). Its only legitimate caller
// is addBank.ts, right after a verified insert.
import "server-only";
import crypto from "node:crypto";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUrlSafeForWebhook } from "@/lib/webhookSafety";

const DELIVERY_TIMEOUT_MS = 5000;

// The 5-webhooks-per-user cap bounds one account, not total subscribers
// across the whole system — a plain Promise.all over every active
// subscriber would fan out unboundedly as adoption grows (one bank_added
// event dispatching hundreds/thousands of simultaneous connections+agents).
// Not urgent at today's scale (0 registered webhooks), fixed ahead of it
// mattering rather than after.
const MAX_CONCURRENT_DELIVERIES = 10;

export async function triggerWebhooks(event: string, payload: Record<string, unknown>) {
  const supabase = createAdminClient();
  const { data: webhooks } = await supabase
    .from("webhooks")
    .select("id, url, secret")
    .eq("event", event)
    .eq("is_active", true);

  if (!webhooks || webhooks.length === 0) return;

  await mapWithConcurrency(webhooks, MAX_CONCURRENT_DELIVERIES, (webhook) => deliverOne(webhook, event, payload));
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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

  // Pin the actual TCP connection to the exact address just validated,
  // instead of letting fetch() re-resolve the hostname itself — a plain
  // fetch(webhook.url) would perform its own independent DNS lookup, and a
  // hostile nameserver could return a safe address to isUrlSafeForWebhook
  // and a private one moments later to this second lookup (DNS rebinding).
  // The custom `lookup` only overrides the raw connect target; the Host
  // header and TLS SNI still come from the URL's real hostname.
  const pinnedFamily = net.isIPv6(safety.address) ? 6 : 4;
  const pinnedDispatcher = new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, safety.address, pinnedFamily);
      },
    },
  });

  try {
    const res = await undiciFetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-InstantRailCheck-Signature": signature,
      },
      body,
      redirect: "manual", // never follow redirects — a safe URL could redirect to an unsafe one
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      dispatcher: pinnedDispatcher,
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
  } finally {
    // A dedicated Agent is created per delivery (so its pinned lookup only
    // ever resolves this one webhook's validated address) — it must be
    // closed afterward or its connection pool/sockets are never released.
    await pinnedDispatcher.close();
  }
}
