# ADR-0001: Conservative Institution Name Matching for Rail Participation

- Status: Accepted
- Decision date: 2026-07-07
- Amended: 2026-07-19 (v8.0/v8.1 duplicate-charter expansion — see Amendment below)
- Last validated against repository: 2026-07-19
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: FedNow, RTP, and Zelle participant matching
- Primary implementation: `lib/railParticipationMatch.ts` (shared matcher), called from `lib/railParticipation.ts` (request-time) and `scripts/backfill-rail-participation.mjs` (bulk backfill)
- Related ADRs: [ADR-0006](0006-institution-synchronization.md) (the duplicate-name institutions this amendment reacts to are created by the sync described there)

## Context

InstantRailCheck enriches bank records by comparing institution names against participant directories for FedNow, RTP, and Zelle.

The source datasets often use formal legal names, while InstantRailCheck may store shorter consumer-facing names. Exact equality alone therefore misses legitimate relationships between a brand name and its longer official name.

An earlier substring fallback was too permissive and produced false positives when:

- A short name appeared inside an unrelated word, such as `US Bank` matching `Pegasus Bank`.
- A generic name appeared in multiple distinct institutions, such as `Farmers`.
- A truncated candidate removed the words that distinguished one institution from another.

For verified rail participation, a false positive is materially worse than a missing badge because it presents unsupported transfer capability as confirmed.

## Decision

Use a conservative, layered institution-name matching strategy:

1. Normalize the input name by:
   - Removing commas and periods.
   - Trimming surrounding whitespace.
   - Splitting on one or more whitespace characters.
   - Lowercasing each generated candidate.

2. Attempt exact matches from the complete name down to a minimum candidate length:
   - Multi-word names may be progressively truncated.
   - Single-word names remain eligible for exact matching.
   - An exact match is accepted immediately.

3. Permit substring matching only for the complete, untruncated input name.

4. Filter substring results using a whole-word regular-expression boundary.

5. Accept a substring result only when it resolves to exactly one distinct participant name.

6. Treat zero matches or multiple distinct matches as no match.

This implements the project-wide data-quality principle:

> Blank over wrong.

## Rationale

### Exact matches remain the strongest signal

Progressive exact matching allows shorter brand names to match formal source names when a clean canonical candidate exists, without introducing fuzzy similarity scoring.

### Truncated substring matching is unsafe

Truncation may remove the portion of the institution name that establishes identity. A substring match against that shortened value may correctly identify some institution without proving it is the intended one.

Substring matching is therefore restricted to the original complete name.

### Word boundaries prevent character-overlap collisions

A raw SQL substring query can match characters embedded inside unrelated words. Applying a whole-word boundary prevents cases such as `us bank` matching inside `pegasus bank`.

### Uniqueness is required

Word boundaries alone do not make generic names safe. If a candidate matches multiple distinct institutions, the result remains ambiguous and must not be accepted.

### False negatives are recoverable

A missing participation badge can later be corrected through improved source data, curated aliases, or manual review. A false verified badge directly undermines user trust.

## Consequences

### Positive

- Eliminates known false positives caused by unrestricted substring matching.
- Prevents ambiguous generic names from being accepted.
- Preserves legitimate exact matches for shortened institution names.
- Produces deterministic and explainable behavior.
- Aligns enrichment with InstantRailCheck's trust model.

### Negative

- Some legitimate institutions remain unmatched.
- Abbreviations, mergers, aliases, and materially different brand/legal names may require explicit mappings.
- The request-time implementation may perform multiple database queries per institution.
- JavaScript `\b` word boundaries are ASCII-oriented and may not behave ideally for every possible institution name.

## Related implementation

The shared, duplicate-safe matcher lives in:

- `lib/railParticipationMatch.ts` — `matchInstitution()` (name+location matching) and `resolveRailFlag()` (turns a match result into the flag value that should actually be written)

Called from:

- `lib/railParticipation.ts` (request-time, per-bank)
- `scripts/backfill-rail-participation.mjs` (bulk, preloads participant data into memory rather than per-bank database round trips — a full run takes under 2 minutes)

Identifier-based enrichment for already-linked banks (FDIC/NCUA official data, not rail participation — see Amendment below) lives in:

- `lib/officialInstitutionMatch.ts` — `resolveOfficialMatch()`

The related asset-enrichment logic in:

- `scripts/backfill-bank-assets.mjs`

uses the same broader principles of whole-word matching, ambiguity detection, and refusing multi-hit results.

Read-only audit, run against production both before and after an institution-directory sync apply, never auto-correcting:

