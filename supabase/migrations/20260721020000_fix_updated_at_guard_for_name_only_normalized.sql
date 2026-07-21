-- 20260721013400 added banks.name_only_normalized as a second STORED
-- GENERATED column, but banks_set_updated_at()'s no-op guard
-- (20260713011500 / 20260716000500) only stripped 'name_normalized' out of
-- its OLD/NEW jsonb comparison, not this new one. Same bug, same root
-- cause as 20260713011500: Postgres has not yet recomputed a stored
-- generated column for NEW at BEFORE-ROW-trigger time, so NEW's slot for
-- name_only_normalized never matches OLD's real, already-computed value —
-- every single banks UPDATE now sees a spurious mismatch and bumps
-- updated_at unconditionally, defeating the no-op guard entirely, not just
-- for sync. Caught via institutionSync.check.mjs failing in CI on main.
create or replace function banks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'name_normalized' - 'name_only_normalized' - 'source_last_synced_at')
     = (to_jsonb(old) - 'updated_at' - 'name_normalized' - 'name_only_normalized' - 'source_last_synced_at') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
