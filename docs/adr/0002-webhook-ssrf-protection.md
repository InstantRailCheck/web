# ADR-0002: Webhook SSRF Protection and Signed Delivery

- Status: Accepted
- Decision date: 2026-07-07
- Amended: 2026-07-19 (moderation enforcement, DNS-pinned delivery, bounded fanout — see Amendment below)
- Last validated against repository: 2026-07-19
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: public webhooks, currently the `bank_added` event
- Primary implementations: `lib/actions/webhooks.ts`, `lib/actions/triggerWebhooks.ts`, `lib/webhookSafety.ts`
- Related ADRs: [ADR-0008](0008-moderation-enforcement.md) (webhook registration enforces `user_moderation_status`, the same durable moderation-intent record ADR-0008 describes)

## Context

InstantRailCheck exposes public webhooks so signed-in users can receive a POST when supported events occur. The first supported event is `bank_added`.

Webhooks are useful because they let API consumers react to changes without polling `/api/changelog`. They also create a security-sensitive surface area because users control destination URLs that the server will fetch.

Without guardrails, webhook delivery can become a server-side request forgery (SSRF) primitive. A malicious or compromised user could attempt to make InstantRailCheck send requests to internal infrastructure, loopback services, cloud metadata endpoints, or private networks.

Webhook consumers also need a way to verify that a delivery genuinely came from InstantRailCheck and was not forged by another sender.

## Decision

Use a conservative webhook delivery model:

1. Require authentication to register, list, or delete webhooks.
2. Limit webhook registration to known event types.
   - The current implementation accepts only `bank_added`.
3. Limit each account to 5 webhooks.
4. Generate a per-webhook random secret at registration time.
   - The secret is returned once to the user.
   - Deliveries are signed with HMAC-SHA256 over the raw JSON body.
   - The signature is sent in the `X-InstantRailCheck-Signature` header.
5. Validate webhook URLs at registration time.
   - Only `http:` and `https:` URLs are allowed.
   - `localhost` and `.localhost` hostnames are rejected.
   - Hostnames must resolve successfully.
   - Any resolved private, loopback, link-local, cloud-metadata-adjacent, CGNAT, unique-local IPv6, or otherwise unrecognized address is rejected.
6. Re-validate webhook URLs at delivery time.
   - Hostnames are resolved again immediately before delivery.
   - This defends against DNS rebinding and post-registration DNS changes.
7. Do not follow redirects during delivery.
   - Redirects are handled manually by refusing to follow them.
   - This prevents a safe URL from redirecting to an unsafe destination.
8. Use a short delivery timeout.
   - Current delivery timeout is 5 seconds.
9. Log each delivery attempt.
   - Successful and failed deliveries are recorded in `webhook_deliveries`.
   - Delivery failures do not block the originating user workflow.
10. Do not retry webhook deliveries in v1.
    - Webhooks are fire-once and logged.
    - Consumers are expected to return a 2xx response quickly.

## Rationale

### User-controlled outbound requests require SSRF defenses

Webhook URLs are supplied by users but fetched by InstantRailCheck infrastructure. That makes them more dangerous than ordinary links displayed in a browser.

The system must assume a destination URL may be intentionally crafted to reach internal or reserved network addresses.

### Registration-time validation is not enough

A hostname that resolves to a public IP at registration can later resolve to a private IP. Rechecking the hostname at delivery time closes the most important DNS rebinding gap in the current model.

### Every resolved address must be safe

If a hostname resolves to multiple addresses, the delivery is allowed only when all resolved addresses are public and recognized as safe. A single unsafe address blocks the delivery.

This avoids relying on address ordering or runtime selection behavior.

### Redirects bypass simple URL checks

A destination can appear safe when registered but respond with a redirect to a private or reserved address. Delivery therefore uses manual redirect handling and does not follow redirects.

### HMAC signatures are simple and interoperable

A per-webhook secret and HMAC-SHA256 signature give consumers a straightforward way to authenticate the sender and verify payload integrity without requiring OAuth, mTLS, or a more complex event gateway.

### Fire-once delivery is appropriate for v1

Retries introduce ordering, duplication, backoff, queueing, replay, and operational concerns. For the initial `bank_added` webhook, logging a single best-effort delivery keeps the system understandable while still providing useful integration capability.

## Consequences

### Positive

- Reduces SSRF risk from user-controlled webhook URLs.
- Defends against DNS rebinding by validating at delivery time.
- Prevents redirect-based bypasses.
- Gives consumers a standard way to verify webhook authenticity.
- Keeps v1 operationally simple by avoiding retry infrastructure.
- Creates an audit trail through `webhook_deliveries`.
- Limits abuse potential through per-account webhook caps.

### Negative

