-- Locks down direct raw-row reads on route_reports and edd_reports. Every
-- page/API that needs this data now reads it server-side via the admin
-- client (service-role key, bypasses RLS) instead of the anon-key client —
-- see the "Phase 1a" commit that shipped and was verified in production
-- immediately before this migration. Applying this before that code was
-- live would have broken every consumer still running the previous
-- deployment; this order matters and is intentional.
--
-- No account/history feature exists yet (app/account is passkey management
-- only), so no authenticated-own-row SELECT policy is added here — one can
-- be added later if that's ever built, scoped to auth.uid() = user_id.
--
-- INSERT is untouched: authenticated users still insert their own row
-- directly from the browser via auth.uid() = user_id, same as before.
--
-- UPDATE and DELETE were assumed to have no policy on either table (RLS's
-- default-deny blocking both for every role) — a pre-migration check proved
-- that assumption WRONG for edd_reports: an authenticated user could
-- successfully UPDATE and DELETE their own row despite no UPDATE/DELETE
-- policy appearing in any tracked migration. Rather than continuing to
-- assume, this drops any existing policy for every command except INSERT
-- on both tables, so the only way to reach a row is the explicit INSERT
-- policy below — SELECT/UPDATE/DELETE all fall through to Postgres's actual
-- default-deny once no policy remains for them.
--
-- Written as a dynamic loop rather than named DROP POLICY statements
-- because route_reports predates migration tracking in this repo (and,
-- per the finding above, edd_reports evidently has undocumented policies
-- too) — there's no reliable list of exact policy names to reference.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'route_reports' and cmd <> 'INSERT'
  loop
    execute format('drop policy %I on route_reports', pol.policyname);
  end loop;

  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'edd_reports' and cmd <> 'INSERT'
  loop
    execute format('drop policy %I on edd_reports', pol.policyname);
  end loop;
end $$;

-- Belt-and-suspenders: a table with RLS enabled and zero SELECT policies
-- already denies all SELECT to anon/authenticated by default, but confirm
-- RLS itself is (still) enabled on both rather than assume it.
alter table route_reports enable row level security;
alter table edd_reports enable row level security;

notify pgrst, 'reload schema';
