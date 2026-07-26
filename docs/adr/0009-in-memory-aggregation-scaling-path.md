# ADR-0009: Deferred Scaling Path for In-Memory Report Aggregation

- Status: Accepted
- Decision date: 2026-07-26
- Last validated against repository: 2026-07-26
- Grounding: implementation
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: `route_reports`/`edd_reports` read-side aggregation (rail leaderboards, timing leaderboard, bank profile rail rollups, the public activity feed) — write-side and moderation-side aggregation (`lib/riskTriage.ts`) is out of scope, already flagged separately in [ADR-0008](0008-moderation-enforcement.md)'s Future Considerations
- Primary implementations: `lib/communityRails.ts`, `lib/timingLeaderboard.ts`, `lib/bankProfile.ts`, `lib/activityFeed.ts`
- Related ADRs: [ADR-0007](0007-public-evidence-integrity-and-privacy.md) (the dedupe-to-newest-per-reporter integrity rule these four modules all apply is defined and justified there — this ADR is about *where* that computation runs, not the rule itself), [ADR-0008](0008-moderation-enforcement.md) (already notes `lib/riskTriage.ts`'s queries may need redesign at scale; this ADR gives the same concern a concrete path for the four read-side modules ADR-0008 didn't cover)

## Context

Four modules share one shape: fetch every relevant `route_reports`/`edd_reports` row (frequently with no `.limit()` at all — a full-table read) plus the full `banks` table, then dedupe, group, and rank entirely in the Node.js process:

- `lib/communityRails.ts`'s `getCommunityReportedBanks` — every `route_reports` row for one rail, pooled by sending bank.
- `lib/timingLeaderboard.ts`'s `getTimingLeaderboard` — every `route_reports` row with a non-null settlement time, grouped by rail+bank, median computed in memory.
- `lib/bankProfile.ts`'s `buildProfile` — every `route_reports` row touching one bank (bounded per-bank, but `select("*")`, and the widest of the four in row width).
- `lib/activityFeed.ts`'s `getActivityFeed` — recent banks, recent reports, and a separate *unbounded* full scan of every successful report (to detect "first confirmed" badges) plus the full `banks` table for slug lookups.

None of the four pages that consume this data cache it: `/rails`, `/timing`, and `/changelog` are all `export const dynamic = "force-dynamic"`, and `/banks/[slug]` (bank profile) carries no `unstable_cache` either. Every single page view re-runs the full fetch-and-aggregate pipeline from scratch. This is deliberate today — these are exactly the pages where showing a report submitted seconds ago matters — but it means there is no caching layer currently softening the cost of the in-memory approach.

