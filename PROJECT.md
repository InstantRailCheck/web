# InstantRailCheck

## Mission

Build the most trusted crowdsourced database of real-world bank transfer compatibility.

## MVP Scope

InstantRailCheck answers one core question:

Can Bank A send money instantly to Bank B?

## Version 1 Features (v1.0.0 — shipped June 28 2026)

**Route search**
- Select any two banks (sender + receiver) via searchable combobox
- Rails categorized as Primary (RTP, FedNow) or Fallback (ACH, Wire, Zelle, Other, Unknown)
- Per-rail stats: success rate, average settlement time, direction (Push / Pull / Both), last tested date
- Stale warning shown when last report is older than 180 days
- Confidence level: HIGH (>50 reports), MEDIUM (>10), LOW otherwise
- Shows "no data yet" state for unknown routes

**Submit route report**
- Requires a signed-in account
- Fields: from bank, to bank, rail used, direction, status (success / failed / delayed), date tested, settlement time (optional), notes (optional)
- Users can add a bank inline if it doesn't exist yet
- Reports attributed to user account

**Accounts**
- Magic link + 8-digit OTP via email — no password required
- Session expires when browser is closed

## Version 1.1 Features (v1.1.0 — shipped July 8 2026)

**Bank profile pages**
- `/banks/[id]` shows sending/receiving rail stats, plus website, address, and phone
- `/banks` directory with name search and FedNow/RTP filters

**Official-source data enrichment**
- Banks: website + address from FDIC BankFind
- Credit unions: website + address + phone from NCUA's quarterly call report data (no live API exists; synced via `scripts/sync-ncua-directory.mjs`)
- Brokerages: address + phone from FINRA BrokerCheck (no official website field exists for broker-dealers in any regulatory source checked)
- Never guesses — a missing field beats a wrong one. Matching favors institution size/activity status to avoid mismatching common names

**Payment rail explorer**
- FedNow and RTP participation checked against the Fed's and The Clearing House's official participant lists when a bank is added
- `/rails` browses confirmed participants; badges shown on profile pages

**Compare, timing, and history**
- `/compare` — two banks side by side
- `/timing` — settlement time leaderboard by rail (min. 2 reports per bank+rail)
- `/changelog` — recent banks added and reports submitted, with a "first confirmed" badge

**Public API**
- `/api/banks`, `/api/banks/:id`, `/api/routes`, `/api/changelog` — read-only, CORS-enabled, documented at `/developers`
- Rate limited to 60 requests/minute per IP via an atomic Postgres counter; self-cleaning via `pg_cron`

**Security**
- `route_reports` inserts restricted to authenticated users, enforced to their own `user_id` (previously any anonymous client could insert and spoof `user_id`)
- RLS audited across all tables; no client-writable access to reference tables

## Version 1.2 Features (v1.2.0 — shipped July 8 2026)

**Zelle verification**
- No official API exists; Zelle's own "search" page turned out to be an unfiltered paginated directory of ~2,489 partner institutions, scraped via `scripts/sync-zelle-participants.mjs`
- Known limitation, disclosed in-app: Zelle's own directory is incomplete (confirmed — SoFi genuinely supports Zelle but isn't listed), so a missing badge doesn't mean a bank lacks support the way it does for FedNow/RTP
- Automated enrichment now never downgrades an already-`true` rail flag back to `false`, so a manual correction (like SoFi's) survives future re-syncs

**Visa Direct and Mastercard Send**
- No scrapable directory exists — both check capability per-card via BIN lookup APIs gated behind production partnership access (sandbox tiers only return synthetic test data)
- Added as self-reportable rail types instead, same as every rail before official verification existed
- Shown on `/rails` in a separate "Community-reported" section, clearly distinguished from the three officially-verified columns (min. 2 successful reports to appear)

## Version 2.0 Features (v2.0.0 — shipped July 8 2026)

**Bank URLs: UUIDs → SEO-friendly slugs (breaking URL change)**
- `/banks/[id]` is now `/banks/[slug]` (e.g. `/banks/chase`, not `/banks/c681154f-...`)
- Old UUID links redirect (308) to the slug URL rather than 404ing, so nothing already shared or indexed breaks
- The public API's `/api/banks/:id` contract is untouched (still ID-based for machine consumers), now also returns `slug` in responses
- Reasoning: UUIDs carry no search-relevant keywords; long-tail pages like individual bank profiles are the actual SEO surface area for a site like this, more so than homepage copy

**Correction workflow**
- Signed-in users can suggest a fix to a bank's website/phone; it's re-verified against the same FDIC/NCUA/FINRA sources used for enrichment before being applied — a match auto-applies, a mismatch is flagged for review instead of trusted blindly

**Webhooks (v1: `bank_added` event only)**
- Register a URL at `/webhooks` to get a signed POST (HMAC-SHA256) instead of polling `/api/changelog`
- Delivery-time SSRF protection: resolves the hostname and rejects loopback/private/link-local/cloud-metadata/CGNAT addresses, re-checked on every delivery (not just registration) to guard against DNS rebinding; redirects aren't followed
- No retries (fire once, log the result); max 5 webhooks per account

**Other additions**
- Same-Day ACH tracked as a report attribute (not a separate rail) — surfaces as "Same-Day ACH in N reports" within existing ACH stats
- CSV export (`&format=csv`) on `/api/banks` and `/api/changelog`
- `robots.txt` and a dynamic `sitemap.xml` covering every bank page
- Updated page title/meta description and homepage subheading for search relevance

## Version 2.1 Features (v2.1.0 — shipped July 8 2026)

**Bulk bank import**
- Imported the top 500 FDIC banks by asset size directly from FDIC's BankFind API, going from 11 to 483 banks — real official data, not crowdsourced growth, to address thin-content/SEO concerns
- Deduped against existing banks by normalized website (not name — FDIC's formal legal names differ from already-curated brand names) with in-memory slug/name collision handling
- `/banks` and `/rails` gained pagination (50/page) ahead of the ~44x increase in bank count
- NCUA credit union import (~4,336, already synced locally) explicitly deferred to v2.2

**Security hardening**
- Added HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, and a nonce-based Content-Security-Policy — nonce generated per-request in `proxy.ts` (this Next.js version's renamed middleware) rather than statically in `next.config.ts`, since a static CSP alongside it would combine via header intersection and cancel the nonce exception back out
- Nonces require dynamic rendering, so a few previously-static pages (`/developers`, `/webhooks`, `/not-found`) were forced dynamic
- Rate limiting now trusts Cloudflare's `CF-Connecting-IP` over a client-spoofable `X-Forwarded-For` first hop, since the site is proxied through Cloudflare

**Data-quality fix**
- Fixed a rail-participation matching bug where FDIC legal names with commas ("Capital One, National Association") produced a truncated candidate with a trailing comma still attached, missing otherwise-clean matches — corrected ~182 banks via backfill

## Version 2.2 Features (v2.2.0 — shipped July 8 2026)

**Full NCUA credit union import**
- Imported all 4,336 NCUA-chartered credit unions (already synced locally), taking the database from 483 to 4,671 institutions
- NCUA's raw name field has no institutional suffix for ~98% of entries ("WOODMEN", "CAMPUS") — normalized to Title Case with "Credit Union" appended where not already present

**Rail-matching false-positive fix**
- The substring-matching fallback was safe for FDIC's long formal names but broke down for short/generic ones — "US Bank" matched an unrelated "Pegasus Bank" via accidental character overlap across word boundaries, "Farmers" matched two dozen unrelated "Farmers ... Bank" entities
- Restricted substring matching to the complete untruncated name, required a whole-word boundary, and required exactly one distinct institution to match — ambiguous (multiple matches) now means no match, not a guess
- Corrected 141 banks whose stored true flags didn't hold up under the fix, including a live bug (US Bank's `rtp_participant` was only ever true because of the Pegasus Bank collision)

**Reliability fix**
- Bulk scripts reading the full `banks` table were silently truncated at Supabase's 1000-row default cap once the table crossed that threshold mid-import (caught when the first NCUA import run reported "Loaded 1000 credit unions" instead of 4,336); added proper `.range()` pagination

## Version 2.2.1 (v2.2.1 — shipped July 8 2026)

**Homepage/Compare search dropdown fixes** (user-reported, post-NCUA-import fallout)
- The homepage's route-search dropdown and the Compare page hit the same 1000-row Supabase cap as the backend scripts — ~3,600 banks past the first 1000 alphabetically silently never appeared as selectable options
- Separately, the dropdown never visibly highlighted an item while typing or arrow-navigating: cmdk sets `data-selected` to the literal string `"true"`/`"false"` (always present), but Tailwind's bare `data-selected:` variant matches on attribute presence, not value — fixed to `data-[selected=true]:`
- That CSS fix alone wasn't sufficient at scale — cmdk was still handed all 4,671 banks as raw DOM nodes (hidden via CSS, not removed), which made its own keyboard-highlight tracking unreliable. Now pre-filters client-side and caps the dropdown to 50 results before anything reaches cmdk

## Version 3.0 Features (v3.0.0 — shipped July 8 2026)

**Passkey sign-in**
- Sign-in modal now offers "Sign in with a passkey" as the primary option (native WebAuthn picker, no email needed), with the existing email-OTP flow as a fallback
- New `/account` page lets a signed-in user register, rename, and delete passkeys
- Built on Supabase Auth's passkey API (officially supported, explicitly experimental — the API may change without notice per Supabase's own docs); requires the Relying Party ID/origins configured in the Supabase dashboard
- Registering a passkey requires an existing signed-in session (add-a-passkey-to-your-account, not create-account-via-passkey-alone), matching the existing email-OTP-first auth model

**Researched and declined**
- ABA/routing-number bulk import: unlike every other source used so far (FDIC, NCUA, FedNow, RTP, Zelle), the Fed's E-Payments Routing Directory requires FedLine-connected institution status or a paid banking-partner download code, and its terms prohibit commercial use — no clean free alternative found. Wire transfers stay self-reported (verification wouldn't meaningfully differentiate banks anyway, since Fedwire eligibility is near-universal for regulated US banks)

