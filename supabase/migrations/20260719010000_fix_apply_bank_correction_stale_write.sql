-- Code review finding (post-v8.5.0): apply_bank_correction locked the bank
-- row (`for update`) but never checked that the field it was about to
-- write still held the value submitCorrection.ts read *before* running its
-- external official-source lookup. Between that read and this RPC call, a
-- concurrent write (an admin edit, a sync re-apply, another correction)
-- could change the field — this RPC would then overwrite that concurrent
-- write and record a wrong previous_value in bank_corrections, silently
-- clobbering whatever just landed.
--
-- Fixed by comparing the just-locked value against p_previous_value with
-- IS NOT DISTINCT FROM (so a previous NULL is handled correctly, not just
-- non-null values) and aborting instead of writing — the caller sees a
-- plain error and can resubmit against current data, same as any other
-- apply failure.
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
    if p_field = 'website' then
      update banks set website = p_official_value where id = p_bank_id;
    elsif p_field = 'phone' then
      update banks set phone = p_official_value where id = p_bank_id;
    end if;
  end if;

  return query select v_status;
end;
$$;

revoke all on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) from public;
revoke all on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) from anon;
revoke all on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) from authenticated;
grant execute on function public.apply_bank_correction(uuid, uuid, text, text, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
