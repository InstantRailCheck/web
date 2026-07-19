# ADR-0005: SEO-Friendly Bank Slugs Over UUID Profile URLs

- Status: Accepted
- Decision date: 2026-07-07
- Amended: 2026-07-19 (v8 collision/lifecycle — see Amendment below)
- Last validated against repository: 2026-07-19
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: bank profile URLs and public API identity
- Primary implementations: `app/banks/[slug]/page.tsx`, `lib/bankProfile.ts`
- Related ADRs: [ADR-0006](0006-institution-synchronization.md) (duplicate legal names, which this ADR's collision handling exists to disambiguate, are created by the sync described there)

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

- ~~Slug generation and collision handling become part of data integrity, duplicated across three call sites (`lib/utils.ts`, `scripts/backfill-bank-slugs.mjs`, `components/SubmitRouteReport.tsx`) rather than a single shared implementation.~~ Resolved — see Amendment below.
- Bank renames can create slug-change questions (no rename-safe slug strategy exists yet — the sync preserves an existing slug through a source rename, but there is still no general redirect-history mechanism for a slug that changes any other way).
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

Slug generation (see Amendment below for the current, consolidated shape):

- `lib/slugify.ts` (`slugify`, `uniqueSlug` — the shared base implementation)
- `lib/institutionSlug.ts` (`institutionSlug` — deterministic state/regulator-identifier disambiguation for the FDIC/NCUA sync, built on top of `lib/slugify.ts`)

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

## Amendment (2026-07-19): v8 collision handling and lifecycle

**Consolidated slug generation.** The three duplicated call sites this ADR originally flagged no longer exist independently. `lib/slugify.ts` is now the one shared base implementation (`slugify()`, `uniqueSlug()`) — `lib/utils.ts` re-exports `slugify` from it rather than defining its own copy, `scripts/backfill-bank-slugs.mjs` imports from it directly, and `components/SubmitRouteReport.tsx` no longer contains any slug logic at all (it delegates bank creation to the `addBank()` Server Action). `lib/institutionSlug.ts`'s `institutionSlug()` is a newer layer built on top of `lib/slugify.ts` specifically for the FDIC/NCUA sync's collision needs (below) — it is not itself a fourth duplicated implementation, since it calls `slugify`/`uniqueSlug` rather than reimplementing them.

**Deterministic collision disambiguation for duplicate legal names.** Once duplicate legal names became a supported, expected state (see [ADR-0006](0006-institution-synchronization.md) — e.g. six separate Pinnacle Bank charters), a bare `slugify(name)` collision used to fall straight through to `uniqueSlug()`'s numeric suffix (`pinnacle-bank-2`, `pinnacle-bank-3`, ...) — correct, but meaningless to a reader and unstable if institutions are processed in a different order across runs. `institutionSlug()` now tries the bare name first, then `{name}-{state}-{identifier}` (e.g. `pinnacle-bank-tn-12345`, using the institution's own stable FDIC cert/NCUA charter number) on collision, falling through to `uniqueSlug()`'s numeric suffix only as the final safety net if even that collides.

**Staged validation.** The sync's staging table computes and validates each candidate's `proposed_slug` before `finalize_sync_run` applies anything — a genuine collision at staging time is a hard reject for that row, not a silently substituted slug. The database's unique index on `banks.slug` remains the final transaction-level guarantee regardless.

**Renames preserve the existing slug.** `finalize_sync_run`'s update path never writes `slug` for an existing bank — a source-reported name change updates `name` but leaves the bank's slug exactly as it was.

**Duplicate legal names are now structurally supported, not just tolerated.** There is no unique constraint on `banks.name` (the v8.0 schema migration actively drops any that existed) — only `banks.slug` is unique. This ADR's separation of "slug as website identity" from "database identity" is exactly what makes that possible.

**Canonical metadata now shipped.** `app/banks/[slug]/page.tsx`'s `generateMetadata` now sets `alternates: { canonical }` pointing at the bank's own canonical slug URL — the original "not currently present" future consideration is resolved.

**Still open:** there is no general slug-history/redirect table for a slug that changes for reasons other than the sync (which never changes an existing slug). If a slug ever needs to change outside the sync's preserve-on-rename behavior, that link would break today — this is unchanged from the original decision and remains a real gap, not resolved by anything above.

## Future considerations

- ~~Consolidate the three separate slug-generation call sites into one shared implementation.~~ Done — see Amendment above.
- ~~Add canonical URL metadata on bank pages~~ — done — see Amendment above.
- Track old slugs if future bank renames require redirect chains (still open — no such table exists).
- Add tests for UUID redirects, missing UUIDs, and slug collisions.
