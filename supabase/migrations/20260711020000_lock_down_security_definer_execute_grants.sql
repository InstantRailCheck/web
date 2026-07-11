-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, and
-- Supabase's project bootstrapping additionally grants EXECUTE to anon/
-- authenticated/service_role explicitly per-role on every new function
-- (confirmed via increment_rate_limit's actual ACL: separate anon=X and
-- authenticated=X entries, not just the bare PUBLIC one) — so revoking only
-- from PUBLIC would NOT have been sufficient; each role's explicit grant
-- has to be revoked too.
--
-- Confirmed live: both `anon` and `authenticated` could call
-- increment_rate_limit(text, bigint) directly via PostgREST's RPC endpoint
-- with arbitrary key/window values, letting a caller inflate someone else's
-- rate-limit bucket, fill api_rate_limits with junk keys, or manipulate
-- counters outside the application's own call sites.
--
-- The four trigger-only functions (check_*_report_quota, log_bank_rail_
-- changes, route_reports_derive_bank_names) aren't directly callable via
-- .rpc() in practice — trigger execution doesn't require the firing
-- session to hold EXECUTE on the trigger function itself, only privilege
-- on the table (governed separately by RLS). Revoking the default grants
-- from these too is just making the privilege intentional rather than
-- closing a live gap, per the review that flagged this.

revoke all on function public.increment_rate_limit(text, bigint) from public;
revoke all on function public.increment_rate_limit(text, bigint) from anon;
revoke all on function public.increment_rate_limit(text, bigint) from authenticated;
grant execute on function public.increment_rate_limit(text, bigint) to service_role;

revoke all on function public.check_route_report_quota() from public;
revoke all on function public.check_route_report_quota() from anon;
revoke all on function public.check_route_report_quota() from authenticated;

revoke all on function public.check_edd_report_quota() from public;
revoke all on function public.check_edd_report_quota() from anon;
revoke all on function public.check_edd_report_quota() from authenticated;

revoke all on function public.log_bank_rail_changes() from public;
revoke all on function public.log_bank_rail_changes() from anon;
revoke all on function public.log_bank_rail_changes() from authenticated;

revoke all on function public.route_reports_derive_bank_names() from public;
revoke all on function public.route_reports_derive_bank_names() from anon;
revoke all on function public.route_reports_derive_bank_names() from authenticated;
