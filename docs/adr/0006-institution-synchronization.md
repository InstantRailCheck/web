# ADR-0006: Staged, Review-Bound Institution Synchronization with Non-Destructive Lifecycle Management

- Status: Accepted
- Decision date: 2026-07-16 (v8.0.0, commit `8ffb92b` — schema + `finalize_sync_run`; the architecture continued through v8.11.4, commit `a241767`, `sync_protected_fields`)
- Last validated against repository: 2026-07-19
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: FDIC/NCUA directory synchronization into `banks`, reconciliation of existing unlinked institutions, source ownership and identifiers, the staging/apply state machine, inactivation/reactivation, protected manual fields, production safety and rollback
- Primary implementations: `lib/institutionSync.ts`, `lib/institutionSlug.ts`, `scripts/sync-institution-directory.mjs`, `supabase/migrations/20260716000000_add_institution_directory_schema.sql`, `supabase/migrations/20260716002000_add_institution_sync_tables.sql`, `supabase/migrations/20260716004000_add_finalize_sync_run.sql`
- Related ADRs: [ADR-0001](0001-conservative-institution-name-matching.md) (this sync is what made duplicate-name institutions routine, which ADR-0001's v8.1 amendment reacts to), [ADR-0005](0005-seo-friendly-bank-slugs.md) (slug collision handling for duplicate legal names)

## Context

The directory began as a manually curated/top-institution subset built by one-off import scripts, then expanded to the complete active FDIC/NCUA universe. Legal names and websites are not unique identities — duplicate legal names (e.g. six separate Pinnacle Bank charters) and shared websites are both common and legitimate. Source feeds can be incomplete, truncated, or malformed on a given run. A dry-run review and the later production apply are not guaranteed to happen against the same production state — production can change in between. A naive upsert, or a "missing from this fetch means delete," could duplicate, misattribute, or silently erase real institutions.

Separately, 546 pre-existing bank records were unlinked to any FDIC/NCUA identifier and needed reconciliation against the same authoritative sources before the ongoing sync could safely treat them as either linked or genuinely community-only.

## Decision

1. **FDIC certificate and NCUA charter number are the only authoritative source identities.** `banks.source_authority` (`'fdic' | 'ncua' | null`) and a check constraint (`banks_source_authority_identifier_check`) enforce that a row can carry at most one of `fdic_cert`/`ncua_charter_number`, and only alongside the matching `source_authority`.
2. **Existing unlinked rows are reconciled conservatively before any ongoing sync.** `scripts/audit-unlinked-banks.mjs` (read-only) proposes matches requiring a normalized-name match **and** a corroborating field (website or phone); anything else is `unresolved`, never assumed to be community-only. `scripts/apply-reconciliation.mjs` applies only human-reviewed matches, re-confirming each one is still unlinked and re-corroborating against current data before writing.
3. **Synchronization is staged first, applied only by a reviewed run ID.** `sync_runs` (state machine: `running → staged → applying → applied`, plus `failed` / `guard_blocked` / `expired`) and `sync_staging_institutions` hold every observed source row — including rejected ones — before anything in `banks` is touched.
4. **Every observed identifier is staged, valid or rejected.** A row with a missing identifier, or one that duplicates another identifier within the same fetch, is staged as `status = 'rejected'` (every occurrence of a duplicate is rejected, not just the later ones) rather than silently dropped or arbitrarily deduplicated. A rejected row with a real, previously-linked identifier is excluded from the inactivation candidate set — a bad source row can never inactivate a real institution.
5. **Guards fail closed.** Exact-count agreement against the source's own reported total, a reject-rate ceiling (>1% aborts), and a relative retention floor (≥97% of the last applied run's count, skipped with an explicit note on a source's first-ever run) are all fatal — `status = 'guard_blocked'`, no override, only a fresh run can proceed. An inactivation-cap condition (absolute/relative threshold on how many institutions a run would inactivate) is **not** fatal: it produces a normal `staged` run with `requires_override_reason = 'inactivation_cap_exceeded'`, and applying it requires an explicit `--allow-large-inactivation` flag.
6. **Apply is bound to both the reviewed source snapshot and the reviewed production base state.** `source_snapshot_hash` proves the staged rows haven't changed since review; `base_snapshot_hash` (`compute_banks_base_snapshot_hash`) proves the production `banks` rows in scope haven't changed either — computed over every in-scope row regardless of whether its identifier ended up valid, rejected, or absent, so it also covers rows about to be inactivated. A mismatch on either aborts finalize with `status = 'failed'`.
7. **Finalization is a single serialized, atomic transaction.** `finalize_sync_run(run_id)` takes `pg_advisory_xact_lock(hashtext('institution_sync_finalize'))` plus a row lock on the run, re-validates both hashes and staged counts, applies every valid insert/update/reactivation, then inactivates, then transitions the run to `applied` — all inside one transaction, all with `WHERE status = <expected>` compare-and-set semantics rather than a plain read-then-write.
8. **Sync never hard-deletes.** A source institution missing from the latest fetch becomes `is_active = false, inactive_reason = 'unlisted'`. Only an `'unlisted'` institution can be automatically reactivated if it reappears; one manually marked `'closed'` or `'merged'` is left untouched and only surfaced (`reappeared_manually_inactive`) for human review.
9. **Existing IDs and slugs never change through sync.** A matched update never writes `id` or `slug`; a rename updates `name` only.
10. **Manually verified fields can be protected from the next sync's overwrite.** `banks.sync_protected_fields` (a text array, e.g. `{'website'}`) is checked field-by-field inside `finalize_sync_run` — a protected field keeps its current value instead of the freshly-synced one, for both the write and the changed/unchanged diff. `apply_bank_correction` automatically adds a field to this list the moment an auto-applied community correction changes it, so a corrected value can't be silently reverted by the next monthly sync.
11. **Institution-referencing writes are enforced against inactive banks at the database boundary, not just in Server Actions.** `route_reports` (insert-unconditional, update-only-if-the-reference-changes) and `edd_reports` (same rule, added from scratch — it had no such trigger before) both reject a reference to an inactive bank.
12. **Every applied run retains full audit detail.** `sync_runs.report` (jsonb) plus a private, non-committed JSON report file capture per-run counts and diffs; reports are uploaded as short-retention CI artifacts, never logged or committed in full (real institution data).
13. **Automation stages, but never automatically applies.** The scheduled workflow (`sync-data.yml`) always runs the sync with `--source {fdic|both}` only — staging a reviewable run and uploading its report as an artifact. `finalize_sync_run`/`--apply` is never invoked by CI; it requires a human to run `--apply --run-id <uuid>` (optionally `--allow-large-inactivation`) after reviewing that specific run's report. Deciding whether to wire an unattended `--apply` into the schedule is an explicit, separate, later decision — not part of what shipped.
14. **A manual `workflow_dispatch` can only launch one path at a time.** The workflow declares a `sync_scope: {fdic, both}` input, and each job's `if` checks it explicitly — a bare dispatch trigger does not fan out into every job racing simultaneously.

## Rationale

### Names and websites can't be identity

Duplicate legal names and shared websites are legitimate and common; only a regulator-issued identifier can be trusted to mean "this exact charter."

### A dry run must mean something

If the diff actually applied can differ from the diff that was reviewed — because the source changed, or because production changed — a human "approval" of a dry run is not a real approval of what happens next. Binding apply to both a source snapshot hash and a production base-state hash closes both gaps.

### Absence of evidence is not evidence of closure

A charter absent from one fetch could mean a source hiccup, not a real closure. Inactivating on sight, with no distinction from a genuine multi-run absence, risks marking real institutions unlisted on transient data problems — the guard/retention thresholds and count-agreement checks exist so a truncated or malformed fetch aborts before it can look like a legitimate closure wave.

### Human corrections should survive automation

A manually verified field (e.g. a website corrected because the source data is truncated in a way that will never self-correct) being silently overwritten by the next scheduled run is worse than the sync not running at all for that field — `sync_protected_fields` lets automation and manual correction coexist without one undoing the other.

### Staging beats an append-only import

The original one-off import scripts had no concept of "review before it's real" — every row landed directly. Staging first, with an explicit human `--apply` step bound to a specific reviewed run, makes a bad fetch a non-event rather than a production incident.

## Consequences

### Positive

- Idempotent, reviewable full-directory updates — duplicate legal names are safe by construction.
- Historical URLs and evidence survive a closure (a bank is inactivated, never deleted).
- A source outage or truncated fetch cannot silently mass-inactivate or mass-misattribute institutions.
- Human corrections can durably survive automated re-sync.
- CI never applies unreviewed production changes — the worst a scheduled run can do unattended is stage a run that nobody has reviewed yet.

### Negative

- Considerably more schema and operational complexity than a plain upsert script.
- Staging storage accumulates across runs (`sync_staging_institutions` is not currently pruned).
- A review/apply cycle fails (by design) if production drifts in between — a fresh run is required, which costs time during an active investigation.
- The single finalize transaction processes the full diff at once; lock duration scales with the size of a run.
- Manual backup and `--apply` discipline remain operational dependencies rather than something the system enforces on its own — nothing currently prevents an operator from running `--apply` without having taken a backup first.

## Related implementation

Pure diff/guard/slug logic (unit tested):

- `lib/institutionSync.ts`
- `lib/institutionSlug.ts`

Sync execution and CLI:

- `scripts/sync-institution-directory.mjs` (`--source {fdic|both}` to stage, `--apply --run-id <uuid> [--allow-large-inactivation]` to apply)

Reconciliation of pre-existing unlinked institutions:

- `scripts/audit-unlinked-banks.mjs` (read-only)
- `scripts/apply-reconciliation.mjs` (applies only human-reviewed matches)

Duplicate-institution and rail-flag auditing (read-only, never auto-correcting):

- `scripts/audit-duplicate-institutions.mjs`
- `scripts/audit-duplicate-name-rail-flags.mjs`

Schema and the finalize transaction:

- `supabase/migrations/20260716000000_add_institution_directory_schema.sql` (`source_authority`, lifecycle columns/constraints, duplicate-name-safe indexing)
- `supabase/migrations/20260716002000_add_institution_sync_tables.sql` (`sync_runs`, `sync_staging_institutions`)
- `supabase/migrations/20260716003000_add_ncua_reference_sync_log.sql` (independent NCUA source-count verification)
- `supabase/migrations/20260716004000_add_finalize_sync_run.sql` (`finalize_sync_run`)
- `supabase/migrations/20260718033000_harden_finalize_sync_run_staging_integrity.sql`
- `supabase/migrations/20260719083000_add_sync_protected_fields.sql` (`sync_protected_fields`, `apply_bank_correction` integration)
- `supabase/migrations/20260716001000_reject_inactive_bank_reports.sql` (`route_reports`/`edd_reports` inactive-bank enforcement triggers)

Automation:

- `.github/workflows/sync-data.yml` (stages only; never invokes `--apply`)

Tests:

- `scripts/db-tests/institutionSync.check.mjs`, `institutionSyncScale.check.mjs`

## Rejected alternatives

### Name or website as identity

Rejected because neither is unique — duplicate legal names and shared websites are both real and common.

### One-phase fetch-and-apply

Rejected because it gives no opportunity to review a diff before it becomes real, and can't distinguish a bad fetch from a legitimate directory change.

### Re-fetching source data during apply

Rejected because it would let the diff actually applied differ from whatever a human reviewed at staging time.

### Hard deletion for absent rows

Rejected because a source absence can be transient, and because historical evidence/URLs tied to a real, since-closed institution should survive.

### Blind replay of a reviewed reconciliation file without re-checking

Rejected because a match reviewed against data that has since changed is no longer proven — re-corroboration at apply time is required.

### Automatic reversal of a human closure/merge decision

Rejected because a manual decision represents information the automated source data doesn't have (e.g. a known merger); an automated sync reappearance should prompt review, not silently override it.

### Per-row best-effort writes allowing a partially applied directory

Rejected in favor of one atomic transaction — a partially applied sync (some institutions updated, others not, mid-failure) is a worse state than the run failing outright and being retried.

## Validation

`finalize_sync_run` (`supabase/migrations/20260716004000_add_finalize_sync_run.sql`, hardened `20260718033000`, extended `20260719083000`) confirmed to: take the advisory lock and row lock before touching anything; re-validate `source_snapshot_hash` and `base_snapshot_hash` before applying; apply protected-field substitution per row; reactivate only `inactive_reason = 'unlisted'` rows, leaving `'closed'`/`'merged'` rows untouched and counted separately; use `WHERE status = 'applying'` on its own final `UPDATE ... SET status = 'applied'`, raising if that returns no rows (verified as an unreachable branch under the lock, not dead code with no purpose).

`.github/workflows/sync-data.yml` confirmed to run `sync-institution-directory.mjs` with `--source` only, on both the weekly (FDIC-only) and monthly (`both`, `needs: sync-ncua-and-assets`) schedules, uploading the JSON report as a 90-day-retention artifact; no job in this workflow ever passes `--apply`.

`scripts/sync-institution-directory.mjs` confirmed to expose `checkExactCountGuard`, `checkRejectRateGuard`, `checkRetentionGuard`, and `checkInactivationCap` from `lib/institutionSync.ts`, and to require `--allow-large-inactivation` specifically for a run flagged `requires_override_reason`.

## Future considerations

- `sync_staging_institutions` has no pruning/retention policy yet — storage will grow unboundedly across runs.
- Deciding whether to wire an unattended `--apply` into the schedule remains a deliberate, separate future decision, contingent on a longer real-world track record of manual applies.
- Nothing currently enforces that a backup was taken before a manual `--apply` — this is operator discipline, not a system guarantee.
- `'closed'`/`'merged'` inactivation reasons are schema-supported but not yet set by any implemented admin action — a manual-closure workflow is still future work.
