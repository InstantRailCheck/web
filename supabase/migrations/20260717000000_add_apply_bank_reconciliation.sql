-- v8.0 §5: existing-data reconciliation apply step. audit-unlinked-banks.mjs
-- (read-only) identifies candidate FDIC/NCUA matches for the banks with
-- neither identifier set; a human reviews and approves specific matches;
-- scripts/apply-reconciliation.mjs re-verifies each approved match against
-- CURRENT data (a live re-check, since the identifier corroboration
-- depends on FDIC's live API and can drift between audit and apply) and
-- only then calls this RPC with the matches that passed that re-check.
--
-- The re-corroboration/drift check itself can't live in this function —
-- Postgres can't make outbound HTTP calls to FDIC's API — so this only
-- owns what genuinely needs transactional atomicity against concurrent
-- writes: confirming each bank is still unlinked and each identifier
-- isn't already claimed, then applying every approved match in one
-- all-or-nothing transaction. A single invalid entry aborts the whole
-- batch — "all approved matches apply atomically," not partial-apply.
create or replace function apply_bank_reconciliation(p_matches jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match jsonb;
  v_bank_id uuid;
  v_source_authority text;
  v_identifier integer;
  v_applied_count integer := 0;
  v_bank banks%rowtype;
begin
  for v_match in select * from jsonb_array_elements(p_matches)
  loop
    v_bank_id := (v_match->>'bank_id')::uuid;
    v_source_authority := v_match->>'source_authority';
    v_identifier := (v_match->>'identifier')::integer;

    if v_source_authority not in ('fdic', 'ncua') then
      raise exception 'invalid source_authority % for bank %', v_source_authority, v_bank_id
        using errcode = 'P0001';
    end if;

    select * into v_bank from banks where id = v_bank_id for update;
    if not found then
      raise exception 'bank % does not exist', v_bank_id using errcode = 'P0002';
    end if;

    if v_bank.fdic_cert is not null or v_bank.ncua_charter_number is not null then
      raise exception 'bank % (%) is no longer unlinked — already claimed by fdic_cert=%/ncua_charter_number=%',
        v_bank_id, v_bank.name, v_bank.fdic_cert, v_bank.ncua_charter_number
        using errcode = 'P0001';
    end if;

    if v_source_authority = 'fdic' then
      if exists (select 1 from banks where fdic_cert = v_identifier) then
        raise exception 'fdic_cert % is already claimed by another bank', v_identifier using errcode = 'P0001';
      end if;
      update banks set fdic_cert = v_identifier, source_authority = 'fdic', source_last_synced_at = now()
      where id = v_bank_id;
    else
      if exists (select 1 from banks where ncua_charter_number = v_identifier) then
        raise exception 'ncua_charter_number % is already claimed by another bank', v_identifier using errcode = 'P0001';
      end if;
      update banks set ncua_charter_number = v_identifier, source_authority = 'ncua', source_last_synced_at = now()
      where id = v_bank_id;
    end if;

    v_applied_count := v_applied_count + 1;
  end loop;

  return jsonb_build_object('applied_count', v_applied_count);
end;
$$;

revoke all on function public.apply_bank_reconciliation(jsonb) from public;
revoke all on function public.apply_bank_reconciliation(jsonb) from anon;
revoke all on function public.apply_bank_reconciliation(jsonb) from authenticated;
grant execute on function public.apply_bank_reconciliation(jsonb) to service_role;

notify pgrst, 'reload schema';
