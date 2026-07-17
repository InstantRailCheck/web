-- v8.0 Complete Institution Directory, step 1 of the rollout (schema only
-- — no directory data is touched by this migration). fdic_cert/
-- ncua_charter_number are already the authoritative identifiers; this adds
-- the remaining columns the sync (20260716010000_add_institution_sync.sql)
-- needs to write to: structured location, which source authority a linked
-- bank's identifier came from, when it was last confirmed against that
-- source, and a real lifecycle (banks.is_active already existed but was
-- unused anywhere in app code before this release).

alter table banks
  add column city text,
  add column state text,
  add column source_authority text check (source_authority in ('fdic', 'ncua')),
  add column source_last_synced_at timestamptz,
  add column inactive_reason text check (inactive_reason in ('closed', 'merged', 'unlisted')),
  add column merged_into_bank_id uuid references banks(id);

-- source_authority is backfilled from whichever identifier a bank already
-- has — but only one of fdic_cert/ncua_charter_number should ever be set
-- per row (each is independently unique, but nothing before this migration
-- enforced they were mutually exclusive). Abort rather than guess if that
-- assumption is already violated, so a real data problem gets a human
-- rather than an arbitrary backfill choice.
do $$
begin
  if exists (
    select 1 from banks where fdic_cert is not null and ncua_charter_number is not null
  ) then
    raise exception 'banks row(s) exist with both fdic_cert and ncua_charter_number set — resolve manually before re-running this migration';
  end if;
end $$;

update banks set source_authority = 'fdic' where fdic_cert is not null;
update banks set source_authority = 'ncua' where ncua_charter_number is not null;

-- source_authority and its corresponding identifier can only ever appear
-- together — the sync (§6) relies on this to know which identifier column
-- a given source-authority row owns, without also checking the other
-- identifier column every time.
alter table banks add constraint banks_source_authority_identifier_check check (
  (source_authority is null and fdic_cert is null and ncua_charter_number is null)
  or (source_authority = 'fdic' and fdic_cert is not null and ncua_charter_number is null)
  or (source_authority = 'ncua' and ncua_charter_number is not null and fdic_cert is null)
);

-- An inactive bank always has a reason; an active one never carries
-- inactive-only fields (a bank reactivated by the sync clears both, not
-- just is_active — see §8/the sync migration's reactivation logic).
alter table banks add constraint banks_inactive_requires_reason_check check (
  is_active or inactive_reason is not null
);
alter table banks add constraint banks_active_excludes_inactive_fields_check check (
  (not is_active) or (inactive_reason is null and merged_into_bank_id is null)
);
alter table banks add constraint banks_merge_target_check check (
  merged_into_bank_id is null or merged_into_bank_id <> id
);
alter table banks add constraint banks_merge_requires_reason_check check (
  (inactive_reason = 'merged') = (merged_into_bank_id is not null)
);

-- The automated sync only ever sets inactive_reason='unlisted' (a charter
-- absent from the latest source fetch). 'closed'/'merged' are reserved for
-- a future manual admin action — nothing in this release sets them.

-- Every list/pagination path that orders by name alone (app/banks/page.tsx,
-- app/api/banks/route.ts, lib/allBanks.ts) needs a stable secondary key once
-- duplicate names are permitted — id is already unique and already selected
-- everywhere name is, so it's a free tiebreaker with no application change
-- beyond adding it to each ORDER BY.
create index banks_name_id_idx on banks (name, id);
create index banks_name_id_active_idx on banks (name, id) where is_active;

-- Duplicate legal names (e.g. six separate Pinnacle Bank charters) are
-- legitimate and must be permitted going forward. No tracked migration
-- ever added a unique constraint or index on banks.name, but this repo's
-- migration history was reconstructed for a handful of pre-tracking
-- columns (20260707000000's baseline) — rather than trust that absence,
-- this self-checking block finds and drops EVERY unique constraint or
-- standalone unique index whose column set is exactly {name}, wherever it
-- came from, so this migration is correct whether or not one exists. A
-- unique index covering additional columns (there are none today) would
-- not match and would be left alone.
do $$
declare rec record;
begin
  for rec in
    select con.conname as obj_name, 'constraint' as kind
    from pg_constraint con
    where con.conrelid = 'public.banks'::regclass and con.contype = 'u'
      -- attname is Postgres's internal `name` type, not `text` — cast it
      -- so this array-equality check has a real operator to use (name[] =
      -- text[] doesn't exist, confirmed live via a local rehearsal run).
      and (select array_agg(attname::text order by attname) from pg_attribute
           where attrelid = con.conrelid and attnum = any(con.conkey)) = array['name']
    union all
    select idx.relname, 'index'
    from pg_index i join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.banks'::regclass and i.indisunique and not i.indisprimary
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int[])) = array['name']
      and idx.relname not in (
        select con2.conname from pg_constraint con2
        where con2.conrelid = 'public.banks'::regclass and con2.contype = 'u'
      )
  loop
    if rec.kind = 'constraint' then
      raise notice 'Dropping unique constraint % on banks.name', rec.obj_name;
      execute format('alter table public.banks drop constraint %I', rec.obj_name);
    else
      raise notice 'Dropping standalone unique index % on banks.name', rec.obj_name;
      execute format('drop index public.%I', rec.obj_name);
    end if;
  end loop;
end $$;

-- source_last_synced_at is written on every present-in-source valid row on
-- every sync run, regardless of whether any other content field changed —
-- excluded from banks_set_updated_at()'s no-op comparison in the next
-- migration so it never bumps updated_at/sitemap freshness on its own.

notify pgrst, 'reload schema';
