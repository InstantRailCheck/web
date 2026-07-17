-- v8.0: the institution sync (§6) writes source_last_synced_at on every
-- present-in-source valid bank on every run, even when no other content
-- field changed — a real UPDATE each time, not a no-op. Without this
-- exclusion, banks_set_updated_at's no-op guard (20260713011500) would
-- treat that as a genuine content change and bump updated_at on ~8,500
-- banks every sync run, eroding the sitemap freshness signal the same way
-- the monthly aka_names rewrite did before that guard existed. A bank can
-- be simultaneously "content-unchanged" (sync's own unchanged_count) and
-- "freshness-touched" (this column) in the same run — both true at once,
-- and only the former should move updated_at.
create or replace function banks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'name_normalized' - 'source_last_synced_at')
     = (to_jsonb(old) - 'updated_at' - 'name_normalized' - 'source_last_synced_at') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