At current report volume (a young product, low report counts per rail/bank), this is fast and every one of these functions is fully unit-testable without a database (`computeTimingLeaderboard`, `computeEddLeaderboard`, etc. are pure functions taking rows as plain arguments — see each file's own "compute vs. fetch" split comment). Rewriting this into database views or RPC aggregates now, before there's a real performance problem to solve, would trade that simplicity and testability for speculative complexity. The project's own build rules (`PROJECT.md`: "no feature creep," "keep MVP focused") argue against it too.

That tradeoff will not hold forever. Every one of these reads scales at best linearly with total `route_reports`/`edd_reports`/`banks` row count, transferred over the network and held in the Node process's memory on every request, with no cache absorbing repeat views of the same page.

## Decision

1. **Do not rewrite these four modules now.** No database view, materialized view, or RPC aggregate is introduced by this ADR. The current in-memory approach stays, matching every one of these functions' existing "compute vs. fetch" split (a pure aggregation function plus a thin Supabase-fetching wrapper) — that split is exactly what makes the eventual migration path below tractable later without a rewrite of the business logic itself.
2. **Watch two concrete triggers, not a calendar date:**
   - **Row-count trigger**: `route_reports` or `edd_reports` crossing roughly 50,000 rows (an order of magnitude past anything this schema has held to date — the largest unpaginated response this codebase already guards against, `/api/banks`' `DEFAULT_UNPAGINATED_CAP`, was capped at 5,000 after measuring a real payload-size ceiling; `route_reports` has no such existing cap at all).
   - **Latency trigger**: any of `/rails`, `/timing`, `/changelog`, or a bank profile page's server response time regressing past roughly 1 second measured in Vercel's own function duration metrics, attributable to one of these four code paths specifically (not an unrelated regression).
   Either trigger on its own is reason enough to act — don't wait for both.
3. **When triggered, migrate via Postgres, not a cache layer bolted in front of the same query shape.** A cache (even `unstable_cache` with a short revalidate window) would mask the underlying full-table-scan cost rather than remove it, and would reintroduce the staleness these pages deliberately avoid today by being `force-dynamic`. The fix is moving the aggregation itself into the database:
   - **Narrowly-scoped RPC functions**, following the exact pattern this codebase already uses for `add_bank_with_attribution`, `moderate_delete_submission`, and `audit_rls_manifest` (`supabase/migrations/`) — a `plpgsql` or `sql` function that performs the dedupe-to-newest-per-reporter + group-by + aggregate logic in Postgres and returns only the final ranked rows, not every underlying report row. This is the preferred option for `communityRails.ts` and `timingLeaderboard.ts`, since their aggregation (group by bank, filter by minimum reporter count, rank) maps directly onto a `GROUP BY`/window-function query.
   - **A plain (non-materialized) view** is preferable specifically for `bankProfile.ts`'s per-bank rollup, since it's already naturally scoped to one row's worth of related data (`WHERE bank_id = $1`) rather than a whole-table aggregate — a view keeps the query itself in one place without needing an RPC's function-call ceremony for what's still fundamentally a filtered join.
   - **Materialized views are a fallback, not a first choice**, and only for `activityFeed.ts`'s unbounded "first confirmed" scan specifically — that's the one query here that's a genuine full-table aggregate with no natural per-request scope (bank, rail, or user) to filter by first. A materialized view refreshed on a schedule (or via a trigger on insert, mirroring `bank_rail_history`'s existing change-capture trigger) would bound the query cost without touching the live table on every request. Try the RPC/view approach first even here; reach for a materialized view only if a live aggregate proves too slow even scoped down.
4. **Migrate one module at a time, starting with whichever trigger fired.** These four modules don't share a query shape closely enough to justify one combined migration — `communityRails.ts` and `timingLeaderboard.ts` are genuine whole-table aggregates, `bankProfile.ts` is a bounded per-row lookup, and `activityFeed.ts` is a mix of both. Treating this as one migration effort risks over-engineering the two that don't need it yet.
5. **Preserve the pure-function boundary through the migration.** Each module's existing split (e.g. `computeTimingLeaderboard(rows, banks, now)` as a pure function, separate from the Supabase-fetching `getTimingLeaderboard()`) should survive as the *shape* of the new RPC's contract even once the computation itself moves into Postgres — the pure function's existing unit tests (rows in, ranked entries out) either get deleted in favor of a real-database integration test, or, better, kept as a compatibility check that the RPC's output matches what the pure function would have produced from the same rows, during the migration itself.

## Rationale

### Why not migrate now

Every one of these functions is already the simplest thing that works, is fully unit-tested without a database dependency, and handles today's real data volume without measured performance complaints. Introducing an RPC function or view ahead of an actual need adds a second place (SQL, not just TypeScript) that has to correctly implement the dedupe-to-newest-per-reporter integrity rule from [ADR-0007](0007-public-evidence-integrity-and-privacy.md), for no present benefit.

### Why concrete triggers instead of "revisit periodically"

A calendar-based revisit ("check again in six months") measures the wrong thing — report volume and observed latency are the two things that actually indicate a problem, and both are already either directly measurable (Vercel function duration) or comparable against a precedent this codebase already set (`/api/banks`' own measured 5,000-row cap).

### Why RPC/views over a cache

`/rails`, `/timing`, and `/changelog` are `force-dynamic` specifically so a report submitted moments ago shows up immediately — the existing `/routes/needs-fresh-reports` page's own `unstable_cache` (in `lib/needsFreshReports.ts`) is tagged and explicitly invalidated by `submitRouteReport.ts` on every write for exactly this reason. Naively caching these four instead of fixing the query shape would either reintroduce that staleness or require wiring the same kind of tag-based invalidation into four more write paths for a problem that's really about query cost, not cache-ability.

### Why bankProfile.ts gets a view, not an RPC

Its query is already naturally scoped to one bank (`WHERE bank_id = $1`-shaped), unlike the other three's whole-table aggregates — a view is the lighter-weight tool for "the same filtered join, expressed once, instead of re-fetching wide rows into Node to filter/join there."

### Why activityFeed.ts's fix differs from the other three

Its "first confirmed" detection is the one query in this set with no natural per-request scope to filter by before aggregating — bank, rail, and user are all the wrong dimension to scope it on, since the question is global ("has any bank ever confirmed this rail before"). That's the profile a materialized view exists for.

## Consequences

### Positive

- No speculative complexity added today — four already-simple, already-tested modules stay exactly as simple as the problem currently requires.
- A concrete, measurable trigger (row count or latency) replaces "someone notices it got slow" as the signal to act.
- The eventual migration has a documented per-module target (RPC vs. view vs. materialized view) instead of a generic "move it to the database" mandate that would get re-litigated per module when the time comes.

### Negative

- This ADR is, by construction, a known-incomplete state: the migration it describes is not implemented, and nothing in the codebase currently alerts anyone when either trigger condition is actually met (no automated row-count or latency monitor exists for these four modules specifically — Vercel's own dashboard is the only place function duration is currently observable).
- `route_reports`/`edd_reports` have no existing row-count safety net analogous to `/api/banks`' pagination cap — nothing prevents these four modules from degrading gradually rather than failing loudly the moment they should have been migrated.

## Related implementation

- `lib/communityRails.ts` — `getCommunityReportedBanks`, `getEddLeaderboardData`, `getEddOpportunities`
- `lib/timingLeaderboard.ts` — `computeTimingLeaderboard` (pure), `getTimingLeaderboard` (fetch + compute)
- `lib/bankProfile.ts` — `buildProfile`
- `lib/activityFeed.ts` — `getActivityFeed`
- `lib/eddLeaderboard.ts`, `lib/eddOpportunities.ts` — the pure compute functions `communityRails.ts` delegates to
- `lib/routeConfidence.ts` — `dedupeToNewestPerReporter`, the shared integrity rule all four modules apply before aggregating
- Precedent for the RPC-aggregate pattern this ADR recommends: `add_bank_with_attribution`, `moderate_delete_submission`, `audit_rls_manifest` (`supabase/migrations/`)
- Precedent for trigger-driven change capture (relevant to the materialized-view fallback): `bank_rail_history`'s insert trigger

## Rejected alternatives

### Rewriting all four now, ahead of any measured need

Rejected — no current performance problem exists to justify the added complexity and the second (SQL-side) implementation of the dedupe/integrity rules; matches the project's own "keep MVP focused" build rule.

### A blanket cache layer (e.g. `unstable_cache` with a short TTL) in front of the existing queries

Rejected as the general fix — it would mask full-table-scan cost rather than remove it, and would reintroduce staleness on pages (`/rails`, `/timing`, `/changelog`) that are deliberately `force-dynamic` today so a just-submitted report shows up immediately, without wiring real tag-based invalidation (as `needs-fresh-reports` already does) into four more write paths.

### One combined migration treating all four modules identically

Rejected — `communityRails.ts`/`timingLeaderboard.ts` (whole-table aggregates), `bankProfile.ts` (bounded per-bank lookup), and `activityFeed.ts` (mixed, including one truly unscoped query) have different enough query shapes that a single "move everything to a view" plan would either over-engineer the bounded case or under-serve the unscoped one.

### Materialized views as the default migration target

Rejected as a default — a refresh-scheduled materialized view is the more operationally complex option (something has to trigger and monitor the refresh) and is only actually necessary for `activityFeed.ts`'s one unscoped aggregate; reached for elsewhere, it would trade a real-time page for a stale one without needing to.

## Validation

Confirmed directly against each file: `lib/communityRails.ts` and `lib/timingLeaderboard.ts` fetch `route_reports` with no `.limit()`; `lib/bankProfile.ts`'s `buildProfile` fetches every `route_reports` row for one bank via `select("*")`; `lib/activityFeed.ts`'s third query (`allSuccess`) fetches every successful, attributable `route_reports` row with no limit and no per-bank/per-rail scope.

Confirmed `/rails`, `/timing`, and `/changelog` all set `export const dynamic = "force-dynamic"`, and that none of the four modules call `unstable_cache` anywhere (`lib/needsFreshReports.ts` is the only module in the codebase that does, for a different page).

Confirmed the RPC precedent cited above (`add_bank_with_attribution`, `moderate_delete_submission`, `audit_rls_manifest`) exists in `supabase/migrations/` and follows the "aggregate/mutate in Postgres, return only the result" shape this ADR recommends extending to these four read paths.

## Future considerations

- No automated alert exists today for either trigger condition (row count, latency) — adding one (a scheduled check, or a Vercel Analytics-based alert) would close the gap noted in Consequences, but is itself a deliberate follow-up, not assumed by this ADR.
- `lib/riskTriage.ts` has a near-identical in-memory-aggregation shape and is already flagged in [ADR-0008](0008-moderation-enforcement.md)'s Future Considerations; it was left out of this ADR's scope since it's moderation/admin-facing (different traffic pattern and urgency profile) rather than public-read-path, but the same RPC-migration approach would likely apply there too when its own trigger is met.
- If/when the first of these four is migrated, the resulting RPC/view's naming and grant pattern should be cross-checked against `scripts/rlsManifest.mjs` and `scripts/audit-rls-manifest.mjs` (see [ADR-0008](0008-moderation-enforcement.md)) so the audit stays accurate rather than silently blind to a new SECURITY DEFINER function.
