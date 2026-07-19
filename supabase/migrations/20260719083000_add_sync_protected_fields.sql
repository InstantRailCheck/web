-- A manually-verified field can be silently reverted by the next
-- automated sync — confirmed live: Richland Credit Union's website was
-- corrected to "https://www.richlandfederalcreditunion.com" (NCUA's own
-- FS220D source field truncates it), but finalize_sync_run unconditionally
-- rewrites `website` (and every other synced field) from freshly-computed
-- source data on every matched row, every run, with no concept of "this
-- value was manually verified, don't overwrite it." The exact same gap
-- applies to community corrections applied via apply_bank_correction — an
-- auto-applied correction writes today, then gets quietly reverted the
-- next time the monthly sync runs, since NCUA's source data hasn't (and,
-- for a fixed-width truncation, never will) change.
--
-- Fixed with a `sync_protected_fields` array naming which of the fields
-- finalize_sync_run can write have been manually verified for this bank —
-- finalize_sync_run then leaves exactly those fields alone (keeping the
-- existing value) while still applying every other field normally. This
-- generalizes to any of the fields the sync ever writes, not just
-- website/phone (the two apply_bank_correction supports today).
alter table banks add column sync_protected_fields text[];

alter table banks add constraint banks_sync_protected_fields_valid_check check (
  sync_protected_fields is null or sync_protected_fields <@ array[
    'name', 'city', 'state', 'website', 'phone', 'address', 'total_assets', 'aka_names'
  ]::text[]
);

-- Covered by the base_snapshot_hash the same way every other field
-- finalize_sync_run can read/write already is — a correction landing
-- between staging and apply (changing which fields are protected) must
-- invalidate the reviewed diff and force a fresh stage, the same as any
-- other production drift during that window.
create or replace function compute_banks_base_snapshot_hash(p_source_scope text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select md5(string_agg(row_val, ',' order by row_id))
  from (
    select
      id::text || '|' || coalesce(fdic_cert::text, '') || '|' || coalesce(ncua_charter_number::text, '')
        || '|' || coalesce(name, '') || '|' || coalesce(slug, '') || '|' || is_active::text
        || '|' || coalesce(inactive_reason, '') || '|' || coalesce(merged_into_bank_id::text, '')
        || '|' || coalesce(website, '') || '|' || coalesce(phone, '') || '|' || coalesce(address, '')
        || '|' || coalesce(city, '') || '|' || coalesce(state, '') || '|' || coalesce(total_assets::text, '')
        || '|' || coalesce(source_authority, '') || '|' || coalesce(array_to_string(aka_names, ','), '')
        || '|' || coalesce(array_to_string(sync_protected_fields, ','), '') as row_val,
      id as row_id
    from banks
    where source_authority = any(
      case p_source_scope when 'both' then array['fdic', 'ncua'] else array[p_source_scope] end
    )
  ) scoped
$$;

-- apply_bank_correction: on an auto-applied correction, the corrected
-- field now joins sync_protected_fields (deduped) alongside the write it
-- already made, so the very next sync can't quietly revert it.
create or replace function apply_bank_correction(
  p_bank_id uuid,
  p_user_id uuid,
  p_field text,
  p_submitted_value text,
  p_previous_value text,
  p_matched boolean,
  p_official_value text
)
returns table(status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank banks%rowtype;
  v_status text;
  v_current_value text;
begin
  if p_field not in ('website', 'phone') then
    raise exception 'invalid correction field %', p_field using errcode = 'P0001';
  end if;

  select * into v_bank from banks where id = p_bank_id for update;
  if not found then
    raise exception 'bank % does not exist', p_bank_id using errcode = 'P0002';
  end if;

  if not v_bank.is_active then
    raise exception 'cannot submit a correction for an inactive institution' using errcode = 'P0001';
  end if;

  v_current_value := case when p_field = 'website' then v_bank.website else v_bank.phone end;
  if v_current_value is distinct from p_previous_value then
    raise exception 'bank % field % has changed since this correction was reviewed — resubmit against current data', p_bank_id, p_field
      using errcode = 'P0001';
  end if;

  v_status := case when p_matched then 'auto_applied' else 'pending_review' end;

  insert into bank_corrections (bank_id, user_id, field, submitted_value, previous_value, status)
  values (p_bank_id, p_user_id, p_field, p_submitted_value, p_previous_value, v_status);

  if p_matched then
    update banks set
      website = case when p_field = 'website' then p_official_value else website end,
      phone = case when p_field = 'phone' then p_official_value else phone end,
      sync_protected_fields = array(
        select distinct unnest(coalesce(sync_protected_fields, array[]::text[]) || array[p_field])
      )
    where id = p_bank_id;
  end if;

  return query select v_status;
end;
$$;

revoke all on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) from public;
revoke all on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) from anon;
revoke all on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) from authenticated;
grant execute on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) to service_role;

