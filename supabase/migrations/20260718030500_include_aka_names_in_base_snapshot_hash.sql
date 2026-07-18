-- Code review finding (external, post-v8.3.0): compute_banks_base_snapshot_hash
-- omits aka_names, even though finalize_sync_run overwrites it on every
-- insert/update/reactivate. A concurrent aka_names-only change between
-- staging and apply (e.g. sync-ncua-directory.mjs's own aka_names refresh
-- step, which runs as a completely separate process) would go undetected
-- by the drift check and then get silently clobbered by finalize_sync_run
-- — not hypothetical, since exactly that pairing of processes now runs in
-- the same rollout. array_to_string with a fixed separator gives a stable,
-- order-sensitive representation; aka_names is only ever written as a
-- whole array in one place at a time (never reordered in place), so this
-- is consistent between the staging-time and apply-time computation of
-- the same underlying data.
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
        || '|' || coalesce(source_authority, '') || '|' || coalesce(array_to_string(aka_names, ','), '') as row_val,
      id as row_id
    from banks
    where source_authority = any(
      case p_source_scope when 'both' then array['fdic', 'ncua'] else array[p_source_scope] end
    )
  ) scoped
$$;

notify pgrst, 'reload schema';
