-- Backs scripts/audit-rls-manifest.mjs. supabase-js talks to the database
-- through PostgREST, not a raw SQL connection — every other script in this
-- repo already works this way rather than adding a direct-Postgres
-- dependency, so introspection needs its own RPC to expose pg_catalog data
-- through that same path. service_role only; this returns the shape of
-- every RLS policy and SECURITY DEFINER grant in the schema, which is
-- itself sensitive enough to keep off anon/authenticated.
create or replace function audit_rls_manifest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'rls_enabled', (
      select coalesce(jsonb_object_agg(c.relname, c.relrowsecurity), '{}'::jsonb)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ),
    'policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles
      )), '[]'::jsonb)
      from pg_policies
      where schemaname = 'public'
    ),
    'security_definer_grants', (
      select coalesce(jsonb_object_agg(p.proname, jsonb_build_object(
        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')
      )), '{}'::jsonb)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef = true
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.audit_rls_manifest() from public;
revoke all on function public.audit_rls_manifest() from anon;
revoke all on function public.audit_rls_manifest() from authenticated;
grant execute on function public.audit_rls_manifest() to service_role;
