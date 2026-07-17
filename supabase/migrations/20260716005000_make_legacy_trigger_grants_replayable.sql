-- Same gap 20260714030000 fixed for four v7.2 tables/functions, found here
-- for six OLDER (pre-v7.2) trigger-only functions: production has these
-- EXECUTE grants via dashboard-inherited defaults, but a fresh migration
-- replay never does, since no migration ever granted them explicitly.
-- 20260711020000 revoked EXECUTE from public/anon/authenticated on each of
-- these (correctly — none should be callable by an end-user session), but
-- REVOKE ALL FROM PUBLIC also strips service_role's implicit PUBLIC-
-- inherited access, and nothing re-granted it explicitly afterward.
--
-- Confirmed live: this is the first time audit-rls-manifest.mjs has ever
-- been run against a freshly-replayed local Postgres rather than
-- production (.github/workflows/audit-rls.yml only ever targets
-- production) — surfaced during v8.0's local rehearsal (rollout step 1),
-- not caused by it. rlsManifest.mjs already expected service_role to hold
-- these; this migration makes local replay match that expectation instead
-- of weakening it, per 20260714030000's same reasoning. None of these
-- functions actually need EXECUTE to fire as a trigger (20260711035000's
-- finding still holds) — this is about audit-rls-manifest.mjs's own
-- expectation, not runtime behavior.
grant execute on function public.check_route_report_quota() to service_role;
grant execute on function public.check_edd_report_quota() to service_role;
grant execute on function public.log_bank_rail_changes() to service_role;
grant execute on function public.route_reports_derive_bank_names() to service_role;
grant execute on function public.banks_set_updated_at() to service_role;
grant execute on function public.route_requests_fulfill_on_report() to service_role;

notify pgrst, 'reload schema';