- Some legitimate endpoints may be blocked if their DNS or network configuration includes private or reserved addresses.
- Webhooks behind private networks, tunnels, or localhost development URLs are intentionally unsupported.
- No retries means transient receiver failures can miss events.
- Delivery ordering is not guaranteed across multiple webhooks because deliveries are sent concurrently.
- HMAC verification depends on the consumer preserving and signing the exact raw request body.
- The current IP classification is explicit but not exhaustive for every reserved range or future network category.

## Related implementation

Webhook management lives in:

- `lib/actions/webhooks.ts`

Webhook delivery lives in:

- `lib/actions/triggerWebhooks.ts`

URL safety checks live in:

- `lib/webhookSafety.ts`

The database tables are introduced in:

- `supabase/migrations/20260708025717_add_webhooks.sql`

The user-facing webhook manager lives in:

- `components/WebhooksManager.tsx`

The project changelog documents the v1 webhook scope in:

- `PROJECT.md`

## Rejected alternatives

### Polling-only integrations

Rejected because polling `/api/changelog` forces consumers to repeatedly ask for data even when nothing changed. Webhooks are a cleaner integration primitive for change notifications.

### Trusting registration-time validation only

Rejected because DNS can change after registration. Delivery-time validation is required to guard against DNS rebinding and stale assumptions.

### Following redirects

Rejected because redirects can turn a previously safe destination into an unsafe request target.

### Allowing localhost or private-network destinations

Rejected because the server, not the user's browser, performs webhook delivery. Localhost and private addresses would refer to infrastructure reachable from the server runtime, not the user's machine.

### Retrying failed deliveries in v1

Rejected for the initial implementation because retries add queueing, backoff, idempotency, replay, and duplicate-delivery semantics. Those should be designed intentionally before being added.

### Unsigned webhook payloads

Rejected because consumers need to verify that a delivery came from InstantRailCheck and was not forged by another sender.

### Accepting arbitrary event names

Rejected because event schemas need explicit contracts. The initial implementation supports only `bank_added`.

## Validation

The implementation validates webhook URLs both when a webhook is registered and immediately before each delivery.

Delivery uses `redirect: "manual"`, a 5-second timeout, and records the result in `webhook_deliveries`.

The user-facing UI states that webhooks fire a signed POST, are limited to 5 per account, are not retried, and should return a 2xx quickly.

## Amendment (2026-07-19): moderation enforcement, DNS-pinned delivery, bounded fanout

Three things strengthened since the original decision, none of which change its direction:

**Moderation enforcement at registration.** `lib/actions/webhooks.ts` now checks `getUserModerationStatus` before allowing registration (see [ADR-0008](0008-moderation-enforcement.md)) — a restricted or banned account cannot register a new webhook. Registration also has its own attempt-rate throttle (`isActionRateLimited`, 10/user and 20/IP per 600 seconds), which is a distinct control from the 5-active-webhook cap: the cap limits how many webhooks an account can have at once, the throttle limits how fast registration can be *attempted*, including failed/rejected attempts.

**Delivery is pinned to the exact validated address, not re-resolved.** The original decision already called for delivery-time re-validation to defend against DNS rebinding, but a naive implementation of that (validate the hostname, then call `fetch(url)`) still has a gap: the second `fetch()` call performs its own independent DNS lookup, milliseconds after validation, which is exactly the window a hostile nameserver can exploit — return a safe address to the validation check, then a private one to the real request. `lib/actions/triggerWebhooks.ts` closes this: it re-validates via `isUrlSafeForWebhook` and then constructs a `undici` `Agent` with a custom `connect.lookup` that pins the actual TCP connection to that exact validated address. The Host header and TLS SNI still come from the webhook's real URL/hostname (the custom `lookup` only overrides the raw connect target), so certificate validation and virtual-hosting behave normally — only the DNS resolution step is pinned.

**Bounded concurrency.** Delivery fanout now uses `mapWithConcurrency` with a cap of 10 concurrent deliveries, rather than an unbounded `Promise.all` over every registered webhook for an event. At today's scale (effectively zero registered webhooks) this has no observable effect, but it was fixed ahead of it mattering rather than after — an unbounded fanout would otherwise scale directly with subscriber count.

None of this changes the original decision's shape: authentication, the 5-webhook cap, HMAC-SHA256 over the raw body, no-redirects, the 5-second timeout, fire-once delivery, and `webhook_deliveries` logging are all unchanged.

## Future considerations

Any future webhook expansion should preserve the SSRF and authenticity model.

Possible improvements include:

- Broader reserved-IP coverage and tests for IPv4, IPv6, and IPv4-mapped IPv6 edge cases.
- Explicit payload schema/version fields for each event type.
- Idempotency keys for consumers.
- Retry queues with bounded exponential backoff.
- Delivery-attempt visibility in the UI.
- Webhook disabling after repeated failures.
- Secret rotation.
- Replay-protection guidance using timestamps and signature verification windows.
- Separate signing formats such as `v1=<hex>` if multiple signature versions are introduced.
