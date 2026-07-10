# ADR-0005: SEO-Friendly Bank Slugs Over UUID Profile URLs

- Status: Accepted
- Decision date: 2026-07-07
- Last validated against repository: 2026-07-09
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: bank profile URLs and public API identity
- Primary implementations: `app/banks/[slug]/page.tsx`, `lib/bankProfile.ts`

## Context

InstantRailCheck originally exposed bank profile pages by UUID.

UUID URLs are stable and machine-friendly, but they are poor human-facing URLs. They do not communicate the institution name, are hard to remember, and carry no useful search terms.

Bank profile pages are one of the project's most important long-tail SEO surfaces. URLs like `/banks/chase` are more understandable and useful than UUID-based paths.

At the same time, existing UUID links may already have been shared or indexed, and the public API still needs stable machine identifiers.

## Decision

Use SEO-friendly slugs for human-facing bank profile pages while preserving UUID behavior through redirects and API contracts.

1. Bank profile pages use `/banks/[slug]`.
   - Example: `/banks/chase`.

2. Old UUID-style bank URLs are detected on the bank profile route.
   - UUID-looking slugs are matched with a UUID regex.

3. If a UUID maps to a bank, permanently redirect (308) it to the current slug URL.

4. If the UUID does not map to a bank, return not found.

5. Keep the public API ID-based.
   - `/api/banks/:id` keeps its existing ID-based contract, unchanged.
   - API responses now also include a `slug` field for consumers who want to build their own web URLs.

6. Treat slugs as the website-facing identity, not as the canonical database identity.

7. Store slugs on `banks.slug`.
   - Existing banks were backfilled by `scripts/backfill-bank-slugs.mjs`.
   - `banks.slug` is enforced unique (`supabase/migrations/20260708033539_add_bank_slugs.sql`) and `NOT NULL` (`supabase/migrations/20260708033648_require_bank_slug.sql`).

8. Generate slugs for newly added banks.
   - `slugify()` in `lib/utils.ts`: lowercase, trim, replace non-alphanumeric runs with `-`, trim leading/trailing dashes.
   - Collision handling appends numeric suffixes (`-2`, `-3`, ...) — same pattern in `scripts/backfill-bank-slugs.mjs` and client-side in `components/SubmitRouteReport.tsx`'s `handleAddBank`, and reused by the bulk import scripts (`scripts/import-fdic-banks.mjs`, `scripts/import-ncua-credit-unions.mjs`).

9. Update internal website links to use slugs.
   - Route search, bank directory, rails explorer (official and community-reported sections), changelog, timing leaderboard, compare, and sitemap all use slug URLs.
   - Compare's query param changed from `?banks=id1,id2` to `?banks=slug1,slug2`.
   - `route_reports` only stores denormalized `from_bank_id`/`from_bank_name`, not slug, so `lib/activityFeed.ts` and `lib/communityRails.ts` build an id→slug lookup map at read time rather than requiring a schema change.

## Rationale

### Bank pages are an SEO surface

Individual bank pages are likely to capture long-tail search demand. Human-readable URLs reinforce page relevance and make links more understandable.

### UUIDs are still useful for machines

UUIDs remain appropriate as stable database/API identifiers. The decision separates human-facing URLs from machine-facing identity.

### Redirects preserve existing links

A breaking URL change without redirects would create unnecessary 404s. Redirecting UUID paths protects shared links and indexed URLs.

### Slugs improve product polish

Readable URLs make the product feel more intentional and trustworthy, especially for pages users may share.

## Consequences

### Positive

- Improves human readability of bank profile URLs.
- Better aligns bank pages with SEO goals.
- Preserves old UUID links through redirects.
- Keeps API identity stable.
- Separates website navigation concerns from database identity.

### Negative

- Slug generation and collision handling become part of data integrity, duplicated across three call sites (`lib/utils.ts`, `scripts/backfill-bank-slugs.mjs`, `components/SubmitRouteReport.tsx`) rather than a single shared implementation.
- Bank renames can create slug-change questions (no rename-safe slug strategy exists yet).
- Redirect lookup adds a small amount of route complexity.
- Slugs are not globally meaningful outside the website context.
- API and website identity now intentionally differ.
- New-bank creation must coordinate slug generation and uniqueness.
- Pages driven by `route_reports` (activity feed, community rails, timing leaderboard) depend on a runtime id→slug lookup rather than a stored slug, since that table only denormalizes bank id/name.

## Related implementation

Bank profile routing and UUID-to-slug redirect:

- `app/banks/[slug]/page.tsx`

Bank profile lookup and slug/UUID resolution:

- `lib/bankProfile.ts`

Slug generation:

- `lib/utils.ts` (`slugify`)
- `components/SubmitRouteReport.tsx` (client-side generation + collision check for user-added banks)

Slug backfill for existing banks:

- `scripts/backfill-bank-slugs.mjs`

Slug generation during bulk import:

- `scripts/import-fdic-banks.mjs`
- `scripts/import-ncua-credit-unions.mjs`

Database constraints:

- `supabase/migrations/20260708033539_add_bank_slugs.sql` (unique index)
- `supabase/migrations/20260708033648_require_bank_slug.sql` (`NOT NULL`)

Runtime id→slug lookups for tables that only store denormalized bank id/name:

- `lib/activityFeed.ts`
- `lib/communityRails.ts`

## Rejected alternatives

### Keep UUID URLs for bank pages

Rejected because UUIDs are poor human-facing and SEO-facing URLs.

### Use slugs everywhere, including API identity

Rejected because slugs are presentation identifiers and may need to change. APIs should retain stable machine identifiers.

### Break old UUID links

Rejected because existing links and indexed URLs should not become 404s.

### Duplicate UUID and slug pages

Rejected because duplicate content would complicate canonicalization and SEO.

## Validation

`app/banks/[slug]/page.tsx` detects UUID-shaped route parameters via regex, resolves them to the current slug through `getBankSlugById`, and issues a permanent (308) redirect when a match exists; otherwise returns not found.

Normal profile rendering uses slug-based lookup (`getBankProfileBySlug`).

Commit `f554ba4` ("Switch bank URLs from UUIDs to SEO-friendly slugs", 2026-07-07) is the implementation commit: it renamed the route from `app/banks/[id]` to `app/banks/[slug]`, switched every internal link builder to slugs (route search, bank directory, rails explorer, changelog, timing leaderboard, compare, sitemap), changed compare's query param from id-based to slug-based, and added `getBankProfileById` alongside the new `getBankProfileBySlug` so `/api/banks/:id` kept working unchanged while gaining a `slug` field in responses.

The unique index and `NOT NULL` constraint on `banks.slug` are confirmed present in `supabase/migrations/20260708033539_add_bank_slugs.sql` and `20260708033648_require_bank_slug.sql`, both landing in the same commit/date as the rest of the feature.

## Future considerations

- Consolidate the three separate slug-generation call sites into one shared implementation.
- Add canonical URL metadata on bank pages — not currently present (`app/banks/[slug]/page.tsx` has no `alternates.canonical`).
- Track old slugs if future bank renames require redirect chains.
- Add tests for UUID redirects, missing UUIDs, and slug collisions.
