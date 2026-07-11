-- Reverts 20260711034000. That migration was based on a misdiagnosis: the
-- actual cause of the observed "row-level security policy" error on
-- authenticated route_reports/edd_reports inserts was never the trigger
-- functions' EXECUTE grants — it was that the verification scripts chained
-- .insert(...).select(...), which makes PostgREST add a RETURNING clause.
-- Since route_reports/edd_reports deliberately have no SELECT policy for
-- authenticated (Phase 1b, v6.1.0 — reads are server-only via the admin
-- client), RETURNING can't read the just-inserted row back, and Postgres
-- reports that as the same 42501 "row-level security policy" error. The
-- real application code (SubmitRouteReport.tsx, SubmitEddReport.tsx) never
-- chains .select() after .insert() and was never affected — this was a
-- test-script bug, not a production regression. Confirmed directly via a
-- raw SQL simulation (SET ROLE authenticated + request.jwt.claims, inside
-- a rolled-back transaction): the same INSERT succeeds without RETURNING
-- and fails only once a RETURNING clause is added.
--
-- check_route_report_quota, check_edd_report_quota, and
-- route_reports_derive_bank_names are trigger-only functions — not
-- directly callable via PostgREST's RPC endpoint regardless of EXECUTE
-- grants (they return `trigger`, not a normal value) — so service_role-
-- only is both correct and sufficient, matching v6.1.4's original intent.
revoke execute on function public.check_route_report_quota() from authenticated;
revoke execute on function public.check_edd_report_quota() from authenticated;
revoke execute on function public.route_reports_derive_bank_names() from authenticated;
