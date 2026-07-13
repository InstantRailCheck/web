-- v6.7.3 follow-up: banks_set_updated_at unconditionally bumped
-- updated_at on every UPDATE, even when nothing actually changed. The
-- monthly NCUA sync rewrites aka_names for every one of the ~3,770
-- linked banks whether or not the recomputed value differs from what's
-- already stored, so nearly all of them would get a fresh <lastmod> in
-- sitemap.xml every month regardless of whether their content actually
-- changed - eroding the freshness signal the whole feature exists to
-- provide (flagged by ChatGPT's review of the completed v6.7.3 state).
--
-- Fixed at the trigger level rather than in the sync script alone,
-- since that protects every current and future write path - this
-- trigger's own original design intent, per its v6.7.2 comment:
-- "maintained by a trigger rather than trusted to every individual
-- write path to set correctly." NEW is compared against OLD before
-- this function touches updated_at, so a genuine no-op UPDATE (every
-- column identical) leaves updated_at untouched; any real change to
-- any column still bumps it exactly as before. CREATE OR REPLACE
-- preserves the function's existing EXECUTE-grant revocations from
-- 20260713002728, so no need to repeat them here.
create or replace function banks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new is not distinct from old then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
