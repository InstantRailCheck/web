-- Fixes a live production regression from v6.1.4: revoking EXECUTE on
-- every SECURITY DEFINER function from anon/authenticated (correct for the
-- one real callable RPC, increment_rate_limit) also revoked it from three
-- trigger functions that fire *during* an authenticated-role INSERT:
-- check_route_report_quota, check_edd_report_quota, and
-- route_reports_derive_bank_names.
--
-- Contrary to the assumption v6.1.4 was built on (and PostgreSQL's own
-- CREATE TRIGGER docs, which only document EXECUTE as required at trigger
-- *creation* time), Supabase's stack in practice does require the firing
-- role to hold EXECUTE on a trigger function for it to fire successfully.
-- Revoking it makes every authenticated INSERT into route_reports/
-- edd_reports fail with SQLSTATE 42501 (insufficient_privilege) — which
-- PostgREST then reports as a generic "row-level security policy"
-- violation, since it maps that SQLSTATE to that message regardless of
-- the underlying cause, making this look like an RLS bug rather than a
-- privilege one. Confirmed via a live authenticated-client insert on both
-- tables before and after this fix.
--
-- log_bank_rail_changes is NOT included here: it only fires on writes to
-- `banks`, and every write path to that table goes through the admin/
-- service-role client (no authenticated-role INSERT/UPDATE policy exists
-- on banks at all), so it never needed this grant.
grant execute on function public.check_route_report_quota() to authenticated;
grant execute on function public.check_edd_report_quota() to authenticated;
grant execute on function public.route_reports_derive_bank_names() to authenticated;
