-- Same gap 20260714030000 and 20260806000000 already fixed for seven other
-- tables — route_requests never got an explicit service_role grant either,
-- and only kept working in production on legacy dashboard-inherited default
-- privileges that predate RLS. Discovered via a real fresh migration replay
-- on local Supabase (seeding an edd_reports opportunity to visually verify
-- /contribute's EDD opportunities section), which failed with
-- "permission denied for table route_requests" the moment
-- lib/needsFreshReports.ts tried to read it. rlsManifest.mjs's
-- route_requests: [] entry already documents this table as admin-client-only
-- with no RLS policy — this migration just makes the grant that fact
-- depends on explicit instead of assumed.

grant all privileges on table public.route_requests to service_role;

notify pgrst, 'reload schema';
