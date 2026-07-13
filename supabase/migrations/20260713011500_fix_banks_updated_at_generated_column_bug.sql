-- Corrects 20260713010000, which shipped a no-op guard that never
-- actually skipped anything: comparing the whole composite row
-- (`new is not distinct from old`) always reported a difference,
-- because `name_normalized` is a STORED GENERATED column, and Postgres
-- has not yet recomputed it for NEW at BEFORE-ROW-trigger time - NEW's
-- slot for it doesn't reflect the real post-update value the way OLD's
-- does, regardless of whether anything that feeds it (name, aka_names)
-- actually changed. Caught live: a raw `update banks set aka_names =
-- aka_names` still bumped updated_at after 20260713010000 was applied,
-- which should be impossible for a true no-op under a working guard.
--
-- Fixed by comparing to_jsonb(NEW)/to_jsonb(OLD) with the generated
-- column (and updated_at itself, the column being conditionally set)
-- stripped out first, rather than comparing the raw composite rows.
-- jsonb equality here is exact per-key/per-array-element, so this still
-- only skips a genuine no-op, not just a "close enough" one.
create or replace function banks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'name_normalized')
     = (to_jsonb(old) - 'updated_at' - 'name_normalized') then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
