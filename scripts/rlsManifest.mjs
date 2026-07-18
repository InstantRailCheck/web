// The expected, hand-reviewed state of every RLS policy and SECURITY
// DEFINER function grant in production, as of the v6.1.x hardening pass
// (2026-07-11). audit-rls-manifest.mjs diffs the real database against
// this file and fails loudly on any drift — whether that's a regression
// (someone added a policy via the dashboard, bypassing migration review,
// the same way edd_reports/route_reports picked up an undocumented
// UPDATE/DELETE policy before Phase 1b caught it) or a deliberate change
// that simply forgot to update this file. Either way, the fix is either
// "revert the drift" or "update this manifest to match, in its own
// reviewed commit" — never "silently let the script stop complaining."
//
// Table-level grants (anon/authenticated having INSERT/UPDATE/DELETE/etc.
// at the GRANT level) are NOT checked here and are expected to be broad —
// that's Supabase's standard default for every new table, and RLS policies
// are the actual, intended enforcement layer sitting in front of them.
// Confirmed broad-by-default via direct query against production
// (2026-07-11): every table grants anon/authenticated full CRUD at the
// table-privilege level regardless of how locked-down its RLS is. Auditing
// table-level grants here would either falsely flag Supabase's normal
// baseline on every table, or require maintaining a second, redundant
// manifest that doesn't reflect the actual security boundary.

// Every table's expected RLS-enabled status. All of them should be `true` —
// a table with RLS disabled has no policy enforcement at all regardless of
// what policies are defined on it.
export const EXPECTED_RLS_ENABLED_TABLES = [
  "api_rate_limits",
  "bank_corrections",
  "bank_rail_history",
  "banks",
  "edd_reports",
  "fednow_participants",
  "moderation_actions",
  "ncua_credit_unions",
  "ncua_reference_sync_log",
  "route_reports",
  "sync_runs",
  "sync_staging_institutions",
  "route_requests",
  "rtp_participants",
  "user_moderation_status",
  "bank_attributions",
  "webhook_deliveries",
  "webhooks",
  "zelle_participants",
];

// Every expected policy, per table. A table not listed here (or listed
// with an empty array) is expected to have ZERO policies — meaning
// anon/authenticated get no access at all, everything goes through the
// admin/service-role client server-side.
export const EXPECTED_POLICIES = {
  banks: [{ name: "Allow public read access", cmd: "SELECT", roles: ["public"] }],
  bank_rail_history: [{ name: "bank_rail_history is publicly readable", cmd: "SELECT", roles: ["anon", "authenticated"] }],
  fednow_participants: [{ name: "Allow public read access", cmd: "SELECT", roles: ["public"] }],
  rtp_participants: [{ name: "Allow public read access", cmd: "SELECT", roles: ["public"] }],
  zelle_participants: [{ name: "Allow public read access", cmd: "SELECT", roles: ["public"] }],
  ncua_credit_unions: [{ name: "Allow public read access", cmd: "SELECT", roles: ["public"] }],
  // Own-row INSERT only — reads go through the server-only admin-client
  // path (Phase 1b, v6.1.0) so a repeat/unattributed reporter can never be
  // read back client-side, and UPDATE/DELETE are intentionally absent
  // (self-reported evidence is meant to be append-only).
  route_reports: [{ name: "authenticated_insert", cmd: "INSERT", roles: ["authenticated"] }],
  edd_reports: [{ name: "authenticated_insert", cmd: "INSERT", roles: ["authenticated"] }],
  // Server-only: no client-direct policy of any kind.
  bank_corrections: [],
  webhooks: [],
  webhook_deliveries: [],
  api_rate_limits: [],
  // route_requests (v7.0.0): the only write path is the authenticated
  // requestRoute Server Action via the admin client — no RLS policy is
  // needed or added, so requester identity is private by construction.
  route_requests: [],
  // moderation_actions (v7.x): private audit-only record of admin deletes.
  // Server-only via the admin client, same reasoning as bank_corrections/
  // webhooks — no client (anon or authenticated) should ever read this.
  moderation_actions: [],
  // user_moderation_status (v7.2): private per-user enforcement state.
  // Server-only, same reasoning as moderation_actions.
  user_moderation_status: [],
  // bank_attributions (v7.2): private bank-addition attribution — banks
  // itself is publicly readable, so this can never have a client-facing
  // policy without leaking who added what.
  bank_attributions: [],
  // sync_runs / sync_staging_institutions / ncua_reference_sync_log
  // (v8.0): server-only, only ever read/written by
  // scripts/sync-institution-directory.mjs and
  // scripts/sync-ncua-directory.mjs via the service-role key.
  sync_runs: [],
  sync_staging_institutions: [],
  ncua_reference_sync_log: [],
};

