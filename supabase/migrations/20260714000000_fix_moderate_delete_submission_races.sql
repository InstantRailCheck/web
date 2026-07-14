-- Fixes two lifecycle bugs in moderate_delete_submission (20260713060000),
-- both found in review immediately after that migration shipped, before
-- anything in production had exercised either path yet.
--
-- 1. Permanently-stranded request: report A fulfills request R
--    (fulfilled_by_report_id = A). Report B arrives for the same pair — the
--    trigger's `where fulfilled_at is null` guard means B never touches R.
--    Deleting A as 'fabricated' correctly declines to reopen R (B is still
--    remaining evidence), but route_requests.fulfilled_by_report_id's own
--    `on delete set null` FK action fires unconditionally regardless of
--    that decision, nulling R.fulfilled_by_report_id. Deleting B later
--    (now genuinely the last evidence, also 'fabricated') searches for
--    requests with fulfilled_by_report_id = B — but R's column is already
--    null, not B's id, so R never reopens despite zero evidence remaining.
--    Fixed by reopening every currently-fulfilled request for the *pair*
--    once v_remaining_reports hits zero, not just the one row pointing at
--    the exact report being deleted.
--
-- 2. Concurrent-delete race: the initial `select ... into v_snapshot` takes
--    no lock, so two concurrent moderator calls for the same target_id can
--    both pass the "not found" check before either DELETE commits. The
--    loser's DELETE then affects zero rows — Postgres doesn't error on
--    that — and the function would previously fall straight through to
--    inserting a second, contradictory audit row and reporting success for
--    a delete it never performed. Fixed by checking the DELETE's own row
--    count and raising not_found if it deleted nothing, closing the gap
--    without needing an explicit row lock: under this database's default
--    read-committed isolation, the loser's DELETE blocks on the winner's
--    row lock and then re-evaluates its WHERE clause against the
--    now-absent row once unblocked, so it reliably reports zero rows
--    deleted rather than racing past the check.
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

  -- Reopen every currently-fulfilled request for this pair, not just the
  -- one whose fulfilled_by_report_id happens to still point at this exact
  -- report, once no attributable evidence remains for the pair at all.
  if p_target_table = 'route_reports' and p_reason_category in ('spam', 'fabricated') then
    select count(*) into v_remaining_reports
    from route_reports
    where from_bank_id = v_pair_from and to_bank_id = v_pair_to
      and user_id is not null and id <> p_target_id;

    if v_remaining_reports = 0 then
      update route_requests
      set fulfilled_at = null, fulfilled_by_report_id = null
      where from_bank_id = v_pair_from and to_bank_id = v_pair_to
        and fulfilled_at is not null;
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
-- CREATE OR REPLACE preserves the function's OID/ACL, so the
-- public/anon/authenticated revokes already applied in 20260713060000 still
-- hold — no need to repeat them.

notify pgrst, 'reload schema';
