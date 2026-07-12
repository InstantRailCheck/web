-- name_normalized backs every search surface (bank-search route, /banks
-- directory, public /api/banks) via .ilike(), but was derived from `name`
-- alone - a search for "fnfcu" or "culink" finds nothing even though
-- banks.aka_names now stores exactly that data. Postgres doesn't support
-- altering a stored generated column's expression in place, so this drops
-- and re-adds it; being STORED GENERATED, Postgres recomputes it for every
-- existing row automatically as part of this migration - no separate
-- backfill script needed, and none of the three call sites need any code
-- change since they already query this same column name.
alter table banks drop column name_normalized;

-- array_to_string() and an array->text cast are both deterministic in
-- practice but neither is marked IMMUTABLE in Postgres's own catalog,
-- which a STORED GENERATED column's expression must be - confirmed live,
-- twice: both were rejected outright with "generation expression is not
-- immutable" before touching any data (each attempt rolled back cleanly).
-- Postgres trusts a function's *declared* volatility rather than
-- inspecting its body, so wrapping the concatenation in our own
-- explicitly-IMMUTABLE function is the standard fix - true and safe here
-- since joining plain text array elements with a fixed delimiter has no
-- actual dependency on locale, timezone, or any other session state.
create or replace function bank_aka_names_blob(names text[])
returns text
language sql
immutable
parallel safe
as $$
  select coalesce((select string_agg(elem, ' ') from unnest(names) as elem), '');
$$;

alter table banks
  add column name_normalized text generated always as (
    regexp_replace(lower(name || ' ' || bank_aka_names_blob(aka_names)), '[^a-z0-9]', '', 'g')
  ) stored;

notify pgrst, 'reload schema';