// Every SECURITY DEFINER function and the exact set of roles that should
// be able to EXECUTE it directly. `service_role` only, everywhere — none
// of these are meant to be callable by an end user's session, whether
// they're a real callable RPC (increment_rate_limit) or a trigger-only
// function (the rest; trigger execution does NOT require the firing role
// to hold EXECUTE on the trigger function itself — confirmed directly via
// a raw SQL simulation, see the false-alarm note below).
//
// A 2026-07-11 investigation briefly (incorrectly) concluded this needed
// changing after authenticated INSERTs into route_reports/edd_reports
// started failing with a "row-level security policy" error. The real
// cause: the verification scripts chained .insert(...).select(...), which
// makes PostgREST add a RETURNING clause — and since route_reports/
// edd_reports deliberately have no SELECT policy for authenticated (Phase
// 1b, v6.1.0 lockdown), RETURNING can't read the row back, and Postgres
// reports that under the same 42501 code as an RLS violation. Confirmed
// via a raw SQL simulation (SET ROLE authenticated + request.jwt.claims,
// rolled back): the same INSERT succeeds without RETURNING and fails only
// once RETURNING is added — regardless of trigger-function EXECUTE grants.
// The real application code never chains .select() after .insert() and
// was never affected. See migrations 20260711034000 (the incorrect fix)
// and 20260711035000 (its revert) for the full history.
export const EXPECTED_SECURITY_DEFINER_EXECUTE = {
  increment_rate_limit: ["service_role"],
  check_route_report_quota: ["service_role"],
  check_edd_report_quota: ["service_role"],
  log_bank_rail_changes: ["service_role"],
  route_reports_derive_bank_names: ["service_role"],
  banks_set_updated_at: ["service_role"],
  // v7.0.0: fires on every attributable route_reports insert to mark
  // matching active route_requests rows fulfilled. Trigger-only, same
  // reasoning as route_reports_derive_bank_names above.
  route_requests_fulfill_on_report: ["service_role"],
  // The introspection function backing this very check — its own EXECUTE
  // grant is part of what it's meant to catch drift in.
  audit_rls_manifest: ["service_role"],
  // v7.x moderation: the one real callable RPC here (invoked via
  // admin.rpc(...) from lib/actions/moderateDelete.ts, itself gated by
  // requireAdmin() before ever reaching this call) — service_role only,
  // never anon/authenticated directly.
  moderate_delete_submission: ["service_role"],
  // v7.2 user-level moderation: same reasoning — invoked via admin.rpc(...)
  // from lib/actions/moderateSetUserStatus.ts, gated by requireAdmin()
  // before ever reaching this call.
  moderate_set_user_status: ["service_role"],
  // v7.2: invoked via admin.rpc(...) from lib/actions/addBank.ts, gated by
  // an authenticated-user check (any signed-in user, not admin-only) before
  // ever reaching this call — same authorization level as banks/addBank
  // already had before this RPC existed.
  add_bank_with_attribution: ["service_role"],
  // v8.0 institution lifecycle (§11): rejects edd_reports writes against
  // an inactive bank at the table itself, same reasoning as
  // route_reports_derive_bank_names above — trigger-only.
  edd_reports_reject_inactive_bank: ["service_role"],
  // v8.0 authoritative sync (§6): the one real callable RPC in the sync
  // path, invoked only from scripts/sync-institution-directory.mjs with
  // the service-role key — never from client code, never via anon/
  // authenticated PostgREST access.
  finalize_sync_run: ["service_role"],
  // v8.0: shared hash helper called by both the CLI at staging time and
  // finalize_sync_run itself — see the migration comment for why this
  // isn't duplicated in JS.
  compute_banks_base_snapshot_hash: ["service_role"],
  // Code review finding (post-v8.3.1): same shape as
  // compute_banks_base_snapshot_hash above, but over sync_staging_institutions
  // — proves the staged rows finalize_sync_run is about to apply are still
  // exactly what was staged/reviewed, not just that `banks` hasn't drifted.
  compute_staging_snapshot_hash: ["service_role"],
  // v8.0 §5: invoked only from scripts/apply-reconciliation.mjs after that
  // script's own live re-corroboration check — never from client code.
  apply_bank_reconciliation: ["service_role"],
};
