-- Code review finding (post-v8.3.4): submitCorrection.ts validated `field`
-- only via its TypeScript union type — a Server Action is a real HTTP
-- endpoint underneath, callable with arbitrary JSON regardless of what
-- the TS signature says. An out-of-union `field` string reached
-- `.update({ [field]: officialValue })` on the service-role client with
-- no runtime allowlist in front of it: bank_corrections' own field check
-- constraint (20260711020500) rejected the insert, but that insert error
-- was never checked, and the computed-key update ran anyway using
-- attacker-chosen column name. Fixed at both layers: submitCorrection.ts
-- now allowlists `field` before doing anything else, and this RPC makes
-- the whole "insert the correction record, then (only if matched)
-- update exactly one hardcoded column" sequence one atomic, server-
-- enforced transaction — no computed key anywhere, and an insert failure
-- (invalid field, constraint violation, anything) aborts the update too,
-- rather than leaving them as two independently-fallible statements.
--
-- Also closes the gap the v8.0 institution-lifecycle work left here:
-- route_reports/edd_reports reject writes against an inactive bank at
-- the table level (20260716001000), but bank_corrections never got the
-- same treatment — a correction against an inactive/delisted institution
-- is enforced here the same way, via `for update` row lock + explicit
-- check, not just relying on a Server Action doing the right thing.
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
