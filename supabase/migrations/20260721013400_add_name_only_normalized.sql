-- Code review finding (post-v8.14.5): banks.name_normalized is generated as
-- normalize(name + ' ' + aka_names joined) — built for fuzzy ILIKE search,
-- not exact identity. Two live, targeted (non-full-scan) lookups compared a
-- bare-name normalization against this alias-inflated column with .eq(),
-- which silently fails to match any bank that has aka_names attached:
-- lib/actions/addBank.ts's own-name collision check, and
-- lib/railParticipation.ts's duplicate-name sibling-group query. Confirmed
-- live: adding "Bank of America, National Association" today would not be
-- recognized as a duplicate of the existing aka-carrying row, silently
-- recreating the exact class of bug v8.14.2/v8.14.3 just cleaned up.
--
-- The full-table-fetch audit/batch scripts (duplicateInstitutions.mjs,
-- backfill-rail-participation.mjs, audit-duplicate-name-rail-flags.mjs)
-- already compute this correctly in JS, since they fetch every row anyway —
-- this column exists only for the two call sites that do a targeted
-- database-side lookup and need an exact, alias-free match.
alter table banks
  add column name_only_normalized text generated always as (
    regexp_replace(lower(name), '[^a-z0-9]', '', 'g')
  ) stored;

notify pgrst, 'reload schema';
