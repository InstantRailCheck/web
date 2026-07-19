# ADR-0008: Layered Moderation Enforcement with Auditable, Privacy-Minimized Account State

- Status: Accepted
- Decision date: 2026-07-13 (commit `b30cfab`, v7.2.0, "Add user-level moderation: restrict/suspend/ban accounts" — introduced `user_moderation_status` and `lib/authSync.ts`; extended by v7.3.0, commit `df5f236`, 2026-07-14, adding admin risk-signal triage)
- Last validated against repository: 2026-07-19
- Grounding: implementation + commit history
- Freshness policy: changes not yet independently verified against the latest commits require review before acceptance
- Scope: content deletion, account restriction/suspension/ban, direct-client vs. Server Action enforcement, Supabase Auth reconciliation, moderation audit records, admin identity access, privacy/retention boundaries, risk triage
- Primary implementations: `lib/moderationStatus.ts`, `lib/authSync.ts`, moderation Server Actions (`lib/actions/moderateSetUserStatus.ts`, `moderateDeleteUserAccount.ts`, `moderateDelete.ts`, `revealUserEmail.ts`, `retryAuthSync.ts`), `lib/riskSignals.ts`, `lib/riskTriage.ts`, `app/admin/moderation/*`
- Related ADRs: [ADR-0002](0002-webhook-ssrf-protection.md) (webhook registration enforces the same `user_moderation_status` this ADR describes), [ADR-0007](0007-public-evidence-integrity-and-privacy.md) (account-deletion anonymization of community evidence is described there; this ADR covers the account-state side of the same deletion flow rather than restating it)

## Context

Some report tables (`route_reports`, `edd_reports`) intentionally permit direct authenticated-client inserts under RLS (`authenticated_insert` policies), rather than requiring every write to go through a Server Action — which means an app-layer-only moderation check can be bypassed entirely for those two tables by a client calling Supabase directly. Other write paths (`requestRoute`, `submitCorrection`, `addBank`, `registerWebhook`) have no such RLS-reachable bypass and are Server-Action-only. Supabase's own Auth service holds its own ban state, which can drift from this project's database intent if an external API call fails, races, or is retried out of order. Moderators need enough attribution to act on abuse without indefinitely retaining or exposing more personal data than the action requires. Automated risk signals should prioritize what a human reviews, not adjudicate truth on their own.

## Decision

