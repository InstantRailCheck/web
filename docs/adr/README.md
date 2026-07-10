# Architecture Decision Records

Records of significant technical decisions for InstantRailCheck — the *why* behind a
decision, as a complement to `PROJECT.md`'s changelog of *what* shipped.

## Conventions

**Date convention:** ADR decision dates use the local git commit date for the
implementation being documented (`git log --date=short`), not migration filename
timestamps. Migration filenames in this repo use UTC, which can read one calendar
day ahead of the local commit date near midnight.

**Freshness:** Every ADR should carry a "Last validated against repository" date
and note what it was grounded against (implementation, commit history, PROJECT.md,
etc). Claims about recent or same-session changes should be independently verified
against the actual commit history before an ADR is accepted — an indexed view of
the repository can lag behind very recent work.

## Index

- [0001 — Conservative Institution Name Matching](0001-conservative-institution-name-matching.md)
- [0002 — Webhook SSRF Protection and Signed Delivery](0002-webhook-ssrf-protection.md)
