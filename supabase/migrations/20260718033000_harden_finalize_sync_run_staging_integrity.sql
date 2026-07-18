-- Code review finding (external, post-v8.3.1): finalize_sync_run trusted
-- sync_staging_institutions completely — it never confirmed the staged
-- rows still belong to this run's declared source_scope, never checked
-- the staged row count against what was recorded at staging time, and
-- never verified the staging rows themselves hadn't changed since a human
-- reviewed them. sync_runs.source_snapshot_hash existed in the schema from
-- day one but nothing ever computed or checked it. Nothing in this
-- codebase mutates sync_staging_institutions after insert today, so this
-- isn't a currently-exploitable bug — but finalize_sync_run shouldn't rely
-- on that being true forever, the same way base_snapshot_hash doesn't rely
-- on `banks` being untouched between staging and apply.
--
-- compute_staging_snapshot_hash mirrors compute_banks_base_snapshot_hash's
-- shape: a canonical, deterministically-ordered hash over every staged row
-- for a run, computed once by the CLI at staging time (stored as
-- sync_runs.source_snapshot_hash) and recomputed here to detect drift.
create or replace function compute_staging_snapshot_hash(p_run_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select md5(string_agg(row_val, ',' order by row_id))
  from (
    select
      id::text || '|' || source_authority || '|' || coalesce(source_identifier::text, '')
        || '|' || status || '|' || coalesce(reject_reason, '') || '|' || coalesce(name, '')
        || '|' || coalesce(city, '') || '|' || coalesce(state, '') || '|' || coalesce(website, '')
        || '|' || coalesce(phone, '') || '|' || coalesce(address, '') || '|' || coalesce(total_assets::text, '')
        || '|' || coalesce(array_to_string(aka_names, ','), '') || '|' || coalesce(proposed_slug, '') as row_val,
      id as row_id
    from sync_staging_institutions
    where run_id = p_run_id
  ) scoped
$$;

revoke all on function public.compute_staging_snapshot_hash(uuid) from public;
revoke all on function public.compute_staging_snapshot_hash(uuid) from anon;
revoke all on function public.compute_staging_snapshot_hash(uuid) from authenticated;
grant execute on function public.compute_staging_snapshot_hash(uuid) to service_role;

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
  v_staged_count integer;
  v_recorded_count integer;
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

  select count(*) into v_staged_count from sync_staging_institutions where run_id = p_run_id;
  v_recorded_count := coalesce(run.fdic_collected_count, 0) + coalesce(run.ncua_collected_count, 0);
  if v_staged_count is distinct from v_recorded_count then
    raise exception 'sync run % has % staged row(s) but recorded collected counts sum to % — staging data does not match what was reviewed',
      p_run_id, v_staged_count, v_recorded_count
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
      if not existing.is_active and existing.inactive_reason = 'unlisted' then
        update banks set
          name = rec.name, city = rec.city, state = rec.state, website = rec.website,
          phone = rec.phone, address = rec.address, total_assets = rec.total_assets,
          aka_names = rec.aka_names, is_active = true, inactive_reason = null,
          merged_into_bank_id = null, source_last_synced_at = now()
        where id = existing.id;
        v_reactivated := v_reactivated + 1;
      elsif not existing.is_active then
        v_reappeared_manually_inactive := v_reappeared_manually_inactive + 1;
      else
        v_content_changed := jsonb_build_object(
          'name', existing.name, 'city', existing.city, 'state', existing.state,
          'website', existing.website, 'phone', existing.phone, 'address', existing.address,
          'total_assets', existing.total_assets, 'aka_names', existing.aka_names
        ) <> jsonb_build_object(
          'name', rec.name, 'city', rec.city, 'state', rec.state,
          'website', rec.website, 'phone', rec.phone, 'address', rec.address,
          'total_assets', rec.total_assets, 'aka_names', rec.aka_names
        );
        update banks set
          name = rec.name, city = rec.city, state = rec.state, website = rec.website,
          phone = rec.phone, address = rec.address, total_assets = rec.total_assets,
          aka_names = rec.aka_names, source_last_synced_at = now()
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
