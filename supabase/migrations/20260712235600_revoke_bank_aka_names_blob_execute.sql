-- bank_aka_names_blob was only ever meant to back name_normalized's
-- generated-column expression, but PostgreSQL grants EXECUTE on new
-- functions to PUBLIC by default, and Supabase additionally grants it to
-- anon/authenticated explicitly per-role - making it an externally
-- callable PostgREST RPC nobody intended to expose (same class of gap
-- fixed for increment_rate_limit et al. in 20260711020000). It returns no
-- sensitive data, so this is hardening intentionality rather than closing
-- a live leak - but revoking costs nothing, since every write to `banks`
-- goes through service_role exclusively (lib/actions/addBank.ts), and
-- STORED generated columns only need write-time evaluation, not read-time,
-- so anon/authenticated's ability to just read name_normalized is
-- unaffected either way.
revoke all on function public.bank_aka_names_blob(text[]) from public;
revoke all on function public.bank_aka_names_blob(text[]) from anon;
revoke all on function public.bank_aka_names_blob(text[]) from authenticated;

notify pgrst, 'reload schema';