## Version 3.0.1 (v3.0.1 — shipped July 8 2026)

**Sitemap fix**
- `sitemap.xml` hit the same 1000-row Supabase cap as the homepage/Compare dropdowns, just discovered later — verified live on production (1007 `<url>` entries) before fixing; search engines were never seeing ~3,671 of 4,671 bank pages

**Hardening/housekeeping**
- `robots.txt` now disallows `/account` (the new passkey-management page), matching the existing `/webhooks` exclusion — no SEO value, and it can show the signed-in user's email
- Added `security.txt` (RFC 9116) at `/.well-known/security.txt` with a redirect from the legacy `/security.txt` path; expires July 2027 and needs refreshing by then
- Added a web app manifest (`/manifest.webmanifest`, auto-linked by Next.js) — enables "Add to Home Screen" with the site's name, dark theme color, and icon

## Version 3.0.2 (v3.0.2 — shipped July 8 2026)

**API subdomain**
- Added `api.instantrailcheck.com` as a cleaner alias for the public API — same deployment, same routes, via a `beforeFiles` rewrite mapping `api.instantrailcheck.com/banks` to `/api/banks` internally (had to be `beforeFiles` specifically, since the clean paths collide with real pages like `/banks`/`/changelog` that the default `afterFiles` phase would resolve first)
- The subdomain is a separate origin and doesn't inherit the main domain's `robots.txt` — added a dedicated disallow-all for it, plus `X-Robots-Tag: noindex` on every API response regardless of hostname
- The old `www.instantrailcheck.com/api/*` paths now 308-redirect to the subdomain (retired without breaking existing integrations) — scoped to the known legacy hosts only, so the subdomain's own rewrite, localhost, and preview deployments aren't caught in a redirect loop. CORS preflight (OPTIONS) requests are always answered directly, never redirected, since some browsers refuse to follow a redirected preflight

## Version 3.0.3 (v3.0.3 — shipped July 8 2026)

**Docs cleanup**
- Removed the "old paths still work" disclaimer from `/developers` — no known usage of the legacy paths yet, so nothing to reassure (the redirect itself stays in place regardless, as a harmless safety net)
- Fixed a stray `/api/changelog` reference in the webhooks section that got missed when the rest of the page moved to the `api.instantrailcheck.com` style

## Version 4.0 Features (v4.0.0 — shipped July 8 2026)

**Google sign-in**
- "Continue with Google" as a third sign-in option alongside passkeys and email OTP, via Supabase Auth's OAuth flow
- New `/auth/callback` route exchanges the OAuth code for a session; verified the installed auth-js version (2.108.2) isn't affected by a since-fixed upstream bug where a deferred `SIGNED_IN` event could cause cookie loss in SSR/serverless (supabase-js#2037)
- Failed exchanges redirect home with a visible error banner instead of failing silently
- Requires Google OAuth credentials configured in both Google Cloud Console and the Supabase dashboard, plus an OAuth consent screen with an app name/logo and Privacy Policy/Terms links to avoid showing Supabase's raw project URL to users

**Privacy Policy and Terms of Service**
- New `/privacy` and `/terms` pages, written to reflect what the app actually does (Supabase/Vercel/Google/Cloudflare as data processors, no ad tracking, cookie-free analytics) — required for the Google OAuth consent screen branding above

## Version 4.0.1 (v4.0.1 — shipped July 8 2026)

**Sign-in modal copy**
- Reassurance line under "Continue with Google" clarifying it only verifies identity — no Gmail/Drive/other Google data is ever requested (accurate: no `scopes` option is passed to `signInWithOAuth`)
- Disclaimer under "Sign in with a passkey" explaining the account prerequisite — passkey registration requires an existing signed-in session, so first-time users need to sign in via Google or email first, then add a passkey from `/account`

## Version 4.0.2 (v4.0.2 — shipped July 8 2026)