1. **Enforcement lives at the lowest boundary that can actually be bypassed.** `route_reports`/`edd_reports`, both directly insertable by an authenticated client, enforce moderation status in a Postgres trigger (`check_route_report_quota`, `check_edd_report_quota`) — the only boundary that can't be routed around. Server-Action-only paths (`requestRoute`, `submitCorrection`, `addBank`, `registerWebhook`) enforce it in the application layer instead (`lib/moderationStatus.ts`'s `getUserModerationStatus`), since there is no RLS-reachable path for them to bypass.
2. **The application-layer check fails closed.** If the `user_moderation_status` lookup itself errors, `getUserModerationStatus` returns `{ blocked: true, ... }` rather than treating an unreadable status as an active account — an enforcement boundary that can't be verified must not default to permissive.
3. **`user_moderation_status` is the durable source of moderation intent.** One row per ever-moderated user (`status`, `reason_category`, `note`, `ban_expires_at`, `moderator_user_id`, `transition_id`), persisting through reactivation so both Auth-sync state and profile-visible history have somewhere to live across a status change.
4. **Account states are progressive**: `active`, `restricted`, `temporarily_banned`, `permanently_banned` (enum enforced by a check constraint). `restricted` and both banned states block new report/correction/webhook/bank-addition submissions; only the temporary-ban path carries an expiry (`ban_expires_at`), enforced by paired check constraints requiring/forbidding it based on status.
5. **Restrictions never block account self-management.** `deleteAccount()` performs no moderation-status check at all — a restricted or banned user can still delete their own account unconditionally.
6. **Status transitions and their audit record are atomic and serialized per user.** `moderate_set_user_status` takes `pg_advisory_xact_lock(hashtext('user_moderation_status'), hashtext(user_id))`, then writes the new status row and its `moderation_actions` audit row in the same transaction — a concurrent second call for the same user always sees the first call's committed result as its "previous status," never a stale pre-commit read.
7. **Supabase Auth state is reconciled from database intent, protected against out-of-order external completions.** `reconcileAuthSync` computes the desired `ban_duration` from the current `user_moderation_status` row, calls the Auth Admin API, then re-reads the row and only persists the outcome if `transition_id` still matches what it started with — a slower call from an older transition that completes after a newer one is discarded rather than overwriting the newer, correct state.
8. **Auth-sync failures are visible and retryable, not silently trusted.** `auth_sync_status` (`pending`/`synced`) is not treated as a one-way ratchet — `reconcileAuthSync` always re-applies the current desired state regardless of what the flag currently says (a `synced` flag only proves that specific transition's own call landed, never that no other call could still be in flight), and an explicit `retryAuthSync` Server Action is reachable regardless of current status.
9. **Content deletion uses an audited database function**, not an ad hoc client-side delete — `moderate_delete_submission` captures an identity-free content snapshot plus the separately-tracked `subject_user_id`, and handles the one behavioral side effect of deleting a spam/fabricated route report (reopening a matching fulfilled request if no other report still supports it) inside the same transaction.
10. **Account deletion anonymizes community evidence and fully cascades personal integrations** — described in full in [ADR-0007](0007-public-evidence-integrity-and-privacy.md); this ADR's concern is the account-state side (points 5 and 3 above), not a restatement of the anonymization mechanism itself.
11. **Moderation audit records minimize identity retention.** `moderation_actions.subject_user_id` is `ON DELETE SET NULL` (erasable); `target_id` is populated only for content-deletion actions (the deleted row's own non-personal id) and is constrained (`moderation_actions_target_shape_check`) to be null for every user-level action, so a user's UUID is never retained anywhere in this table that erasure can't reach.
12. **Email reveal is separately authorized and audited, failing closed on audit failure.** `revealUserEmail` writes the `moderation_actions` audit row *before* returning the email; if the audit insert itself fails, the function returns an error instead of the email — the disclosure never happens without a corresponding durable record of it.
13. **Administrators cannot moderate themselves or another administrator through ordinary moderation actions.** Both `moderateSetUserStatus` and `moderateDeleteUserAccount` check `admin_.id === targetUserId` and `isAdminUser(targetUser)` before proceeding; `moderate_set_user_status` also re-checks the self-moderation case at the database layer independently of the app-layer check.
14. **Risk signals are explainable, live-computed review priorities — never an automatic sanction.** `lib/riskSignals.ts` returns named `Signal[]` values consumed only by an admin-viewed triage queue (`lib/riskTriage.ts`, `app/admin/moderation/triage/page.tsx`); no code path turns a risk score directly into a restriction, ban, or deletion without a human moderator acting through the Server Actions above.
15. **Coordinated-account or device-fingerprinting detection is deliberately out of scope**, absent a demonstrated need and a dedicated privacy-tradeoff review — nothing in the codebase performs this today.

## Rationale

### An app-layer-only check can be bypassed wherever a bypass exists

`route_reports`/`edd_reports` are reachable by direct authenticated client writes; anywhere that's true, enforcement has to live in the trigger, not just the Server Action, or the check is theater for that specific path.

### An unverifiable enforcement check must deny, not allow

If the very system that says "is this account allowed to act" can't currently be read, treating that as "yes, allowed" defeats the point of having the check at all.

### External API state needs its own concurrency story

A database transaction's own locking cannot make an external HTTP call to Supabase Auth atomic with anything — `transition_id` exists specifically to let a stale external call recognize that it's stale and discard its own result, rather than trusting call-completion order.

### Punishing content should not erase who's accountable, but shouldn't retain more than necessary either

`subject_user_id` gives moderators a real, auditable link from action to account while remaining erasable — this is a narrower retention footprint than duplicating identity into every audit row's content-neutral snapshot.

### Automated signals inform triage; they do not replace judgment

A false-positive automatic ban is a worse failure mode than a slower, human-reviewed one — risk signals are a queue-ordering tool, not a decision-maker.

## Consequences

### Positive

- Enforcement cannot be bypassed through a direct client write to a table that permits one.
- Database intent and external Auth state can recover from partial/out-of-order external failures rather than drifting permanently.
- Destructive moderation actions are auditable with minimized personal-data retention.
- Community evidence survives account deletion in anonymized form (see [ADR-0007](0007-public-evidence-integrity-and-privacy.md)).
- Review signals remain human-supervised, explainable, and reversible.

### Negative

- Enforcement logic is split across Postgres triggers, RPC functions, and application code — a future new report table would need the same bypass analysis repeated to decide where its check belongs.
- Auth reconciliation is genuinely more complex than a one-way sync, as a direct consequence of tolerating out-of-order external completions.
- `moderation_actions` retention discipline (what counts as "necessary" content in a snapshot) still requires manual judgment per action type, not a general rule.
- The triage queries in `lib/riskTriage.ts` are not designed for a large report volume — a real scale increase may require redesigning them.
- A single-administrator model has no role/governance expansion yet — adding a second tier of moderators would need a deliberate follow-up decision, not just more admin accounts.

## Related implementation

- `lib/moderationStatus.ts` — `getUserModerationStatus` (app-layer, fail-closed)
- `lib/authSync.ts` — `reconcileAuthSync`, `computeBanDuration`, `sanitizeProviderError`
- `lib/actions/moderateSetUserStatus.ts`, `lib/actions/moderateDeleteUserAccount.ts`, `lib/actions/moderateDelete.ts`, `lib/actions/revealUserEmail.ts`, `lib/actions/retryAuthSync.ts`
- `lib/riskSignals.ts`, `lib/riskTriage.ts`
- `app/admin/moderation/`, `app/admin/moderation/triage/`, `app/admin/moderation/users/`
- `supabase/migrations/20260713060000_add_admin_moderation.sql` (`moderation_actions`, `moderate_delete_submission`)
- `supabase/migrations/20260714020000_add_user_moderation_status.sql` (`user_moderation_status`, `moderate_set_user_status`, `check_route_report_quota`, `check_edd_report_quota`, `bank_attributions`)
- `supabase/migrations/20260716001000_reject_inactive_bank_reports.sql` (the separate, [ADR-0006](0006-institution-synchronization.md)-owned inactive-bank triggers on the same two tables)
- `supabase/migrations/20260711033000_add_account_deletion_fk_actions.sql` (referenced from [ADR-0007](0007-public-evidence-integrity-and-privacy.md), not restated here)

## Rejected alternatives

### UI-only moderation

Rejected — a client that skips the UI entirely can still write directly to `route_reports`/`edd_reports` under RLS.

### Server-Action-only enforcement for directly-writable tables

Rejected for exactly the two tables with an RLS-reachable direct-write path — an app-layer-only check there is not a real boundary.

### Treating Supabase Auth state as the sole moderation record

Rejected — Auth has no first-class concept of "restricted" (only bans), no reason/audit trail, and no application-visible history; the database row is the durable source of intent, with Auth kept in sync as a consequence, not the other way around.

### Automatic sanctions from risk scores

Rejected — a risk signal is evidence for a human to weigh, not sufficiently reliable to act on unilaterally.

### Immediate hard deletion of all community evidence on account deletion

Rejected — see [ADR-0007](0007-public-evidence-integrity-and-privacy.md); anonymization already achieves the same public-facing effect without destroying community value.

### Permanent broad storage of revealed identity or device fingerprints

Rejected as disproportionate; email reveal is scoped to one attribute, individually audited per access, not bulk-retained.

### Unauthenticated or unaudited email access

Rejected — `revealUserEmail` requires admin authorization and fails closed if the audit write itself fails.

### Deleting enforcement rows as routine cleanup while a restriction/ban remains active

Rejected — `user_moderation_status` persists for as long as it remains the active, enforced state; nothing in this design prunes it while still in effect.

## Validation

`check_route_report_quota`/`check_edd_report_quota` (`supabase/migrations/20260714020000_add_user_moderation_status.sql`) confirmed to check `user_moderation_status` for `restricted`/`permanently_banned`/un-expired `temporarily_banned` before allowing an insert, raising an exception rather than silently rejecting.

`lib/moderationStatus.ts`'s `getUserModerationStatus` confirmed to return `{ blocked: true, ... }` on a lookup error, not `{ blocked: false }`.

`moderate_set_user_status` confirmed to raise on `p_user_id = p_moderator_id` (self-moderation) and to take a per-user advisory lock before reading the previous status.

`lib/authSync.ts`'s `reconcileAuthSync` confirmed to re-check `transition_id` after the Auth API call and discard a result if it no longer matches, looping to re-apply the current state rather than returning a stale result.

`lib/actions/deleteAccount.ts` confirmed to contain no call to `getUserModerationStatus` or any other moderation check.

`lib/actions/revealUserEmail.ts` confirmed to insert the audit row before returning the email, and to return an error (not the email) if that insert fails.

`lib/riskSignals.ts`/`lib/riskTriage.ts` confirmed to feed only an admin-viewed queue, with no code path connecting a computed signal directly to a status change or deletion.

No fingerprinting, device-ID, or coordinated-account detection code found anywhere in the codebase, confirmed by direct search.

## Future considerations

- A second tier of moderator roles (beyond the current single-administrator model) needs its own governance decision before it's added.
- `lib/riskTriage.ts`'s queries may need redesign if report volume grows substantially.
- Formal retention-period guidance for `moderation_actions` snapshots, beyond "minimize what's stored," is not yet written down.
- Revisit whether coordinated-account detection is ever warranted, only alongside a dedicated privacy review — not as an incidental addition to this system.
