-- ILIKE '%US Bank%' never matched "U.S. Bank National Association" - the
-- periods break the substring, so the single most-searched-for way to type
-- one of the largest US banks returned nothing. 204 of ~4,670 banks have a
-- period in their legal name (N.A., F.S.B., U.S., etc.), so this wasn't a
-- one-off - lib/fdicLookup.ts already had a narrow US->U.S. patch for this
-- exact pattern in the enrichment path, but it was never applied to search.
--
-- A generated, stored column (rather than wrapping ilike in a function at
-- query time) keeps /api/bank-search's plain .ilike() call working via
-- Supabase's REST filter builder, which can't target an arbitrary SQL
-- expression - only an actual column.
alter table banks
  add column name_normalized text generated always as (
    regexp_replace(lower(name), '[^a-z0-9]', '', 'g')
  ) stored;