**Sign-in modal icons**
- Added Google's official multi-color G logomark to the "Continue with Google" button
- Added a generic key icon (lucide-react's `KeyRound`) to the passkey button — deliberately not a vendor-specific logo like YubiKey, since passkeys are a broad WebAuthn standard satisfied by many things (Face ID, Touch ID, Windows Hello, or a physical security key), and most sign-ins won't involve a YubiKey specifically

## Version 4.0.3 (v4.0.3 — shipped July 8 2026)

**Zelle visual consistency**
- Standardized Zelle's icon (💸) and color (violet, its signature brand color) across every page it appears — RouteSearch's rail badges were missing an icon for Zelle entirely, and `/banks` used blue while every other page already used violet
- Deliberately generic/non-trademarked treatment, not Zelle's actual stylized logo — their trademark guidelines only extend fair use to plain-text references, not logos, and InstantRailCheck isn't a licensed Zelle partner

## Version 4.1 Features (v4.1.0 — shipped July 8 2026)

**Trust and evidence infrastructure**
- New `/methodology` page explaining the site's actual data principles, official-source-per-rail breakdown, the word-boundary/uniqueness name-matching approach, confidence tiers, and the never-downgrade correction guard
- JSON-LD structured data: `BankOrCreditUnion` schema on bank profile pages, `WebSite`/`SearchAction` on the homepage — both carry the request's CSP nonce explicitly, since script-src governs any `<script>` element regardless of type under this site's nonce-based CSP
- Source citations on bank profile pages (FDIC BankFind vs NCUA's quarterly call report data), kept categorical rather than per-field since the schema doesn't track which specific source backed which field
- `bank_rail_history` table + trigger, capturing every change to fednow/rtp/zelle participation regardless of which code path makes it — not displayed anywhere until now, started collecting ahead of building on it so the data wouldn't be unrecoverably lost
- Bank profile pages now show per-rail evidence cards (Source, Confirmed as of, Community confirmations) instead of plain pill badges — deliberately no fabricated per-rail "Confidence" score, since the existing HIGH/MEDIUM/LOW tiers are a route-level crowdsourced-report-volume concept, not a per-rail per-bank one
- Supabase CLI added as a dev dependency and linked to the project, so migrations can be pushed directly instead of pasted into the dashboard SQL editor by hand

## Version 4.1.1 (v4.1.1 — shipped July 8 2026)

**Evidence card layout fix**
- Fixed an orphaned-word wrap on rail evidence card labels — long source text under narrow 3-column cards left the last word alone on its own right-aligned line; stacked label-above-value instead

## Version 4.1.2 (v4.1.2 — shipped July 8 2026)

**Clickable evidence sources**
- FedNow and RTP source labels on rail evidence cards now link to the actual official source, using the exact URLs already verified in `scripts/sync-rail-participants.mjs`
- Zelle deliberately left as plain text — its "source" is a paginated search endpoint, not a page meaningful to click into

## Version 4.1.3 (v4.1.3 — shipped July 8 2026)

**Polish pass**
- FedNow source link now points to the landing page (frbservices.org's organizations page) instead of triggering a direct XLSX download
- "Confirmed as of" pulled out into its own highlighted pill with a calendar-check icon on rail evidence cards, rather than blending into the rest of the metadata
- Rail color scheme (purple=FedNow, green=RTP, blue=ACH, violet=Zelle) extended to `/rails` (including fixing FedNow/RTP's color-blind emoji icons there) and `/changelog`
- Added a persistent clickable logo header on every page except the homepage (which already has its own large Hero logo, now also clickable) — centered, sized roughly half the Hero logo

## Version 4.2.0 (v4.2.0 — shipped July 8 2026)

**Sort by institution size, backed by a real asset backfill**
- New `total_assets` column on `banks` and `ncua_credit_unions`, sourced from FDIC's `ASSET` field and NCUA's `ACCT_010` (the standard 5300 call report Total Assets account code, cross-checked against Navy Federal's real reported figure before trusting it)
- `scripts/backfill-bank-assets.mjs` matches each bank against FDIC/NCUA data using the same word-boundary + uniqueness-of-1 approach used elsewhere in the codebase, adapted for in-memory matching against thousands of institutions; genuinely ambiguous names (multiple real institutions sharing one legal name, e.g. 4 distinct "United Bank" charters) are correctly left blank rather than guessed — 4,515 of 4,670 banks (96.7%) matched
- `/rails`' FedNow/RTP/Zelle columns now sort by `total_assets DESC NULLS LAST` instead of alphabetically, so the largest participating institutions surface first
- Along the way, found and fixed two matching bugs: a naive name→value map was silently collapsing legitimate duplicate-name collisions to an arbitrary (sometimes wrong) value instead of recognizing them as ambiguous; and a comma/period-stripping mismatch between candidate names and source data was causing near-universal false negatives on ", National Association"-suffixed names (Capital One, Citibank, BankUnited, and others)
- Renamed 8 early hand-entered banks (Chase, Bank of America, Wells Fargo, US Bank, SoFi, BECU, WSECU, Schwab, American Express Rewards Checking) to their precise FDIC/NCUA legal names — resolves their total_assets via exact match instead of an ambiguity-prone fuzzy fallback, and brings them in line with how every other bank in the directory is named. Slugs were kept unchanged so existing links still resolve
- Deleted "Fidelity CMA" — a brokerage cash-sweep product, not a single chartered bank, so it never had a legitimate place in a directory of banks

## Version 4.5.0 (v4.5.0 — shipped July 9 2026)

**Scheduled data sync + a site-wide cosmetic pass**
- New GitHub Actions workflow (`.github/workflows/sync-data.yml`): weekly resync of FedNow/RTP/Zelle participant lists, monthly resync of NCUA's directory and the `total_assets` backfill — both also manually triggerable
- Fixed `sync-ncua-directory.mjs`'s hardcoded quarter default (would've kept re-fetching the same stale quarter forever under a cron) by auto-detecting the latest published quarter, and added retry-with-backoff after a flaky connection to ncua.gov from a GitHub Actions runner
- Rewrote `backfill-rail-participation.mjs` to match entirely in memory instead of one Supabase round-trip per word per bank — a full run dropped from 35+ minutes (still running when first tested unattended) to under 2 minutes
- New read-only `scripts/audit-bank-info.mjs`: diffs stored website/address/phone against fresh FDIC/NCUA data without writing anything. Caught and fixed a real bug while building it — an initial version's cross-source fallback produced wrong matches (e.g. "Five Star Bank" compared against an unrelated credit union); current version reports 0 mismatches across all 4,670 banks
- Homepage: moved nav links from under the search box to the page footer, unified "Submit Route Report" and "Report early direct deposit" to look identical, centered box titles/forms, fixed the subtitle to render on one line (full sentence on desktop, a shorter version on mobile, since the full sentence can't fit at any legible size on a phone screen)
- Extended the same centering treatment to every subpage's title and matching forms (`/compare`'s bank picker, `/banks`' filter bar), and centered the rail explorer's remaining column titles
- Replaced the "← Back to search" link at the top of every subpage with the homepage's full nav footer (new shared `SiteFooterLinks` component) — the persistent header logo already covers the "back to home" case. Added Privacy/Terms links to that footer, on their own line so they always stay together

## Version 5.0.0 (v5.0.0 — shipped July 10 2026)

**Security audit, real test coverage, ADR-driven architecture docs, and lint enforcement**

This release starts with a full security pass of every API route and RLS policy — three real, fixed vulnerabilities — and closes with the codebase's first enforced quality gate in CI. Also the first release built alongside `docs/adr/`, five Architecture Decision Records documenting *why* key decisions were made, cross-checked line-by-line against the actual implementation and commit history before merging (a collaboration with ChatGPT via its GitHub connector, which now handles independent review rather than authoring).

**Security fixes**
- `banks`' RLS INSERT policy had no column restrictions — any authenticated user could insert a row directly with `fednow_participant`/`rtp_participant`/`zelle_participant`/`total_assets` set to whatever they wanted, fabricating a fully "verified" bank from scratch. Removed the policy entirely; adding a bank now goes through a new authenticated server action (`lib/actions/addBank.ts`) using the service role instead
- `enrichBank.ts` was an unauthenticated Server Action that trusted a caller-supplied bank name independent of the bank ID — directly callable regardless of the UI's sign-in gate, since client-side conditional rendering isn't a security boundary for Server Actions. Let anyone overwrite an arbitrary bank's contact info/rail flags with a *different* institution's real data. No longer `"use server"`; derives the name from the bank ID server-side instead
- `triggerWebhooks.ts` was also an unauthenticated Server Action. Since it signs whatever payload it's given with each subscriber's real HMAC secret, anyone could forge a validly-signed `bank_added` delivery to every registered webhook. No longer `"use server"`
- Added `import "server-only"` to all three so an accidental client-side import fails loudly at build time instead of subtly

**Test coverage (previously none)**
- Added Vitest and 69 tests across the areas identified as fragile: slug generation, CSP header construction, legacy API redirects, rate-limit IP extraction, webhook SSRF protection (mocked DNS, including boundary tests on every private/reserved IP range), and the new `withApiProtection`/`addBank` logic
- All pure unit tests, no live DB dependency — verified by running the suite with `.env.local` removed entirely
- `.github/workflows/test.yml` runs the suite, a type-check, and (as of this release) lint on every push and PR

**Architecture Decision Records**
- `docs/adr/0001` through `0005`: conservative institution name matching, webhook SSRF protection, nonce-based CSP, the public API subdomain, and SEO-friendly bank slugs
- `docs/adr/README.md` documents two recurring date pitfalls found while reviewing drafts: migration filenames are UTC and can read a day ahead of `git log`'s local time, and `PROJECT.md` version headers record release dates, not necessarily the commit date of every change bundled into a release

**ADR follow-through**
- Consolidated slug generation (previously duplicated across four files) into `lib/slugify.ts`
- Added real per-bank canonical URL metadata to bank profile pages (previously every page shared the same generic site-wide title)
- New `withApiProtection` wrapper closes the "a new API route might forget to add rate limiting" gap called out in ADR-0004 — all four routes now get it by default instead of opting in per-route

**Lint enforcement**
- Fixed all 54 pre-existing lint errors before turning on `npm run lint` in CI (turning it on first would have made every future push fail immediately for unrelated reasons). Found two real bugs in the process: a type-safety gap in `bankProfile.ts` that an `any` had been masking, and a genuine race condition in `PasskeyManager.tsx` where a stale passkey-list response could overwrite state after the signed-in user changed

**Cosmetic**
- Centered the bank info block (name, website, address, phone) and the rail evidence/sending/receiving card rows on bank profile pages — previously grid-based layouts left a lopsided-looking row whenever a bank had fewer than the maximum number of cards

## Version 5.0.1 (v5.0.1 — shipped July 10 2026)

- Centered the "Sending from"/"Receiving into" section headers on bank profile pages, missed in v5.0.0's card-centering pass

## Version 5.0.2–5.0.3 (v5.0.2–v5.0.3 — shipped July 9 2026)

- v5.0.2: housekeeping only — synced `package-lock.json`'s version field to `package.json` (no functional change)
- v5.0.3: centered the "No reports yet" empty state on bank pages

## Version 5.1 Features (v5.1.0–v5.1.3 — shipped July 9 2026)

**Compare page depth**
- Added Early Direct Deposit and community-reported rail (Visa Direct, Mastercard Send) rows to the bank comparison table, always shown (not just when data exists) so the two banks' row sets never differ
- Reordered rows so Visa/Mastercard follow the three officially-verified rails, with EDD last
- Bank website is now clickable on the compare page, matching the profile page

## Version 5.2 Features (v5.2.0–v5.2.2 — shipped July 9 2026)

**Contact info polish**
- Phone numbers are tap-to-call (`tel:` links) on both bank profile and compare pages
- Guarded against rendering an `href`-less `<a>` for a malformed phone number
- Renamed compare picker labels from "Bank A"/"Bank B" to "First bank"/"Second bank"

## Version 5.3 (v5.3.0 — shipped July 9 2026)

- Added non-affiliation disclaimers to `/methodology` and `/terms` — the site isn't affiliated with any bank, FedNow, RTP, Zelle, Visa, or Mastercard

## Version 5.4 (v5.4.0–v5.4.1 — shipped July 9 2026)

- Moved site nav to the top of every page (previously only a footer); Privacy/Terms links stay in the footer on `/terms` and `/privacy` specifically
- v5.4.1: corrected a version-tagging mistake (a commit had been tagged `v5.5.0` in error; retagged `v5.4.1`)

## Version 5.5 Features (v5.5.0–v5.5.4 — shipped July 9 2026)

**Nav and header visual pass**
- Site nav links restyled as buttons instead of arrow-suffixed text links
- Header logo enlarged (h-16 → h-28), one step below the homepage hero logo
- Added "Submit report" as the first nav link, pointing to `/#search`
- Kept nav links on one line instead of wrapping on narrower viewports
- Centered the "Check a transfer route" heading over the dropdowns rather than the button

## Version 5.6 (v5.6.0–v5.6.2 — shipped July 9 2026)

- Swapped "wire" for "Zelle" in the homepage's "How it works" copy (more representative of common use)
- Fixed a page-wide horizontal scroll on mobile caused by the homepage nav, plus a grid layout regression from the prior release's heading-centering change
- Shrunk the header logo (h-28 → h-20) to fix visible softness at the larger size — later fully resolved in v5.7.0 by switching to a vector asset

## Version 5.7 Features (v5.7.0–v5.7.3 — shipped July 9 2026)

**Vector logo and full home-screen icon set**
- Replaced the raster logo/favicon with vector versions (`logo.svg`/`favicon.svg`), resolving the header-logo softness noted in v5.6.2 — the h-20 header size is no longer a hard ceiling
- Regenerated `app/favicon.ico` from the new logo (the old one had survived untouched since before the redesign)
- Added `apple-touch-icon` for iOS "Add to Home Screen" and fixed Android's version of the same via the real manifest route
- Removed now-unused static logo assets; updated `README.md` to match the site's actual current features and schema

## Version 5.8 Features (v5.8.0–v5.8.1 — shipped July 9–10 2026)

**Bank search overhaul**
- Replaced the embedded full bank directory (shipped to every client) with a debounced, API-backed search (`/api/bank-search`) plus loading feedback — avoids re-hitting the earlier 1000-row/4,671-bank scale problems on the client
- Fixed a punctuation-sensitive search bug (e.g. "Chase" not matching "Chase Bank, N.A." style names) on the homepage first, then found and fixed the identical bug on `/banks` and `/api/banks`

## Version 5.9 Features (v5.9.0–v5.9.1 — shipped July 10 2026)

**Route reports from bank pages + form consistency pass**
- Route report submission is now available directly from individual bank profile pages, not just the homepage
- Labeled the sender/receiver toggle explicitly for accessibility
- A long visual-consistency pass across `Select`, `BankSelect`, and the date picker: matched heights, corner radii, font weight, and placeholder contrast; centered every label/control in Submit Route Report and the homepage EDD form; replaced the native `<select>` with shadcn's `Select` and the native date `<input>` with a custom `DatePicker` for real style parity across browsers
- v5.9.1: fixed report-submission bugs surfaced by new component tests, plus a residual `DatePicker` box-height mismatch against sibling fields

## Version 6.0.1 Features (v6.0.1 — shipped July 10 2026)

**Breaking API change: evidence states replace confidence/success-rate**
- `/routes`' `confidence` (a raw report-count threshold reaching HIGH/MEDIUM/LOW from as few as one unattributed or repeat-reporter report) and every rail's `successRate` are removed. Replaced by `lib/routeConfidence.ts`: exclude unattributed (`user_id` null) reports, keep only each reporter's newest report per route+rail, classify the remainder into one of 7 evidence states within a 180-day freshness window. A route/rail with no attributable evidence is simply absent from the response ("blank over wrong"), not shown with a placeholder
- `lib/bankProfile.ts`'s per-rail `successRate` (bank pages, compare page, `/banks/:id`) had the identical raw-count flaw — replaced with the same descriptive evidence approach (attributable/successful/delayed/unsuccessful counts, distinct routes, latest observation date)
- `X-Api-Version` response header bumped to 6; evidence states and the removed/replaced fields documented on `/developers`

**Community contribution loop**
- A route search with no attributable evidence now offers a clear path to become the first reporter; a checked route is shareable/bookmarkable via `?from=<slug>&to=<slug>`
- New `HomeRouteChecker.tsx` orchestrator centrally owns the homepage's from/to/result/loading state (previously split, uncoordinated, across `RouteSearch` and `SubmitRouteReport`); `SubmitRouteReport` gained a coordinated/prefilled mode that stays fully editable and preserves selections after a successful submit

**Other**
- Accessibility: associated form labels with their controls, added `aria-pressed` to the sender/receiver role toggle
- Added `Organization` JSON-LD structured data with logo, for Google knowledge panels
- Fixed unreadable first-option text when a `Select` dropdown opens
- CI: pinned `@swc/helpers` to resolve an `npm ci` lockfile conflict, bumped `actions/checkout`/`actions/setup-node` to clear a Node 20 deprecation warning, fixed remaining lint warnings

## Version 6.0.2 (v6.0.2 — shipped July 10 2026)

- Fixed two state bugs in the new contribution loop, found via ChatGPT's review of v6.0.1: changing a bank selection left the previous route's evidence visible on screen instead of clearing immediately, and editing a prefilled report's banks before submitting caused the parent to refetch the stale original route instead of the one actually submitted

## Version 6.1 Features (v6.1.0 — shipped July 10 2026)

**Security: server-only reads + RLS lockdown**
- `route_reports`/`edd_reports` were being read directly from the browser with the anon key; moved every consumer to a server-only admin-client read path and fixed 5 raw-count/no-dedup aggregation bugs found in the resulting audit
- Dropped all non-INSERT RLS policies on both tables (including an undocumented UPDATE/DELETE policy created outside migration tracking) — the privacy boundary is now enforced by the database itself, not just by what the UI chooses to query

**Payroll context for Early Direct Deposit**
- Reporters can optionally note the deposit type and payroll provider/platform behind an early deposit (`lib/eddContext.ts` is the canonical value list, shared by the form, aggregation, and docs)
- Bank pages surface provider-specific evidence (e.g. "ADP payroll deposits were reported 2 days early by 6 distinct reporters") once a provider has at least 3 distinct reporters — stricter than the 2-reporter threshold for overall EDD evidence, since naming a specific company is more identifying
- Non-payroll deposit types (government benefits, tax refunds, pensions) never contribute to a provider's count, even when a provider is recorded alongside them (e.g. "government_treasury" on a tax refund is a legitimate thing to record but never becomes a payroll-provider claim)
- Wording rule: provider evidence describes what was reported, never what caused it — "were reported N days early by M reporters," not "arrive N days early" or any phrasing implying the provider caused the timing. Applies everywhere evidence appears (bank pages, `/developers` docs, future surfaces)

## Version 6.1.1 (v6.1.1 — shipped July 10 2026)

**Hardening fixes, per ChatGPT's review of v6.1.0**
- `computeEddProviderEvidence()` counted one reporter multiple times toward the 3-reporter provider threshold if they'd submitted the same provider under different eligible deposit types (e.g. paycheck, gig_platform, other) — the per-context dedup correctly kept each as a distinct row, but the provider-level count needs one row per *person*, not per experience. Added a second collapse-by-`user_id` pass before the threshold check and the displayed average
- `/changelog` (`lib/activityFeed.ts`) showed raw, unattributed route reports as if they were genuine community activity, and could assign "first confirmed" to the first successful row from a bank on a rail regardless of which bank received it. Now requires `user_id` (matching the attributable-evidence rule used everywhere else on the site) and scores "first confirmed" per directional route+rail, the same unit `routeConfidence.ts` uses
- `lib/supabase/admin.ts` (the service-role client factory) now imports `"server-only"` directly, so an accidental client-side import of the credential-bearing module fails at build time instead of relying on every caller to remember the rule

## Version 6.1.2 (v6.1.2 — shipped July 11 2026)

**Hardening fixes, per ChatGPT's continued review of `d6c2fc3`**
- Discovered while investigating the client-IP finding below: **the production deployment is not actually behind Cloudflare** — verified directly (DNS resolves to Vercel's own network, no Cloudflare fingerprint on any response header), contradicting v2.1.0's original assumption. `CF-Connecting-IP` was therefore fully attacker-controlled and rate limiting was bypassable with one spoofed header. `getClientIp()`/a new `getClientIpFromServerAction()` now trust Vercel's own `x-vercel-forwarded-for` (which Vercel documents as authoritative and not client-overridable) instead
- `route_reports` predates complete migration tracking and had zero CHECK constraints — only a PK and FKs. Added constraints matching what the UI already restricts (status/rail/direction enums, a sane settlement-time range, tested_at not future-dated, distinct sender/receiver, notes length cap), plus a trigger that derives `from_bank_name`/`to_bank_name` from the referenced bank row instead of trusting whatever the client sent (previously nothing verified a submitted name matched the bank ID it claimed). Added matching length caps to `banks.name` and `bank_corrections.submitted_value`, the other client-writable free text fields
- Evidence dedup prevents one account from inflating public reporter counts, but nothing stopped a signed-in account from submitting indefinitely — added a per-user rolling quota (20 route reports / 10 EDD reports per 10 minutes) enforced by a trigger directly on `route_reports`/`edd_reports`, since direct browser inserts bypass Server Actions entirely
- `addBank`/`submitCorrection`/`registerWebhook` had no throttling of their own (each triggers real external lookups or webhook delivery) — added `isActionRateLimited()`, checked by both user ID (primary) and IP (secondary)
- Webhook SSRF: `isUrlSafeForWebhook()` validated a resolved IP, then delivery's separate `fetch()` re-resolved DNS independently — a classic rebinding TOCTOU window. Delivery now pins the connection to the exact validated address via a custom `undici` dispatcher, while the `Host` header/TLS SNI still use the real hostname. The hand-rolled private/reserved IP blocklist was also replaced with `ipaddr.js`, checked as an allowlist (only `range() === "unicast"` passes) instead of a denylist that could miss a range

## Version 6.1.3 (v6.1.3 — shipped July 11 2026)

**Hardening fixes, per ChatGPT's follow-up review of `73dd522a`**
- v6.1.2's submission-quota triggers counted rows by `created_at`, but nothing forced that column server-side — a direct client insert could supply an old timestamp and stay outside the rolling window indefinitely, bypassing the quota entirely. Both triggers now force `created_at := now()` before counting
- The same triggers' "count, then permit if under the limit" was a check-then-act race: concurrent inserts from one user could all observe the same pre-insert count and all proceed. Serialized per user (not globally) via a transaction-scoped `pg_advisory_xact_lock`, keyed separately per table. Verified live: 25 simultaneous inserts from one account produced exactly 20 successes, not more
- `triggerWebhooks.ts` created a fresh `undici` `Agent` per delivery for DNS pinning but never closed it — closed in a `finally` block now, on both success and failure
- Webhook fan-out (`Promise.all` over every active subscriber for an event) had no concurrency bound — one `bank_added` event could open unboundedly many simultaneous connections as webhook adoption grows. Capped at 10 concurrent deliveries via a small worker-pool helper. Not urgent at today's scale (0 registered webhooks) but cheap to fix ahead of it mattering

## Version 6.1.4 (v6.1.4 — shipped July 11 2026)

**Hardening fixes, per ChatGPT's follow-up review of `e642e22`**
- `increment_rate_limit` (the rate-limiter's atomic Postgres counter RPC) was directly callable by `anon`/`authenticated` via PostgREST — confirmed live. Supabase grants EXECUTE to those roles explicitly per-function on creation (not just via the `PUBLIC` default), so a caller could inflate someone else's rate-limit bucket or fill `api_rate_limits` with arbitrary keys. Revoked from `public`/`anon`/`authenticated` on this and all 4 other `SECURITY DEFINER` functions, re-granted only to `service_role`
- `bank_corrections` retained a direct authenticated INSERT (and SELECT) policy from before `submitCorrection()` existed as the real path — a direct client insert could set arbitrary `field`/`status`/`previous_value`, bypassing throttling and polluting the review queue. Dropped both policies (table is now server-only, same treatment `banks` already got in v5.0.0) and added CHECK constraints on `field`/`status` as defense in depth
- `/auth/callback` resolved a client-supplied `?next=` redirect with `new URL(next, request.url)` — accepted absolute URLs and protocol-relative `//host` values, an open redirect after a real OAuth login. Found while fixing it: a third bypass beyond what was flagged — the URL parser silently strips tab/newline/CR before resolving, so `/\t/attacker.example` also escaped a naive "starts with single `/`" string check. Fixed by resolving against a fixed trusted origin and checking the *result's* origin rather than pattern-matching the input, which closes all three bypass classes (and any others) at once

## Version 6.1.5 (v6.1.5 — shipped July 11 2026)

**Hardening fixes, per ChatGPT's broad follow-up review of v6.1.4**
- `/auth/callback`'s sanitized `next` was still resolved against `request.url` for the final redirect, not the fixed trusted origin it was validated against — closed the loop by resolving against that same origin, while explicitly still allowing `localhost:3000`'s own origin so local OAuth testing doesn't get redirected to production
- CSV exports (`/api/banks`, `/api/changelog`) quoted commas/quotes/newlines correctly but never neutralized spreadsheet formula injection — a bank name starting with `=`, `+`, `-`, or `@` (including after leading whitespace, which spreadsheet apps strip before checking) could execute as a formula when the export is opened in Excel/Sheets. Prefixes a safety apostrophe on string cells only, so genuine numeric values keep their numeric semantics
- `.github/workflows/sync-data.yml` set Supabase secrets at job level, so `npm ci` inherited the production service-role key — a compromised dependency's install script could have exfiltrated it. Moved secrets to only the individual sync steps that need them; also pinned both workflows' Actions to commit SHAs (defense in depth against a compromised/republished version tag)
- `sync-rail-participants.mjs`/`sync-zelle-participants.mjs` deleted their entire target table before reinserting — a harmless upstream HTML/layout change could have parsed near-zero records and wiped out a fully populated table, and a mid-insert failure left a partial replacement with no rollback. Both now insert the new data first, only removing the previous run's rows (identified by an `updated_at` cutoff) once every new row is in, and abort before touching anything if the new count drops more than 20% from what's currently stored

## Version 6.1.6 (v6.1.6 — shipped July 11 2026)

**Fixes a real bug in v6.1.5's own sync-script fix, per ChatGPT's review**
- v6.1.5's insert-then-delete-stale approach was correct that the *old* dataset survived a failed run, but a mid-insert failure left that old data sitting alongside a *partial* new-generation duplicate (nothing cleaned it up) — which then inflated the next run's raw-row-count sanity baseline enough to wrongly reject a perfectly valid parse. Fixed by (a) deleting this run's own rows immediately if the insert phase fails, restoring the table to exactly its pre-run state, and (b) basing the retention check on the size of the table's *largest single generation* (rows sharing one `updated_at` stamp) rather than a raw count, so it stays correct even if a cleanup step ever fails too. Extracted into a shared `scripts/lib/syncTableReplace.mjs` (with real test coverage, including a test that reproduces the exact bug ChatGPT found) so both sync scripts can no longer drift out of sync with each other the way the original delete-then-insert duplication did
- Added a `concurrency` guard to both `sync-data.yml` jobs so two runs (e.g. a manual trigger overlapping the schedule) can't interleave and delete each other's freshly-inserted rows — queues rather than cancels, since an in-progress sync shouldn't be killed mid-run
- `escapeCsvValue()`'s quoting check covered commas/quotes/newlines but not a bare carriage return, which could still disrupt row structure in some CSV consumers even with formula injection already neutralized

## Version 6.2.0 (v6.2.0 — shipped July 11 2026)

**First batch off the post-hardening backlog (see PROJECT.md's own history above for the v6.0.1–v6.1.6 hardening run this follows)**
- Added composite `(user_id, created_at)` indexes to `route_reports`/`edd_reports` — the v6.1.2 rolling-quota triggers run exactly this filter on every insert, previously a full sequential scan
- Added a daily `pg_cron` cleanup of `webhook_deliveries` older than 30 days, matching the existing `api_rate_limits` cleanup pattern — delivery logs have real short-term debugging value (unlike the rate-limit counters), so a longer retention window than the 10-minute one already in place
- Added a `maxLength={254}` bound on the sign-in email field — minor hygiene; the actual OTP send/verify flow goes straight to Supabase's own GoTrue service, which has its own validation and rate limiting, so this isn't a security boundary of ours
- New `scripts/rlsManifest.mjs` + `scripts/audit-rls-manifest.mjs`: a hand-reviewed, version-controlled baseline of every table's expected RLS policies and every `SECURITY DEFINER` function's expected `EXECUTE` grants, diffed against live production via a new `service_role`-only introspection RPC (`audit_rls_manifest`). Runs daily via `.github/workflows/audit-rls.yml` and fails loudly on drift in either direction (missing expected policy/grant, or an unexpected extra one) — built specifically to catch the *next* undocumented-dashboard-change class of bug automatically, the same category Phase 1b (v6.1.0) and v6.1.4 each had to catch by hand. Verified against production both ways: passes clean as-is, and correctly flags a deliberately wrong expectation

## Version 6.3.0 (v6.3.0 — shipped July 11 2026)

**Self-service account deletion (second post-hardening-backlog item, this one high-priority)**
- Previously, `auth.admin.deleteUser()` would fail outright for any user who'd ever submitted a route report, EDD report, correction, or registered a webhook — none of the four FKs referencing `auth.users(id)` specified an `ON DELETE` action, so they defaulted to blocking the delete. `route_reports`/`edd_reports`/`bank_corrections.user_id` are now `ON DELETE SET NULL` (the row survives, anonymized — every consumer of these tables already excludes `user_id IS NULL` from evidence/counts/the changelog, so the observable effect matches a hard delete without destroying the underlying community contribution); `webhooks.user_id` is `ON DELETE CASCADE` (a personal integration with no communal value — an orphaned webhook would otherwise keep firing with nobody able to manage it), which in turn cascades to `webhook_deliveries` via its existing FK
- New `deleteAccount()` server action + a "Delete account" section on `/account` with a two-step confirmation. Deliberately thin server-side — the actual guarantee lives at the database boundary via the FK actions above, not in application code that could forget a table
- Updated the Privacy Policy to document the new self-service path, and fixed a stale claim that the site runs behind Cloudflare (it doesn't — see v6.1.2's finding; the policy had never been corrected after that)
- Verified end-to-end against production: a test user with one row in each of the four affected tables, deleted, confirmed anonymized vs. cascaded correctly per table, confirmed excluded from evidence, confirmed the auth session itself is gone

**A detour worth recording:** verifying this surfaced what looked like a live regression — authenticated inserts into `route_reports`/`edd_reports` failing with a "row-level security policy" error — which briefly led to an incorrect fix (re-granting `EXECUTE` on three trigger functions to `authenticated`) before diagnosing correctly and reverting it (migrations `20260711034000`/`20260711035000`). The real cause: verification scripts chained `.insert(...).select(...)`, and since these two tables deliberately have no SELECT policy for `authenticated` (Phase 1b, v6.1.0), the implicit `RETURNING` clause that `.select()` produces can't read the row back — Postgres reports that under the same SQLSTATE 42501 as a genuine RLS violation. Confirmed via a raw SQL simulation (`SET ROLE authenticated` + `request.jwt.claims`, rolled back) that the identical INSERT succeeds without `RETURNING` and fails only once it's added. The real application code never chains `.select()` after `.insert()` on these tables and was never affected — production was never actually broken. Recorded because this is the second time this exact gotcha has cost real debugging time this session; see `lib/bankProfile.test.ts`'s `getBankProfileById` fix earlier in the v6.1.0 work for the first.

## Version 6.4.0 (v6.4.0 — shipped July 11 2026)

**Third batch off the post-hardening backlog (medium-priority items)**
- `/api/banks` returned the full ~4,671-bank directory in one response with no way to page through it. Added optional `?limit=`/`?offset=` (max limit 500), plus a hard 5000-row safety cap even when they're omitted — omitting them still returns everything today's consumers expect, so this is additive, not a breaking change (no `X-Api-Version` bump needed). Response now also includes `total`. Also bounded `?q=` to 200 characters and added a shared `Cache-Control: public, max-age=60, stale-while-revalidate=300` across all four public API endpoints (none vary by caller identity, so a shared public cache is safe everywhere)
- `fdicLookup.ts`/`finraLookup.ts` (external government API calls inside `enrichBank()`/`submitCorrection()`'s request path) and the two scheduled sync scripts with no existing retry logic (`sync-rail-participants.mjs`, `sync-zelle-participants.mjs`) had no fetch timeout at all — an unbounded call to a slow/hanging external API could tie up the whole request. Added a shared `fetchWithTimeoutAndRetry()` helper (one TS version for the app, one `.mjs` version for scripts, since the latter run without a transpilation step) with a timeout and one retry on network failure or a non-2xx response. `ncuaLookup.ts` doesn't call a live external API (queries the locally-synced table) and `sync-ncua-directory.mjs` already has its own tailored retry helper for a previously-observed flakiness pattern — both left as is
- New `lib/logger.ts` — a minimal structured JSON logger (Vercel captures stdout/stderr from serverless functions automatically, so this needed no new infrastructure). Applied to the two highest-value silent-failure spots found so far: the homepage's bank-count query was catching its own error but only ever displaying the raw Supabase error message to the visitor, with no server-side record at all (fixed to log server-side and show a generic message instead); `bankProfile.ts`'s three parallel bank-profile queries (`route_reports`/`bank_rail_history`/`edd_reports`) fell straight through to an empty-array fallback on failure with no record anything had gone wrong, indistinguishable from a bank that genuinely has zero reports. This is a starting point, not an exhaustive audit — the broader "silent Supabase failures" pattern likely exists elsewhere and the logger is now available for the next place it's found
- Added `.github/dependabot.yml` (npm + github-actions ecosystems, weekly). Actions stay pinned to commit SHAs (v6.1.5's supply-chain hardening) — Dependabot still opens PRs to bump the pinned SHA forward on a new release, so pinning doesn't quietly calcify

## Version 6.4.1 (v6.4.1 — shipped July 11 2026)

**xlsx dependency swap (supply-chain fix)**
- `xlsx` (SheetJS) was stuck on the npm registry's last published version, `0.18.5`, with a known vulnerability the registry's own advisory marks "no fix available" — SheetJS stopped publishing to npm and now distributes fixed builds only from their own CDN. Replaced the npm-registry dependency with `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` directly in `package.json`
- `xlsx` is a devDependency, used only by `scripts/sync-rail-participants.mjs` to parse the FedNow XLSX download — never part of the app bundle
- Verified: typecheck, lint, full test suite, and production build all pass; live-parsed the real FedNow participant file with the new build (1,801 records, matching the existing parser's expectations) before shipping

## Version 6.4.2 (v6.4.2 — shipped July 11 2026)

**Dependabot auto-merge for patch/minor updates**
- New `.github/workflows/dependabot-automerge.yml`: patch/minor version-bump PRs from Dependabot now auto-merge once the `test` check passes; major-version bumps always stay open for manual review
- Added minimal branch protection on `main` requiring the `test` check to pass before a PR can merge — doesn't require reviews or restrict direct pushes, so the existing direct-to-main workflow is unaffected; only gates PR merges
- Prompted by manually reviewing the first real batch of 10 Dependabot PRs: 7 were clean (including `react`/`react-dom`, which must be merged as a pair — bumping either alone breaks every test, since React requires matching versions), but the grouped dev-dependencies PR broke both lint and the build outright (`eslint-config-next`'s bundled `typescript-eslint` doesn't yet support the TypeScript 7 major bump it included) — left open rather than merged

## Version 6.4.3 (v6.4.3 — shipped July 11 2026)

**react/react-dom 19.2.4 → 19.2.7**
- Dependabot opened these as two separate PRs, but React requires `react` and `react-dom` to be the exact same version — applying either alone crashes the entire test suite. Applied as a single combined commit instead of merging the two PRs individually (which would have left `main` in a broken mismatched state between merges, risky since this repo auto-deploys to production on every push)

## Version 6.4.4 (v6.4.4 — shipped July 11 2026)

**xlsx dependency-section fix + CI build-step gap**
- The v6.4.1 xlsx swap had been placed under `dependencies` instead of `devDependencies` — the handoff command used `npm i --save` instead of `--save-dev`, and it wasn't caught before shipping. `xlsx` is only ever imported by `scripts/sync-rail-participants.mjs`, confirmed nothing under `app/`/`lib/`/`components/` references it. Moved back to `devDependencies`; verified the module still resolves and round-trip parses correctly at 0.20.3
- `test.yml`'s required `test` check ran `vitest`, `tsc --noEmit`, and `eslint`, but never `next build` — meaning a Dependabot bump that only broke the production build could still pass the check gating the new auto-merge workflow (v6.4.2) and land on `main`, which auto-deploys to production on every push. Added `npm run build` as a step; confirmed it needs no new secrets (it succeeds even with `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SERVICE_ROLE_KEY` all unset, since no route is statically prerendered against a live Supabase call)
- Also merged the 7 open Dependabot PRs (#3, #5, #6, #7, #10, #11, #12) that had been queued waiting on this session's permission classifier — left open the one grouped dev-dependencies PR (#4) already known to break lint/build. Three of the seven (undici, next, radix-ui) picked up lockfile conflicts from being merged sequentially against a moving `main`; resolved by merging `main` into each branch, regenerating `package-lock.json`, and re-verifying test/typecheck/lint/build before pushing

## Version 6.4.5 (v6.4.5 — shipped July 11 2026)

**Dependabot auto-merge hardening, per ChatGPT's review of v6.4.4**
- `main`'s branch protection had `required_status_checks.strict: false` — a PR's check only had to pass against its own (possibly stale) branch, not after being brought current with `main`. Two independently-passing dependency PRs could merge back to back without their *combined* state ever being tested — the exact issue v6.4.4's own release note describes hitting live (3 of 7 merged PRs picked up lockfile conflicts from sequential merges against a moving `main`). Flipped to `strict: true`, closing the gap at its root rather than just resolving conflicts as they occur
- `dependabot-automerge.yml` treated any `semver-minor` bump as auto-mergeable, but SemVer explicitly disclaims stability for 0.x releases ("anything MAY change at any time") — a "minor" bump on a pre-1.0 package (e.g. `@supabase/ssr` `^0.12.0`, `server-only` `^0.0.1`) carries the same risk profile as a major bump on a 1.0+ package. Added a check against Dependabot's `previous-version` metadata output so a 0.x minor bump stays open for manual review instead of auto-merging

## Version 6.4.6 (v6.4.6 — shipped July 11 2026)

**Fixes a bug in v6.4.5's own 0.x guard**
- v6.4.5's fix was correct that a 0.x *minor* bump needed to lose auto-merge eligibility, but the condition as written also blocked 0.x *patch* bumps (e.g. `server-only` 0.0.1 → 0.0.2) from auto-merging, which was never the intent — SemVer's stability disclaimer for pre-1.0 packages specifically concerns minor bumps having no compatibility guarantee, not patches. Caught by simulating the decision logic against five representative cases (0.x minor, 0.x patch, stable patch, stable minor, stable major) before considering it verified — the 0.x-patch case was the one that came back wrong. Narrowed the condition so only the minor branch checks pre-1.0 status

## Version 6.4.7 (v6.4.7 — shipped July 11 2026)

**Fixes a real gap in v6.4.5's 0.x guard, per ChatGPT's continued review**
- The 0.x guard added in v6.4.5 checks `dependabot-automerge.yml`'s singular `previous-version` metadata output, but confirmed against the action's own source: for a *grouped* PR, that output isn't an aggregate across the group — it's just whichever dependency happens to be first in the array, while `update-type` (correctly) reports the most severe level across the whole group. So a grouped dev-dependency PR containing a 0.x minor bump alongside stable ones could report an unrelated stable package's version, let the guard pass, and auto-merge — silently defeating the point of v6.4.5's fix for exactly the case (the grouped dev-dependencies PR) that had already caused problems once (#4, the TypeScript 7 break)
- Fixed at the `dependabot.yml` level instead of adding more fragile per-dependency parsing to the workflow: the `dev-dependencies` group now only includes patch releases (`update-types: ["patch"]`). Any minor/major dev-dependency bump becomes its own individual PR, where the singular metadata outputs are always correct for that one dependency and the existing guard works as intended. Verified `update-types` is a real, documented `groups` option (not guessed) before applying it
- Tradeoff, accepted deliberately: this partially reverses the grouping's original noise-reduction goal — dev-dependency minor/major bumps (e.g. `@types/node`, `eslint`, `typescript`) go back to individual PRs instead of being bundled. Patch-level dev bumps are unaffected and still group as before

## Version 6.4.8 (v6.4.8 — shipped July 11 2026)

**@types/node runtime mismatch + NCUA zip parser test coverage, per ChatGPT's review**
- `@types/node` had drifted to `^26` (a major-bump PR merged as part of the split-out dev-dependency work) while every workflow (`test.yml`, `sync-data.yml`, `audit-rls.yml`) targets Node 22 — green CI wouldn't have caught a case where the typechecker approved a Node 26-only API that doesn't exist in the Node 22 runtime actually used. Reverted to `^22` to match the declared target; regenerated the lockfile and refreshed `node_modules` (the adm-zip 0.6.0 merged in the same batch hadn't actually been locally reinstalled until now)
- `scripts/sync-ncua-directory.mjs`'s ZIP-reading path (via `adm-zip`) had zero test coverage — the 251-test suite proved installation/build compatibility for the adm-zip 0.6.0 bump, not that a real archive still parses. Extracted the zip-read-and-CSV-parse logic (previously inlined) into `scripts/lib/zipCsv.mjs`, matching the existing `scripts/lib/` pattern (`fetchWithTimeout.mjs`, `syncTableReplace.mjs`); new `zipCsv.test.mjs` builds real zips in-memory with the actual installed adm-zip version (not a static fixture file, so it can't go stale) and covers quoted/comma CSV fields, multi-entry zips, and a missing-entry error

## Version 6.4.9 (v6.4.9 — shipped July 11 2026)

**Explicit Node version, per ChatGPT's WSL environment review**
- Local dev had been running Node 24 while every CI workflow targets Node 22, with nothing in the repo making the intended version explicit. Added `.node-version` (`22`, for local version managers like `fnm`/`nvm`) and `engines.node: "22.x"` in `package.json`
- `engines.node` is also read by Vercel to select its build/runtime Node version — verified no `vercel.json` or prior `engines` field existed to compare against, so this is a genuine (low-risk, intended) production-facing change, not just a local-tooling hint. `npm install` still succeeds under a mismatched local Node version (warns, doesn't fail — no `engine-strict` set)
- Also set this repo's local `core.autocrlf` to `input` (git config, not a versioned file) — not because it was misconfigured (it wasn't set to anything, contrary to what prompted this), but as cheap defensive hygiene given this project's real prior history of CRLF pain on its Windows-based sessions

## Version 6.5.0 (v6.5.0 — shipped July 11 2026)

**Route Explorer polish, per ChatGPT's "ship today" feature review**
- Swap button between the two bank selectors — genuinely useful rather than cosmetic, since route evidence is directional (A→B and B→A are tracked as separate routes)
- Copy-link button on a checked result, with "Copied" feedback — the route URL (`?from=<slug>&to=<slug>`) was already shareable/bookmarkable (`HomeRouteChecker` already pushed it on every check); this just adds the affordance to grab it
- "Check [B] → [A]" one-click reverse-direction shortcut below a result, so reversing a route doesn't require manually re-swapping and re-clicking Check Route
- Widened the existing contribution CTA to also fire when a route has evidence but every rail is stale (`previously_observed`, >180 days old per `routeConfidence.ts`) — previously it only fired when there was zero evidence at all, with different copy for the two cases ("needs a fresh report" vs. "no evidence yet"). The form-prefill and profile-link pieces ChatGPT's proposal also called out were already built in earlier releases, so this was the one real gap in the "stale evidence" case
- "Compare these banks" link from a checked result (`/compare?banks=<slugA>,<slugB>`) — profile links from results already existed
- 5 new tests in `HomeRouteChecker.test.tsx` (swap, copy-link, reverse-check, compare-link, stale CTA copy), covering the actual rendered DOM/click handlers via React Testing Library, not just type-checking
- Not verified in a live browser — this WSL environment has no Supabase credentials configured, and the app fails hard at the `proxy.ts` middleware layer before rendering anything without them

## Version 6.5.1 (v6.5.1 — shipped July 11 2026)

**Fixes a real async race in v6.5.0's new swap feature, per ChatGPT's review**
- `checkRoute` and the initial-mount auto-fetch both called `setResult(data)`/`setLoading(false)` unconditionally once their fetch resolved. Swapping (or changing a bank) while a check was still in flight cleared `result` synchronously, but the earlier request's own resolution would then silently reapply — misattributing one route's evidence to whatever pair the heading had since moved on to. The new swap button made this trivial to trigger (start A→B, swap before it resolves)
- Fixed with a monotonically increasing request ID ref (`requestIdRef`): only a resolution whose ID still matches the latest is applied. Bumped on every action that changes what "the current route" is — a real check start, a swap, a bank-picker change, or the same-bank guard — not just on a new fetch, since the bug was equally triggerable by just changing a selection with no new request in flight yet
- Caught a second-order bug of my own fix while writing it: invalidating a pending request without also resetting `loading` would leave the UI stuck on "Checking..." indefinitely, since nothing else would ever flip it back to `false` for a request that's now deliberately ignored. Added `invalidatePendingRequest()` (bumps the ref, clears `result` and `loading` together) to every place that was clearing `result` alone
- New test starts an A→B check, swaps to B→A before it resolves, then resolves the stale request and confirms nothing renders from it — verified this test actually fails against the unfixed code before confirming it passes against the fix
- Low-priority fix, same review: `CopyLinkButton`'s clipboard write had no error handling — a rejection (permission denied, non-HTTPS context) surfaced as an unhandled promise rejection with no user feedback. Now catches and shows "Couldn't copy", with its own test

## Version 6.6.0 (v6.6.0 — shipped July 12 2026)

**Official-source alternate/trade names, sitewide**
- Prompted by a Google Search Console review: several real query-page pairs (`fnfcu` → First Neshoba Credit Union, `culink` → 1st University Credit Union, `otpfcu` → Olean Teachers and Postal Credit Union, `ascu sierra vista az` → American Southwest Credit Union) turned out to be searches for each institution's own acronym or trade name — verified against each institution's actual official website before trusting the pattern, not assumed from the query text alone
- Both halves of the directory already had an official source for this that just wasn't being surfaced: NCUA's `TradeNames.txt` (already parsed into `ncua_credit_unions.search_names` by the existing weekly sync, but never carried into `banks`) for credit unions, and FDIC's `TE0{1-10}N529` trade-name fields (not previously requested at all) for banks
- New `banks.aka_names` (text array) + persisted `ncua_charter_number`/`fdic_cert` links (not just a one-off backfill — `sync-ncua-directory.mjs` and `import-ncua-credit-unions.mjs`/`import-fdic-banks.mjs` all keep it current going forward). Surfaced in the page title (first alternate only, to avoid SERP truncation), the full list in the meta description, a visible "Also known as" line, and `alternateName` in the JSON-LD structured data; also flows through the public `/api/banks` and `/api/banks/:id` endpoints
- Backfilled 3,770 banks via the NCUA link (pure DB-to-DB join by website, no external calls) and 354 via FDIC (queried by name)
- **Two real bugs found and fixed during the FDIC backfill itself, live, before either could do lasting damage:** (1) naively taking the "highest-asset candidate" from FDIC's fuzzy name search silently mismatched several institutions to unrelated mega-banks — confirmed live ("Truist Bank" got assigned JPMorgan Chase's trade names; several credit unions, which are never FDIC-insured, got assigned unrelated banks' data via generic 2-word/location-name overlap like "Long Beach"). Fixed with a word-boundary + exactly-one-distinct-match rule (same pattern this codebase already uses for rail-participation matching) and excluding credit-union-named banks from FDIC lookup entirely. Since there's no `updated_at` column to isolate exactly which rows the buggy pre-fix run had touched, every affected row was reverted and the backfill re-run clean from scratch rather than risk leaving an unverifiable mix of good and bad data. (2) A handful of FDIC records have a URL sitting in their trade-name field instead of an actual name (a genuine quirk in FDIC's own source data, confirmed against their live record) — filtered out rather than displayed as a broken-looking "also known as www.example.com"
- This same "pick highest-asset from a fuzzy search regardless of name relevance" pattern was found to already exist, unfixed, in the pre-existing `backfill-bank-info.mjs` (used for website/address/phone enrichment) — flagged as a separate, not-yet-addressed concern; past runs of that script may have already written a wrong website/address/phone for some banks

## Version 6.6.1 (v6.6.1 — shipped July 12 2026)

**Audited and fixed the same matching bug in `backfill-bank-info.mjs`**
- v6.6.0 found and fixed a real bug in the new aka_names backfill: naively taking the highest-asset candidate from FDIC's fuzzy name search, with no check that the name actually matched. The same exact pattern already existed, unfixed, in the pre-existing `backfill-bank-info.mjs` (website/address/phone enrichment) — flagged then, audited now
- Ran the existing read-only `scripts/audit-bank-info.mjs` (which already uses the safer bulk-fetch + word-boundary + uniqueness approach, so it wasn't itself at risk) against all 4,670 banks: **zero mismatches, zero missing fields** — no evidence this bug ever actually corrupted production data, likely because the script only ever fills in missing fields, never overwrites existing ones
- Fixed anyway, since the bug is still live for any future run (e.g. enriching a newly-added bank): reused `pickFdicMatch` (word-boundary + exactly-one-distinct-match) from `bankAkaNames.mjs`, raised the truncation floor from 2 words to 3, and excluded credit-union-named banks from FDIC lookup entirely (they're never FDIC-insured, so any match is by definition wrong)
- Separately noticed, not fixed here: `tryNcuaMatch`'s ILIKE fallback takes the first result with no uniqueness check at all — a smaller version of the same class of risk, since NCUA data has no asset-size field to rank by in the first place. Left as a known, flagged gap rather than expanding this pass further

## Data Principles

- Real-world reports only
- No guessing
- Unknown is better than wrong
- Show test dates clearly
- Stale data should be marked stale
- Evidence describes correlation, not causation — never phrase a report as proof that something (a bank, a rail, a payroll provider) caused an outcome

## Seed Routes

- Chase to Gesa Credit Union: RTP confirmed
- Chase to SoFi: ACH observed
- Chase to Schwab: ACH observed
- Chase to BECU: ACH observed
- Chase to WSECU: ACH observed
- Chase to American Express Rewards Checking: ACH observed

## Build Rules

- Small commits
- Test before pushing
- Keep MVP focused
- No feature creep
- Update PROJECT.md with the new version's release notes before pushing a feature (don't let it drift out of sync again — see the v5.0.2–v6.1.0 backfill)