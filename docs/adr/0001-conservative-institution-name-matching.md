# ADR-0001: Conservative Institution Name Matching for Rail Participation

- Status: Accepted
- Decision date: 2026-07-07
- Last validated against repository: 2026-07-09
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: FedNow, RTP, and Zelle participant matching
- Primary implementation: `lib/railParticipation.ts`

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

The request-time implementation lives in:

- `lib/railParticipation.ts`

The bulk backfill implementation lives in:

- `scripts/backfill-rail-participation.mjs`

The bulk script has already been optimized to preload participant data into memory rather than performing per-bank database round trips, reducing a full run from more than 35 minutes to under 2 minutes.

The related asset-enrichment logic in:

- `scripts/backfill-bank-assets.mjs`

uses the same broader principles of whole-word matching, ambiguity detection, and refusing multi-hit results.

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

## Future considerations

Any future enhancement must preserve the conservative acceptance rule.

Possible improvements include:

- Curated aliases tied to stable institution identifiers.
- Direct matching on source-provided identifiers instead of names.
- Explicit manual overrides with provenance.
- Automated tests covering:
  - punctuation,
  - whitespace normalization,
  - ambiguous names,
  - embedded substrings,
  - progressive truncation,
  - single-word institutions,
  - aliases,
  - Unicode and non-ASCII names.
