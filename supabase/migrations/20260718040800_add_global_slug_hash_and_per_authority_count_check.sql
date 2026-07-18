-- Code review findings (external, post-v8.3.2):
--
-- 1. finalize_sync_run's staged-row-count check summed fdic + ncua
--    collected counts together — a compensating error (e.g. 100 fewer
--    fdic rows than recorded, 100 more ncua rows than recorded) would sum
--    to the same total and slip past undetected. Split into two
--    independent per-authority checks.
--
-- 2. base_snapshot_hash only covers banks already linked within the run's
--    own source_scope — but the staging script reads and hashes-in-memory
--    EVERY bank (linked, unlinked, out-of-scope) to reserve slugs
--    (usedSlugs) and to estimate the inactivation count. A write to an
--    unlinked or out-of-scope bank's slug during the paginated read could
--    go completely undetected by base_snapshot_hash, since that bank was
--    never in its scope to begin with — potentially skewing
--    proposed_slug decisions for brand-new institutions without ever
--    tripping the existing before/after drift check. A genuine slug
--    COLLISION would still be caught by the real UNIQUE constraint at
--    apply time (finalize_sync_run's INSERT would simply fail), but a
--    spurious failure is still worth avoiding, not just tolerating.
--    compute_all_bank_slugs_hash covers every bank's id+slug
--    unconditionally, so the staging script can double-check it the same
--    way it already double-checks base_snapshot_hash around the paginated
--    read — this one only needs to be correct within that single staging
--    run, never stored long-term, since finalize_sync_run itself never
--    trusts a client-computed slug decision over the database's own
--    UNIQUE constraint.
create or replace function compute_all_bank_slugs_hash()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select md5(string_agg(id::text || '|' || coalesce(slug, ''), ',' order by id))
  from banks
$$;

revoke all on function public.compute_all_bank_slugs_hash() from public;
revoke all on function public.compute_all_bank_slugs_hash() from anon;
revoke all on function public.compute_all_bank_slugs_hash() from authenticated;
grant execute on function public.compute_all_bank_slugs_hash() to service_role;

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
