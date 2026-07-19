# ADR-0007: Attributable, Deduplicated Public Evidence Without Raw User Exposure

- Status: Accepted
- Decision date: 2026-07-10 (commit `29d5fec`, "Replace route confidence/success-rate with attributable evidence states" — the founding policy decision this ADR documents; extended to Early Direct Deposit in v8.12.0, commit `15da3b0`, 2026-07-19, and to the settlement-time leaderboard's conventions in v8.13.0, commit `15bfd77`, 2026-07-19)
- Amended: 2026-07-19 (closed the EDD sentinel-averaging gap below — see Amendment)
- Last validated against repository: 2026-07-19
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: route reports, Early Direct Deposit evidence, settlement-time rankings, freshness/evidence states, privacy boundaries for public aggregates, treatment of account deletion
- Primary implementations: `lib/routeConfidence.ts`, `lib/bankProfile.ts`, `lib/eddLeaderboard.ts`, `lib/timingLeaderboard.ts`, `lib/communityRails.ts`
- Related ADRs: [ADR-0004](0004-public-api-subdomain.md) (this API surface is where the aggregate-only rule is exposed publicly), [ADR-0006](0006-institution-synchronization.md) (inactive institutions, defined there, are excluded from ranking here), [ADR-0008](0008-moderation-enforcement.md) (account-deletion anonymization described here is one consequence of the account-state model described there)

## Context

Raw report counts are trivially inflated by one person submitting repeatedly. Raw averages are vulnerable to a single outlier or, for Early Direct Deposit, a genuinely unbounded self-reported value ("more than 5 days early") that has no true numeric magnitude to average. Evidence goes stale — a route that worked six months ago is not the same claim as one confirmed last week. Different public surfaces make claims of different strength (a bank profile showing "some evidence exists" is a weaker claim than a ranked leaderboard position), and conflating their thresholds would either overstate sparse evidence or bury real evidence behind an unreasonably high bar. Exposing raw, user-linked report rows would create both a privacy risk and an abuse surface (harvesting who-reported-what).

## Decision

1. **Only attributable reports from signed-in users contribute to public evidence.** `dedupeToNewestPerReporter()` (`lib/routeConfidence.ts`) discards any row with `userId === null` before anything else happens; every consuming surface (route evidence, EDD, settlement timing) goes through this same function or a thin wrapper over it, not its own reimplementation.
2. **Only each reporter's newest report for the relevant unit counts.** The unit is directional route+rail for route evidence and settlement timing, and reporter+bank (or reporter+bank+deposit-context for provider-level EDD claims) for EDD — a reporter's repeated submissions never inflate a count or outvote their own earlier report.
3. **Public consumers receive aggregates and named evidence states, never raw report rows or reporter identities.** No public surface — page or API — exposes `route_reports`/`edd_reports` rows or `user_id` values; every response type is a pre-aggregated shape.
4. **Route evidence uses eight named states, not a single confidence score:** `limited_evidence`, `observed_working`, `consistently_reported`, `reported_unsuccessful`, `reported_delayed`, `variable_timing`, `conflicting`, `previously_observed` (`EVIDENCE_LABELS`, `lib/routeConfidence.ts`).
5. **Evidence older than 180 days (`FRESHNESS_WINDOW_DAYS`) is marked `previously_observed`, not hidden.** A route with only stale attributable reports still shows that history rather than reverting to "no evidence."
6. **Settlement leaderboard rankings use median timing, not average**, to resist a single outlier report; failed transfers carry no timing signal and are excluded, while delayed-but-completed transfers remain valid timing observations (`lib/timingLeaderboard.ts`'s `medianMinutes`, filtering `status !== "failed"`).
7. **EDD overall evidence and the EDD leaderboard ranking are separate claims with separate thresholds.** Two distinct reporters (`EDD_MIN_REPORTERS`) are enough for bank-level EDD evidence to appear at all (e.g. on a bank profile); five (`EDD_LEADERBOARD_MIN_REPORTERS`) are required for a ranked position on `/early-direct-deposit`. Two to four reporters show as unranked "early evidence" rather than disappearing or being force-ranked on thin data.
8. **EDD's sentinel value (`EDD_DAYS_SENTINEL = 6`, "more than 5 days early") is a censored category, not a literal count, everywhere it's aggregated.** `computeTypicalValue()` (`lib/eddLeaderboard.ts`) returns a categorical `{ kind: "moreThanFive" }` result rather than fabricating a number whenever the ranked leaderboard's true median would land on, or require interpolating across, the censored bucket. `lib/bankProfile.ts`'s bank-level and provider-level `avgDaysEarly` computations exclude sentinel-valued rows from their own arithmetic entirely (`averageExactDaysEarly()`), returning `number | null` — `null` when every attributable reporter chose the open-ended option, since no numeric average exists in that case. See the Amendment below for how this was closed.
9. **Provider-specific EDD claims require a stricter privacy threshold than bank-level evidence** (`EDD_PROVIDER_MIN_REPORTERS = 3` vs. `EDD_MIN_REPORTERS = 2`) and exclude non-payroll deposit contexts (government benefits, tax refunds, pensions) — naming a specific employer/provider is more identifying than an anonymous bank-wide aggregate, and a provider claim should only ever describe payroll deposits, not an unrelated deposit type that happens to share the same days-early field.
10. **Inactive institutions (per [ADR-0006](0006-institution-synchronization.md)) remain historically viewable but never rank** on the EDD or settlement leaderboards.
11. **Recency is shown, never secretly weighted.** `latestObservationDate`/`isStale` surface staleness on every evidence type; no ranking function discounts or boosts a report's weight based on age.
12. **Account deletion anonymizes retained community submissions rather than deleting them.** `route_reports`, `edd_reports`, `bank_corrections`, and `route_requests` set `user_id` to `null` on account deletion (`ON DELETE SET NULL`, `supabase/migrations/20260711033000_add_account_deletion_fk_actions.sql`); every consumer of those tables already excludes `user_id IS NULL` rows from evidence, so the observable public effect is identical to a hard delete without destroying the underlying community contribution. `webhooks` (and its dependent `webhook_deliveries`) are the one exception — those cascade-delete fully, since an orphaned webhook with no owner would otherwise keep firing with nobody able to manage it.
13. **Evidence wording describes observations, never guarantees.** Every public-facing description (`describeEddProviderEvidence`, methodology copy) is phrased as "reported," "observed," or "typical," never as a promise about a future transfer.

## Rationale

### One account should not be able to inflate a public claim

Repetition from a single reporter is not corroboration. Deduplicating to each reporter's newest report per unit is the one mechanism every surface shares, so this guarantee can't silently diverge between route evidence, EDD, and settlement timing.

### A censored value must never be treated as if it were exact

"More than 5 days early" carries no true numeric magnitude — treating it as a literal 6 in an average or a median interpolation fabricates false precision about a value that is, by construction, unknown. A ranking claim built on a fabricated number is worse than no ranking claim at all.

### Different surfaces make different-strength claims

A bank profile showing "some EDD evidence exists" and a `/early-direct-deposit` ranked position are different claims requiring different sample sizes; collapsing them to one threshold would either force thin evidence into a ranked slot or hide real evidence behind an unreasonably high bar for a surface that was never claiming to be a competitive ranking.

### Privacy and account erasure can coexist with durable community evidence

A user's right to delete their account does not require deleting the aggregate community value their (now-anonymous) reports represent — anonymization, not deletion, of the underlying rows, combined with every consumer already filtering to attributable rows, achieves both goals at once.

## Consequences

### Positive

- One account cannot inflate a public count or ranking through repetition.
- Public claims remain explainable — every number traces back to a named rule, not an opaque score.
- Account erasure and durable public integrity coexist without contradiction.
- Median-based rankings are materially more robust to outliers than raw averages.
- Provider-level claims carry privacy-appropriate thresholds distinct from bank-level evidence.

### Negative

- Legitimate repeated experiences from the same reporter are intentionally collapsed to one data point — a highly engaged single reporter cannot, by design, move a ranking further than one report's worth.
- Sparse evidence often yields no public claim, or only an unranked state, even when the underlying reports are genuine.
- A median (or a bucketed categorical value) hides some distribution detail that a full histogram would show — mitigated by `distribution`/bucket breakdowns on the EDD surfaces, but not eliminated.
- No coordinated-account or duplicate-identity detection exists beyond per-reporter deduplication — a determined bad actor with multiple real accounts is not caught by this design (see [ADR-0008](0008-moderation-enforcement.md) for why device fingerprinting is deliberately out of scope).
- Thresholds (2/3/5 reporters, 180-day staleness) are product judgments, not derived from a formal statistical model, and need periodic review as report volume grows.

## Amendment (2026-07-19): closed the EDD averaging gap outside the ranked leaderboard

This ADR was originally drafted with a labeled "Known implementation gap": `computeTypicalValue()` (`lib/eddLeaderboard.ts`) correctly treated `EDD_DAYS_SENTINEL` (6, "more than 5 days early") as a censored category for the ranked leaderboard, but `lib/bankProfile.ts`'s bank-level and provider-level `avgDaysEarly` computations did not — both summed and divided raw `days_early` values including the sentinel, treating it as a literal 6. Since "more than 5 days" means "some unknown value greater than 5," this made any `avgDaysEarly` touched by a sentinel report a lower-bound figure presented with false numeric precision. This ADR deliberately stayed `Proposed` rather than `Accepted` until that gap was closed or the guarantee was re-scoped to match reality — the original text also, at the time, mis-documented `app/developers/page.tsx` as already describing the fixed behavior, when the code did not yet match it.

**Resolution.** A separate, reviewed change (not the original documentation-only ADR pass) added `lib/bankProfile.ts`'s `averageExactDaysEarly()`: both `buildProfile()`'s bank-level aggregate and `computeEddProviderEvidence()`'s per-provider aggregate now average only the exact-valued (non-sentinel) rows, returning `avgDaysEarly: number | null` — `null` specifically when every attributable reporter chose the open-ended option, rather than a fabricated or misleading number. `reportCount` and `hasMoreThanFive` are unaffected (they still reflect every attributable report, exact or sentinel). This was a breaking response-shape change for `/api/banks/:id`'s documented `eddEvidence`, so `API_VERSION` bumped `"7"` → `"8"` ([ADR-0004](0004-public-api-subdomain.md)), with `app/developers/page.tsx` gaining a matching "v8 breaking change" note.

Of the two options the original gap section posed, replacing the bank-profile average with the leaderboard's median/categorical representation was rejected: `/methodology` and `/developers` already deliberately document the bank-profile average and the leaderboard median as two different, intentionally divergent methodologies, and unifying them would have erased that distinction for no benefit beyond the arithmetic fix itself, which excluding the sentinel from the average achieves on its own.

Since production had zero EDD reports at the time of the fix, no real bank's displayed number or API response was ever actually distorted by this in practice — the fix landed before any real evidence could be affected.

## Related implementation

- `lib/routeConfidence.ts` — `dedupeToNewestPerReporter`, `computeRouteEvidence`, `EVIDENCE_LABELS`, `FRESHNESS_WINDOW_DAYS`
- `lib/bankProfile.ts` — `EDD_MIN_REPORTERS`, `EDD_PROVIDER_MIN_REPORTERS`, `EDD_DAYS_SENTINEL`, `dedupeEddReportsByReporterAndBank`, `computeEddProviderEvidence` (contains the gap above)
- `lib/eddLeaderboard.ts` — `EDD_LEADERBOARD_MIN_REPORTERS`, `computeTypicalValue`, `computeEddLeaderboard`
- `lib/timingLeaderboard.ts` — `TIMING_MIN_REPORTERS`, `medianMinutes`, `computeTimingLeaderboard`
- `lib/communityRails.ts` — the `/rails` preview surface consuming both leaderboards
- `supabase/migrations/20260711033000_add_account_deletion_fk_actions.sql` — anonymization vs. cascade behavior on account deletion
- `lib/actions/deleteAccount.ts`
- `app/early-direct-deposit/page.tsx`, `app/timing/page.tsx`, `app/methodology/page.tsx`, `app/developers/page.tsx`

## Rejected alternatives

### Exposing raw report rows or counts

Rejected — raw counts are trivially inflated by repetition, and raw rows would expose reporter identity.

### A single generic confidence score

Rejected — a single number can't communicate *why* a route has weak or conflicting evidence the way a named state can.

### Treating the EDD censored value arithmetically

Rejected as a design decision for the ranked leaderboard (see the Known Implementation Gap above for where this rejection is not yet fully implemented elsewhere).

### Ranking institutions after one or two reports

Rejected for the EDD and settlement leaderboards specifically — a ranked position is a stronger claim than bank-profile-level evidence and needs a higher bar.

### Secret recency weighting

Rejected in favor of showing staleness explicitly — a silently downweighted old report is a hidden editorial judgment; a visible "stale" flag lets the reader judge for themselves.

### Employer-name collection or device fingerprinting for integrity

Rejected as disproportionate to the actual abuse risk today; revisit only alongside a dedicated privacy review, not as an incidental add-on here.

### Deleting all community evidence on account deletion

Rejected — anonymization preserves the community's collective evidence (which every consumer already treats identically to a deleted row, since both are excluded as unattributed) while still honoring the deletion request for personal data.

## Validation

`lib/routeConfidence.ts`'s `dedupeToNewestPerReporter` confirmed to discard `userId === null` rows before any other logic runs, and to be the shared function imported by `lib/bankProfile.ts` and `lib/timingLeaderboard.ts` rather than each reimplementing deduplication independently.

`lib/eddLeaderboard.ts`'s `computeTypicalValue` confirmed, by reading its implementation directly, to return a categorical result whenever the computed median would land on or need to interpolate across `EDD_DAYS_SENTINEL`.

`lib/bankProfile.ts`'s `averageExactDaysEarly()` confirmed, by reading the implementation directly, to filter out `days_early === EDD_DAYS_SENTINEL` rows before summing/dividing, and to return `null` rather than dividing by zero when no exact-valued rows remain — used identically by both the bank-level (`buildProfile`) and provider-level (`computeEddProviderEvidence`) aggregates, closing the gap described in the Amendment above.

`supabase/migrations/20260711033000_add_account_deletion_fk_actions.sql` confirmed to set `ON DELETE SET NULL` on `route_reports`, `edd_reports`, and `bank_corrections`, and `ON DELETE CASCADE` on `webhooks`.

## Future considerations

- Consider whether a full distribution/histogram view (already partially present via EDD's `distribution` buckets) should be more prominent given how much a median or categorical value can hide.
- Revisit the 2/3/5-reporter and 180-day thresholds once real report volume exists to evaluate them against.
- Coordinated-account detection remains explicitly out of scope absent a dedicated privacy-tradeoff review.
