-- Code review finding (post-v8.14.5): scripts/apply-duplicate-merge.mjs
-- performed the old-row deactivation and the surviving row's aka_names
-- update as two independent requests (Promise.all) — one succeeding while
-- the other fails leaves an inconsistent state (a redirect-only row never
-- marked merged, or a merge marked but the old name unsearchable under the
-- surviving bank). This project already hit and fixed this exact bug class
-- once before in submitCorrection.ts, folded into one transactional
-- apply_bank_correction RPC (20260718050000) — same fix shape here.
create or replace function merge_duplicate_bank(
  p_old_bank_id uuid,
  p_new_bank_id uuid,
  p_old_bank_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old banks%rowtype;
  v_new banks%rowtype;
begin
  if p_old_bank_id = p_new_bank_id then
    raise exception 'cannot merge a bank into itself' using errcode = 'P0001';
  end if;

  select * into v_old from banks where id = p_old_bank_id for update;
  if not found then
    raise exception 'old bank % does not exist', p_old_bank_id using errcode = 'P0002';
  end if;

  select * into v_new from banks where id = p_new_bank_id for update;
  if not found then
    raise exception 'surviving bank % does not exist', p_new_bank_id using errcode = 'P0002';
  end if;

  if not v_new.is_active then
    raise exception 'cannot merge into an inactive bank' using errcode = 'P0001';
  end if;

  update banks
  set is_active = false, inactive_reason = 'merged', merged_into_bank_id = p_new_bank_id
  where id = p_old_bank_id;

  update banks
  set aka_names = case
    when aka_names is null then array[p_old_bank_name]
    when p_old_bank_name = any(aka_names) then aka_names
    else aka_names || p_old_bank_name
  end
  where id = p_new_bank_id;
end;
$$;

revoke all on function public.merge_duplicate_bank(uuid, uuid, text) from public;
revoke all on function public.merge_duplicate_bank(uuid, uuid, text) from anon;
revoke all on function public.merge_duplicate_bank(uuid, uuid, text) from authenticated;
grant execute on function public.merge_duplicate_bank(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
