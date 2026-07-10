# ADR-0004: Public API Subdomain and Legacy API Redirects

- Status: Accepted
- Decision date: 2026-07-08
- Last validated against repository: 2026-07-09
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: public read-only API routing, SEO exclusion, and CORS behavior
- Primary implementations: `next.config.ts`, `lib/apiResponse.ts`, `lib/siteConfig.ts`

## Context

InstantRailCheck exposes a public read-only API for banks, routes, and changelog data.

The original API paths lived under the main website origin as `/api/*`. Later, `api.instantrailcheck.com` was added as a cleaner public API origin.

The API subdomain is a separate origin. It does not inherit the main site's `robots.txt`, and clean API paths such as `/banks` or `/changelog` overlap with real website pages on the main domain.

The project needed an API subdomain without breaking existing `/api/*` integrations or accidentally making API responses indexable.

## Decision

Serve the public API through `api.instantrailcheck.com` using host-based rewrites on the same Next.js deployment.

1. Define canonical site and API origins in `lib/siteConfig.ts`:
   - `SITE_URL = https://www.instantrailcheck.com`
   - `API_URL = https://api.instantrailcheck.com`

2. In `next.config.ts`, rewrite requests for `api.instantrailcheck.com/:path*` to `/api/:path*`.

3. Use a `beforeFiles` rewrite phase.
   - Clean API paths like `/banks` conflict with real app pages.
   - `beforeFiles` ensures the host-based API rewrite wins before normal page matching.

4. Keep legacy main-domain `/api/*` paths working through redirects.
   - Known legacy hosts (`www.instantrailcheck.com`, `instantrailcheck.com`) redirect to the API subdomain.
   - Every other host (the API subdomain itself, localhost, Vercel previews) is left alone rather than redirected.
   - Redirects use HTTP 308.

5. Never redirect CORS preflight requests.
   - `OPTIONS` receives a direct 204 response.
   - Some browsers refuse to follow redirected preflight requests.

6. Add CORS headers to API responses:
   - `Access-Control-Allow-Origin: *`
   - `Access-Control-Allow-Methods: GET, OPTIONS`

7. Apply `X-Robots-Tag: noindex` to every API response regardless of host or path.

8. Provide subdomain-specific robots handling so the API origin is not accidentally crawlable.

## Rationale

### The API deserves a stable public origin

A dedicated API subdomain is clearer for developers than main-site `/api/*` paths and separates machine-facing routes from human-facing pages.

### Same deployment keeps operations simple

The API does not currently require a separate service, scaling model, or deployment pipeline. Host-based rewrites provide the cleaner URL without extra infrastructure.

### `beforeFiles` avoids route collisions

Paths like `api.instantrailcheck.com/banks` should resolve to `/api/banks`, not the website's `/banks` page. The rewrite must run before normal filesystem/app route resolution.

### Legacy redirects preserve compatibility

Existing `/api/*` integrations should not break. Redirecting known main-domain API paths retires the old public shape while keeping consumers functional.

### Preflight redirects are unsafe for compatibility

CORS preflight behavior differs across clients. Returning a direct preflight response is more reliable than redirecting `OPTIONS`.

### API responses should not be indexed

API JSON/CSV responses are not SEO pages. `X-Robots-Tag: noindex` protects against indexing even when crawlers ignore or bypass robots.txt.

## Consequences

### Positive

- Gives API consumers a clean canonical base URL.
- Avoids a separate deployment.
- Preserves old `/api/*` integrations.
- Prevents API content from becoming an SEO surface.
- Keeps CORS behavior simple for public read-only endpoints.

### Negative

- Host-based routing makes local/preview behavior more nuanced.
- Redirect logic must avoid loops on the API subdomain, localhost, and Vercel previews.
- Rate limiting (`lib/rateLimit.ts`) is applied per-route rather than centrally in the rewrite/redirect layer — a new API route must remember to call it, or it ships without protection.
- Documentation must consistently use the API subdomain to avoid mixed examples.

## Related implementation

Canonical URLs live in:

- `lib/siteConfig.ts`

Host-based API rewrites live in:

- `next.config.ts`

CORS, noindex, preflight handling, and legacy redirects live in:

- `lib/apiResponse.ts`

Rate limiting, applied per-route ahead of each handler, lives in:

- `lib/rateLimit.ts`

Subdomain-specific robots handling lives in:

- `app/api/robots.txt/route.ts`

## Rejected alternatives

### Keep only main-domain `/api/*`

Rejected because it is less clear for API consumers and mixes public API identity with website routing.

### Deploy the API as a separate service

Rejected for now because the API shares the same data model and does not yet need independent scaling or release management.

### Use `afterFiles` rewrites

Rejected because real app routes like `/banks` would win before the API rewrite could apply.

### Redirect CORS preflight requests

Rejected because redirected preflight requests can fail even when the actual request would succeed.

### Rely only on robots.txt

Rejected because API responses should carry `X-Robots-Tag: noindex` directly regardless of hostname or crawler behavior.

## Validation

`next.config.ts` uses a `beforeFiles` host rewrite from `api.instantrailcheck.com/:path*` to `/api/:path*` (commit `0822175`, 2026-07-08).

`lib/apiResponse.ts` applies CORS headers and `X-Robots-Tag: noindex`, answers preflight requests directly, and redirects only known legacy main-domain API hosts — confirmed wired into all four route handlers (`app/api/banks/route.ts`, `app/api/banks/[id]/route.ts`, `app/api/changelog/route.ts`, `app/api/routes/route.ts`), not just defined and unused.

`lib/siteConfig.ts` defines both the site and API canonical origins.

`app/api/robots.txt/route.ts` returns `User-Agent: *` and `Disallow: /`, which the API subdomain rewrite serves as `api.instantrailcheck.com/robots.txt` (commit `11bfbfe`, 2026-07-08).

## Future considerations

- Version API paths if breaking API changes are introduced.
- Add automated checks for preflight behavior.
- Monitor whether the API eventually needs separate infrastructure.
- Consider more explicit API cache headers per endpoint.
- Keep developer documentation aligned with the canonical API subdomain.
- Consider moving rate limiting into a shared wrapper so new API routes get it by default instead of opting in per-route.
