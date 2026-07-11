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
  "ncua_credit_unions",
  "route_reports",
  "rtp_participants",
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
};

// Every SECURITY DEFINER function and the exact set of roles that should
// be able to EXECUTE it directly. `service_role` only, everywhere — none
// of these are meant to be callable by an end user's session, whether
// they're a real callable RPC (increment_rate_limit) or a trigger-only
// function (the rest; trigger execution doesn't require the firing role to
// hold EXECUTE on the trigger function itself, so locking these down too
// is intentional hardening, not a functional requirement).
export const EXPECTED_SECURITY_DEFINER_EXECUTE = {
  increment_rate_limit: ["service_role"],
  check_route_report_quota: ["service_role"],
  check_edd_report_quota: ["service_role"],
  log_bank_rail_changes: ["service_role"],
  route_reports_derive_bank_names: ["service_role"],
  // The introspection function backing this very check — its own EXECUTE
  // grant is part of what it's meant to catch drift in.
  audit_rls_manifest: ["service_role"],
};