-- finalize_sync_run: for a matched existing bank, every field named in
-- its own sync_protected_fields keeps its CURRENT value instead of the
-- freshly-computed one - both for the actual write and for the
-- unchanged/updated diff (so a permanently-protected field doesn't make
-- this bank report as "updated" on every future run forever). Unaffected:
-- a brand-new insert (no existing row to protect) and the inactivation
-- pass (never touches these fields at all).
create or replace function finalize_sync_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run sync_runs%rowtype;
  computed_base_hash text;
  rec record;
  existing banks%rowtype;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_reactivated integer := 0;
  v_inactivated integer := 0;
  v_reappeared_manually_inactive integer := 0;
  v_content_changed boolean;
  v_scope_authorities text[];
  v_staged_fdic_count integer;
  v_staged_ncua_count integer;
  v_protected text[];
  v_eff_name text;
  v_eff_city text;
  v_eff_state text;
  v_eff_website text;
  v_eff_phone text;
  v_eff_address text;
  v_eff_total_assets bigint;
  v_eff_aka_names text[];
begin
  perform pg_advisory_xact_lock(hashtext('institution_sync_finalize'));

  select * into run from sync_runs where id = p_run_id for update;
  if not found then
    raise exception 'sync_runs row % does not exist', p_run_id using errcode = 'P0001';
  end if;
  if run.status <> 'applying' then
    raise exception 'sync run % is not in applying status (found %)', p_run_id, run.status
      using errcode = 'P0001';
  end if;

  if run.requires_override_reason is not null and not run.override_applied then
    raise exception 'sync run % requires an unapplied override (%)', p_run_id, run.requires_override_reason
      using errcode = 'P0001';
  end if;

  v_scope_authorities := case run.source_scope when 'both' then array['fdic', 'ncua'] else array[run.source_scope] end;

  -- Staging-integrity checks — is what's about to be applied still
  -- genuinely what was reviewed at staging time?
  if exists (
    select 1 from sync_staging_institutions
    where run_id = p_run_id and source_authority != all(v_scope_authorities)
  ) then
    raise exception 'sync run % has staged row(s) with a source_authority outside its own scope (%)', p_run_id, run.source_scope
      using errcode = 'P0001';
  end if;

  -- Checked independently per authority, not as a combined sum — a
  -- compensating error (too few fdic rows, too many ncua rows balancing
  -- the total) would otherwise slip past a single combined check.
  select count(*) into v_staged_fdic_count from sync_staging_institutions where run_id = p_run_id and source_authority = 'fdic';
  if v_staged_fdic_count is distinct from coalesce(run.fdic_collected_count, 0) then
    raise exception 'sync run % has % staged fdic row(s) but recorded fdic_collected_count is % — staging data does not match what was reviewed',
      p_run_id, v_staged_fdic_count, coalesce(run.fdic_collected_count, 0)
      using errcode = 'P0001';
  end if;

  select count(*) into v_staged_ncua_count from sync_staging_institutions where run_id = p_run_id and source_authority = 'ncua';
  if v_staged_ncua_count is distinct from coalesce(run.ncua_collected_count, 0) then
    raise exception 'sync run % has % staged ncua row(s) but recorded ncua_collected_count is % — staging data does not match what was reviewed',
      p_run_id, v_staged_ncua_count, coalesce(run.ncua_collected_count, 0)
      using errcode = 'P0001';
  end if;

  if run.source_snapshot_hash is null then
    raise exception 'sync run % has no source_snapshot_hash recorded — it was staged by tooling that predates this integrity check', p_run_id
      using errcode = 'P0001';
  end if;
  if compute_staging_snapshot_hash(p_run_id) is distinct from run.source_snapshot_hash then
    raise exception 'sync run % staging rows have changed since they were reviewed — re-run staging before applying', p_run_id
      using errcode = 'P0001';
  end if;

  -- Abort if anything in scope has changed in production since this run
  -- was staged — the reviewed diff must be exactly what gets applied.
  computed_base_hash := compute_banks_base_snapshot_hash(run.source_scope);
  if computed_base_hash is distinct from run.base_snapshot_hash then
    raise exception 'production banks rows in scope of run % have changed since staging — re-run staging before applying', p_run_id
      using errcode = 'P0001';
  end if;

  for rec in
    select * from sync_staging_institutions
    where run_id = p_run_id and status = 'valid'
    order by id
  loop
    select * into existing from banks
    where source_authority = rec.source_authority
      and ((rec.source_authority = 'fdic' and fdic_cert = rec.source_identifier)
        or (rec.source_authority = 'ncua' and ncua_charter_number = rec.source_identifier));

    if found then
      v_protected := coalesce(existing.sync_protected_fields, array[]::text[]);
      v_eff_name := case when 'name' = any(v_protected) then existing.name else rec.name end;
      v_eff_city := case when 'city' = any(v_protected) then existing.city else rec.city end;
      v_eff_state := case when 'state' = any(v_protected) then existing.state else rec.state end;
      v_eff_website := case when 'website' = any(v_protected) then existing.website else rec.website end;
      v_eff_phone := case when 'phone' = any(v_protected) then existing.phone else rec.phone end;
      v_eff_address := case when 'address' = any(v_protected) then existing.address else rec.address end;
      v_eff_total_assets := case when 'total_assets' = any(v_protected) then existing.total_assets else rec.total_assets end;
      v_eff_aka_names := case when 'aka_names' = any(v_protected) then existing.aka_names else rec.aka_names end;

      if not existing.is_active and existing.inactive_reason = 'unlisted' then
        update banks set
          name = v_eff_name, city = v_eff_city, state = v_eff_state, website = v_eff_website,
          phone = v_eff_phone, address = v_eff_address, total_assets = v_eff_total_assets,
          aka_names = v_eff_aka_names, is_active = true, inactive_reason = null,
          merged_into_bank_id = null, source_last_synced_at = now()
        where id = existing.id;
        v_reactivated := v_reactivated + 1;
      elsif not existing.is_active then
        -- Manually marked closed/merged — never auto-reactivated. Left
        -- completely untouched; surfaced for manual review only.
        v_reappeared_manually_inactive := v_reappeared_manually_inactive + 1;
      else
        v_content_changed := jsonb_build_object(
          'name', existing.name, 'city', existing.city, 'state', existing.state,
          'website', existing.website, 'phone', existing.phone, 'address', existing.address,
          'total_assets', existing.total_assets, 'aka_names', existing.aka_names
        ) <> jsonb_build_object(
          'name', v_eff_name, 'city', v_eff_city, 'state', v_eff_state,
          'website', v_eff_website, 'phone', v_eff_phone, 'address', v_eff_address,
          'total_assets', v_eff_total_assets, 'aka_names', v_eff_aka_names
        );
        update banks set
          name = v_eff_name, city = v_eff_city, state = v_eff_state, website = v_eff_website,
          phone = v_eff_phone, address = v_eff_address, total_assets = v_eff_total_assets,
          aka_names = v_eff_aka_names, source_last_synced_at = now()
        where id = existing.id;
        if v_content_changed then
          v_updated := v_updated + 1;
        else
          v_unchanged := v_unchanged + 1;
        end if;
      end if;
    else
      insert into banks (
        name, slug, city, state, website, phone, address, total_assets, aka_names,
        source_authority, fdic_cert, ncua_charter_number, is_active, source_last_synced_at
      ) values (
        rec.name, rec.proposed_slug, rec.city, rec.state, rec.website, rec.phone, rec.address,
        rec.total_assets, rec.aka_names, rec.source_authority,
        case when rec.source_authority = 'fdic' then rec.source_identifier end,
        case when rec.source_authority = 'ncua' then rec.source_identifier end,
        true, now()
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update banks set is_active = false, inactive_reason = 'unlisted'
  where source_authority = any(v_scope_authorities)
    and is_active
    and not exists (
      select 1 from sync_staging_institutions s
      where s.run_id = p_run_id
        and s.source_authority = banks.source_authority
        and s.source_identifier = coalesce(banks.fdic_cert, banks.ncua_charter_number)
    );
  get diagnostics v_inactivated = row_count;

  update sync_runs set
    finished_at = now(),
    inserted_count = v_inserted,
    updated_count = v_updated,
    unchanged_count = v_unchanged,
    reactivated_count = v_reactivated,
    inactivated_count = v_inactivated,
    report = coalesce(report, '{}'::jsonb) || jsonb_build_object(
      'reappeared_manually_inactive', v_reappeared_manually_inactive
    )
  where id = p_run_id;

  update sync_runs set status = 'applied' where id = p_run_id and status = 'applying';
  if not found then
    raise exception 'sync run % status changed unexpectedly during finalize — this should be unreachable under the advisory + row lock', p_run_id
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', 'applied',
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'reactivated', v_reactivated,
    'inactivated', v_inactivated,
    'reappeared_manually_inactive', v_reappeared_manually_inactive
  );
end;
$$;

revoke all on function public.finalize_sync_run(uuid) from public;
revoke all on function public.finalize_sync_run(uuid) from anon;
revoke all on function public.finalize_sync_run(uuid) from authenticated;
grant execute on function public.finalize_sync_run(uuid) to service_role;

notify pgrst, 'reload schema';
