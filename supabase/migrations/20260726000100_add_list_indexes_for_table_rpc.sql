-- Backs scripts/db-tests/routeReportsAndModerationIndexes.check.mjs.
-- supabase-js talks to the database through PostgREST, which doesn't
-- expose pg_catalog — same reason audit_rls_manifest() exists (see
-- 20260711031000_add_rls_manifest_audit_rpc.sql) for policy/grant
-- introspection. This is deliberately narrower: it only lists index names
-- for one table at a time, purely so a db-test can assert "the migration
-- above actually created the indexes it claims to" against a local
-- instance. It is NOT a general schema-drift audit (columns, nullability,
-- constraints, foreign-key actions) — that would need a verified inventory
-- of every table in the live schema to avoid false-positive drift alarms,
-- which isn't safe to produce without direct database access. Left as a
-- follow-up, ideally mirroring the audit_rls_manifest()/scripts/rlsManifest.mjs
-- pattern once that inventory can be built and verified against production.
create or replace function list_indexes_for_table(p_table text)
returns setof text
language sql
security definer
set search_path = public
as $$
  select indexname
  from pg_indexes
  where schemaname = 'public' and tablename = p_table;
$$;

revoke all on function public.list_indexes_for_table(text) from public;
revoke all on function public.list_indexes_for_table(text) from anon;
revoke all on function public.list_indexes_for_table(text) from authenticated;
grant execute on function public.list_indexes_for_table(text) to service_role;
