# ADR-0003: Nonce-Based Content Security Policy

- Status: Accepted
- Decision date: 2026-07-07
- Last validated against repository: 2026-07-09
- Grounding: implementation + PROJECT.md
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: application-wide security headers and CSP
- Primary implementations: `proxy.ts`, `next.config.ts`

## Context

InstantRailCheck needs strong browser security headers without breaking Next.js App Router rendering, Supabase SSR session handling, or JSON-LD structured data.

A static Content-Security-Policy in `next.config.ts` would be easier to reason about, but it cannot provide a fresh nonce per request. Next.js also emits framework-managed inline scripts/styles during rendering, and the application emits JSON-LD script tags on SEO-sensitive pages.

The project therefore needs a CSP model that is strict enough to reject arbitrary inline scripts while still allowing intended framework and application script tags.

## Decision

Generate a fresh CSP nonce per request in `proxy.ts`.

The proxy:

1. Creates a nonce from `crypto.randomUUID()`, base64-encoded.
2. Builds a CSP header containing:
   - `default-src 'self'`
   - `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'`
   - development-only `'unsafe-eval'`
   - `style-src 'self' 'nonce-{nonce}'`
   - `img-src 'self' data:`
   - `font-src 'self' data:`
   - `connect-src 'self' https://*.supabase.co`
   - `object-src 'none'`
   - `base-uri 'self'`
   - `form-action 'self'`
   - `frame-ancestors 'none'`
   - `upgrade-insecure-requests`
3. Threads the nonce through the request via `x-nonce`.
4. Sets the CSP on the response.
5. Continues refreshing Supabase auth state in the same proxy flow.

Keep other static security headers in `next.config.ts`, but intentionally do not define CSP there.

## Rationale

### CSP needs a per-request nonce

A nonce is only meaningful if it changes per request. A static CSP in `next.config.ts` cannot provide that.

### Static and dynamic CSP headers would combine

Browsers enforce the intersection of multiple CSP headers. A static CSP from `next.config.ts` plus a nonce CSP from `proxy.ts` could unintentionally cancel the nonce-based exception and break intended scripts.

### JSON-LD still needs CSP handling

`script-src` governs `<script>` elements regardless of type. JSON-LD script tags therefore need the nonce even though they are not executable JavaScript.

### Supabase SSR and CSP belong in the same request boundary

The proxy already refreshes Supabase auth state. Generating and forwarding the nonce in the same request boundary keeps security and rendering state aligned.

## Consequences

### Positive

- Provides a stronger CSP than allowing arbitrary inline scripts.
- Avoids static CSP conflicts in `next.config.ts`.
- Supports Next.js rendering requirements.
- Allows nonce-bearing JSON-LD for SEO pages.
- Keeps security headers centralized between `proxy.ts` and `next.config.ts`.

### Negative

- Pages that need the nonce cannot be purely static.
- CSP behavior is more complex than a static header.
- Developers adding script tags must remember to use the nonce.
- The proxy becomes security-critical infrastructure.
- Development mode requires `'unsafe-eval'`.

## Related implementation

Nonce-based CSP is implemented in:

- `proxy.ts`

Static non-CSP security headers are implemented in:

- `next.config.ts`

JSON-LD nonce usage appears on pages such as:

- `app/banks/[slug]/page.tsx`

The decision is documented in:

- `PROJECT.md`

## Rejected alternatives

### Static CSP in `next.config.ts`

Rejected because it cannot generate a fresh nonce per request and can conflict with the dynamic CSP.

### Allowing unsafe inline scripts globally

Rejected because it weakens the primary protection CSP is meant to provide.

### Removing JSON-LD

Rejected because structured data is part of the project's SEO and trust strategy.

### Hash-based CSP only

Rejected for now because framework-managed and dynamic script content makes nonce-based CSP more practical.

## Validation

`proxy.ts` generates and forwards a per-request nonce, sets `Content-Security-Policy` on both request and response flow, and refreshes Supabase session state.

`next.config.ts` explicitly documents why CSP is not configured statically there.

Bank profile JSON-LD reads `x-nonce` from request headers and applies it to the JSON-LD script tag.

## Future considerations

- Add tests or smoke checks that verify CSP is present in production responses.
- Document how new pages/components should access and apply the nonce.
- Review whether `style-src` nonce handling remains sufficient as UI dependencies evolve.
- Periodically audit CSP directives as new third-party integrations are added.