- `scripts/audit-duplicate-name-rail-flags.mjs`

Tests: `lib/railParticipationMatch.test.ts`.

## Rejected alternatives

### Raw substring matching

Rejected because it permits embedded-character collisions and ambiguous multi-institution matches.

### Substring matching on truncated candidates

Rejected because truncation may discard the identifying portion of the institution name.

### Accepting the first result

Rejected because database result order is not evidence of institutional identity.

### Fuzzy string similarity

Rejected because a similarity score does not establish identity and would introduce thresholds that are difficult to justify, test, and audit.

### Requiring complete exact equality only

Rejected because consumer-facing names and official legal names frequently differ through punctuation, suffixes, and predictable formal wording.

## Validation

The revised strategy corrected previously stored participation flags that could not be justified under the conservative rules.

A confirmed example was US Bank's RTP participation flag, which had only been set because the previous substring logic matched `US Bank` inside `Pegasus Bank`.

## Amendment (2026-07-19): duplicate-charter expansion

**Context.** v8.0's complete FDIC/NCUA directory sync (see [ADR-0006](0006-institution-synchronization.md)) made duplicate legal names routine — 82 duplicate-name groups / 86 banks / 143 bank-rail flag pairs were found needing review the first time this was audited (v8.4.1, commit `2060050`). A name match alone was always ambiguous the moment two banks share a name: this ADR's original rules assumed a name match uniquely identified a bank, which stopped being true once duplicate legal names became a supported, expected state rather than a data-quality defect.

**What changed** (v8.1.0, commit `c0735b6`, 2026-07-16): `matchInstitution()` in `lib/railParticipationMatch.ts` extends the original strategy rather than replacing it:

- For a bank whose normalized name (`banks.name_normalized`) is unique (no siblings), behavior is unchanged from the original decision: an unambiguous name match is accepted outright.
- For a bank in a duplicate-name group, a name match alone is no longer sufficient. The candidate's location must also be present, match this bank's own city/state, **and** this bank's location must itself be unique within its duplicate-name group — a location match that doesn't distinguish this bank from a same-city/state sibling is `ambiguous`, not accepted, even with a clean name hit.
- FedNow's participant data carries city+state; RTP carries state only (so same-state duplicate siblings remain permanently ambiguous on RTP, by design — there is no available evidence to resolve them); Zelle carries no location data at all, so **any** duplicate-name-group bank is always `ambiguous` on Zelle, never auto-matched.
- `ambiguous` never sets or clears an existing flag (`resolveRailFlag`): `null` stays `null`, an existing `true` or `false` is preserved exactly. This is the same "blank over wrong" principle applied to the new ambiguity case, not a new exception to it.

**One-time historical exception, not an ongoing rule change.** The v8.4.1 audit surfaced 143 bank-rail pairs where an existing `true` flag could no longer be justified under the new duplicate-aware rules — these predated duplicate-safe matching entirely and had never been evaluated against it. A one-time correction (v8.4.2) reset all 143 pairs to `null` (unconfirmed — not "not participating"), deliberately overriding the normal never-downgrade-`true` rule for this single historical cleanup: a production backup was taken first, a dry run matched the audit's findings exactly (zero drift), and the applied result was verified by re-running the audit, which reported zero remaining flagged pairs. Current code never does this — `resolveRailFlag()` unconditionally preserves an existing `true`. Any *future* discovery of an unjustified `true` value requires the same kind of explicit, reviewed, backed-up one-time correction; it is not something the matcher or the sync will ever do automatically.

**Future considerations, revisited:**

- ~~Direct matching on source-provided identifiers instead of names~~ — implemented, but only for **official FDIC/NCUA enrichment** (`lib/officialInstitutionMatch.ts`'s `resolveOfficialMatch()`, used once a bank is linked to a real charter). This does **not** extend to rail-participation matching, which remains this ADR's actual scope: FedNow/RTP/Zelle participant lists carry no FDIC certificate or NCUA charter number to match against, so rail matching is still necessarily name+location based and will remain so unless those source lists ever gain a stable identifier of their own.
- Curated aliases tied to stable institution identifiers, explicit manual overrides with provenance, and Unicode/non-ASCII name handling remain open — nothing in the v8.1 expansion addressed these.
- Automated test coverage for the original word-boundary/truncation/ambiguity rules remains in place; new coverage for the duplicate-group cases (unique-location match, same-state RTP ambiguity, Zelle-always-ambiguous, non-duplicate banks unaffected) was added in `lib/railParticipationMatch.test.ts`.

Any future enhancement must preserve the conservative acceptance rule — including its extension to duplicate-name groups.
