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

## Data Principles

- Real-world reports only
- No guessing
- Unknown is better than wrong
- Show test dates clearly
- Stale data should be marked stale

## Seed Routes

- Chase to Gesa Credit Union: RTP confirmed
- Chase to SoFi: ACH observed
- Chase to Fidelity CMA: ACH observed
- Chase to Schwab: ACH observed
- Chase to BECU: ACH observed
- Chase to WSECU: ACH observed
- Chase to American Express Rewards Checking: ACH observed

## Build Rules

- Small commits
- Test before pushing
- Keep MVP focused
- No feature creep