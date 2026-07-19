# Architecture Decision Records

Records of significant technical decisions for InstantRailCheck — the *why* behind a
decision, as a complement to `PROJECT.md`'s changelog of *what* shipped.

## Conventions

**Date convention:** ADR decision dates use the local git commit date for the
implementation being documented (`git log --date=short`), checked against the
specific commit(s) that introduced it — not inferred from another document.
Two known pitfalls, both of which have produced an off-by-one-day error in
past ADRs:

- Migration filenames in this repo use UTC, which can read one calendar day
  ahead of the local commit date near midnight.
- `PROJECT.md` version headers (e.g. "shipped July 8 2026") record when a
  *release* shipped, not necessarily the local commit date of every change
  bundled into it. A release can include commits from the day before.

**Freshness:** Every ADR should carry a "Last validated against repository" date
and note what it was grounded against (implementation, commit history, PROJECT.md,
etc). Claims about recent or same-session changes should be independently verified
against the actual commit history before an ADR is accepted — an indexed view of
the repository can lag behind very recent work.

## Index

- [0001 — Conservative Institution Name Matching](0001-conservative-institution-name-matching.md)
- [0002 — Webhook SSRF Protection and Signed Delivery](0002-webhook-ssrf-protection.md)
- [0003 — Nonce-Based Content Security Policy](0003-nonce-based-csp.md)
- [0004 — Public API Subdomain and Legacy API Redirects](0004-public-api-subdomain.md)
- [0005 — SEO-Friendly Bank Slugs Over UUID Profile URLs](0005-seo-friendly-bank-slugs.md)
- [0006 — Staged, Review-Bound Institution Synchronization with Non-Destructive Lifecycle Management](0006-institution-synchronization.md)
- [0007 — Attributable, Deduplicated Public Evidence Without Raw User Exposure](0007-public-evidence-integrity-and-privacy.md)
- [0008 — Layered Moderation Enforcement with Auditable, Privacy-Minimized Account State](0008-moderation-enforcement.md)

## Related ADRs

Cross-references between ADRs that share implementation or depend on each other's decisions, so a related decision is linked rather than re-explained:

- 0001 ↔ 0006 — duplicate-name institutions (created by the sync in 0006) are what 0001's v8.1 amendment reacts to.
- 0002 ↔ 0008 — webhook registration enforces `user_moderation_status`, the record 0008 describes.
- 0004 ↔ 0007 — the public API is one of the surfaces where 0007's aggregate-only rule is exposed.
- 0005 ↔ 0006 — duplicate legal names (0006) are what 0005's slug-collision handling exists to disambiguate.
- 0006 ↔ 0007 — inactive institutions, defined in 0006, are excluded from the leaderboards 0007 describes.
- 0007 ↔ 0008 — account-deletion anonymization of community evidence (0007) is one consequence of the account-state model (0008); each ADR owns its half and links to the other instead of duplicating it.
