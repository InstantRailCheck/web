-- Fixes two further bugs in the 20260714000000 fix, both found in review
-- before either had been exercised by anything but that migration's own
-- verification script.
--
-- 1. The pair-wide reopen UPDATE could touch more than one row belonging to
--    the same user_id at once. route_requests_active_unique_idx
--    (20260713050000) is a *partial* unique index on (from_bank_id,
--    to_bank_id, user_id) where fulfilled_at is null — and the documented
--    design explicitly allows a single user to accumulate several
--    historical fulfilled rows for the same pair over time (request ->
--    fulfilled -> request again -> fulfilled again). Setting fulfilled_at
--    to null on two of that same user's rows in one UPDATE — or on one row
--    while another of theirs is already active — violates that index and
--    rolls back the entire delete. Fixed by reopening at most one row per
--    requester (their single most recently fulfilled row for the pair),
--    and only when they don't already hold a currently-active request for
--    it.
--
-- 2. The row-count-after-DELETE check added in 20260714000000 only
--    protects two calls racing on the *same* target row. It does nothing
--    to serialize the "how much evidence remains for this pair" read
--    across two concurrent calls deleting two *different* reports for the
--    same pair: each can count the other's not-yet-committed row as
--    remaining evidence, both decline to reopen, and both successfully
--    delete — stranding the request even though zero evidence remains
--    once both commit. Fixed with pg_advisory_xact_lock, keyed on the
--    pair, held for the rest of the transaction (i.e. for the rest of this
--    single RPC call) — a second concurrent call for the same pair blocks
--    until the first fully commits, so its own remaining-evidence count
--    always reflects the first call's already-committed delete.
create or replace function moderate_delete_submission(
  p_target_table text,
  p_target_id uuid,
  p_moderator_id uuid,
  p_reason text,
  p_reason_category text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_pair_from uuid;
  v_pair_to uuid;
  v_remaining_reports int;
  v_deleted_count int;
begin
  if p_target_table not in ('route_reports', 'edd_reports', 'route_requests') then
    raise exception 'invalid target_table: %', p_target_table using errcode = 'P0001';
  end if;

  if p_target_table = 'route_reports' then
    select jsonb_build_object(
      'from_bank_id', from_bank_id, 'from_bank_name', from_bank_name,
      'to_bank_id', to_bank_id, 'to_bank_name', to_bank_name,
      'rail_used', rail_used, 'direction', direction, 'status', status,
      'tested_at', tested_at, 'settlement_time_minutes', settlement_time_minutes,
      'same_day', same_day, 'notes', notes, 'created_at', created_at
    ), from_bank_id, to_bank_id
    into v_snapshot, v_pair_from, v_pair_to
    from route_reports where id = p_target_id;
  elsif p_target_table = 'edd_reports' then
    select jsonb_build_object(
      'bank_id', bank_id, 'days_early', days_early,
      'deposit_type', deposit_type, 'payroll_provider', payroll_provider,
      'created_at', created_at
    )
    into v_snapshot from edd_reports where id = p_target_id;
  else
    select jsonb_build_object('from_bank_id', from_bank_id, 'to_bank_id', to_bank_id, 'created_at', created_at)
    into v_snapshot from route_requests where id = p_target_id;
  end if;

  if v_snapshot is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_target_table = 'route_reports' and p_reason_category in ('spam', 'fabricated') then
    -- Serializes only against other moderate_delete_submission calls for
    -- this exact (directional) pair — never against the ordinary
    -- route_reports insert path (route_requests_fulfill_on_report), which
    -- doesn't take this lock. That's intentional: a real report landing
    -- concurrently with a moderation delete is a pre-existing, unrelated
    -- edge case, not something this fix is scoped to touch.
    perform pg_advisory_xact_lock(hashtext(v_pair_from::text), hashtext(v_pair_to::text));

    select count(*) into v_remaining_reports
    from route_reports
    where from_bank_id = v_pair_from and to_bank_id = v_pair_to
      and user_id is not null and id <> p_target_id;

    if v_remaining_reports = 0 then
      with candidates as (
        select distinct on (user_id) id, user_id
        from route_requests
        where from_bank_id = v_pair_from and to_bank_id = v_pair_to
          and fulfilled_at is not null
        order by user_id, created_at desc, id desc
      ),
      eligible as (
        select c.id
        from candidates c
        where not exists (
          select 1 from route_requests active
          where active.from_bank_id = v_pair_from and active.to_bank_id = v_pair_to
            and active.user_id is not distinct from c.user_id
            and active.fulfilled_at is null
        )
      )
      update route_requests
      set fulfilled_at = null, fulfilled_by_report_id = null
      where id in (select id from eligible);
    end if;
  end if;

  execute format('delete from %I where id = $1', p_target_table) using p_target_id;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count = 0 then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into moderation_actions (moderator_user_id, action_type, target_table, target_id, reason, reason_category, snapshot)
  values (p_moderator_id, 'delete', p_target_table, p_target_id, p_reason, p_reason_category, v_snapshot);
end;
$$;
-- CREATE OR REPLACE preserves the function's OID/ACL — the
-- public/anon/authenticated revokes from 20260713060000 still hold.

notify pgrst, 'reload schema';
