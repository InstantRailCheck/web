-- v7.x admin moderation: today the only way to remove a bad route_reports/
-- edd_reports/route_requests row is a direct Supabase dashboard edit using
-- the service-role connection — no rate limiting, no authorization beyond
-- "has a project login," no audit trail, no cache invalidation. This gives
-- admins a real in-app path with the same authorization/audit/invalidation
-- discipline every other write in this codebase already gets.
--
-- bank_corrections is deliberately excluded — it already has its own
-- pending_review/auto_applied lifecycle, a differently-shaped workflow than
-- "remove bad community evidence."

-- Lets a moderation delete of the fulfilling report precisely identify
-- (and, in moderate_delete_submission below, reopen) only the specific
-- requests it fulfilled, rather than every active request for the pair.
alter table route_requests
  add column fulfilled_by_report_id uuid references route_reports(id) on delete set null;

create or replace function route_requests_fulfill_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update route_requests
    set fulfilled_at = now(), fulfilled_by_report_id = new.id
    where from_bank_id = new.from_bank_id
      and to_bank_id = new.to_bank_id
      and fulfilled_at is null;
  end if;
  return new;
end;
$$;
-- CREATE OR REPLACE preserves the function's OID/ACL, so the
-- public/anon/authenticated revokes already applied in
-- 20260713050000_add_route_requests.sql still hold — no need to repeat them.

-- Private, audit-only record of every moderation delete. No policies at
-- all: server-only via the admin client, same as bank_corrections/webhooks.
create table moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_user_id uuid references auth.users(id) on delete set null,
  action_type text not null check (action_type in ('delete')),
  target_table text not null check (target_table in ('route_reports', 'edd_reports', 'route_requests')),
  target_id uuid not null,
  reason text not null check (length(reason) between 1 and 500),
  reason_category text not null check (reason_category in ('spam', 'fabricated', 'duplicate', 'privacy', 'other')),
  -- Evidentiary fields only — deliberately never the reporting user's
  -- user_id. The audit record's job is "what was removed and why," not
  -- "who submitted it"; every other surface in this codebase already
  -- treats reporter identity as something to anonymize/hide.
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table moderation_actions enable row level security;

-- Atomic delete+audit: the whole body is one implicit transaction, so a
-- failure anywhere (row not found, invalid table, an unexpected constraint
-- violation) rolls back the snapshot capture, the reopening update, and the
-- delete together. Target-table allowlist is enforced twice: the CHECK
-- constraint above and the explicit guard below, before the one,
-- necessarily dynamic, format()-built DELETE — always validated against a
-- fixed literal list first, never arbitrary/client-controlled SQL.
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

  -- Reopen requests this specific report fulfilled, only for a category
  -- meaning "this never actually happened," and only if the pair has no
  -- other attributable evidence left once this report is gone.
  if p_target_table = 'route_reports' and p_reason_category in ('spam', 'fabricated') then
    select count(*) into v_remaining_reports
    from route_reports
    where from_bank_id = v_pair_from and to_bank_id = v_pair_to
      and user_id is not null and id <> p_target_id;

    if v_remaining_reports = 0 then
      update route_requests
      set fulfilled_at = null, fulfilled_by_report_id = null
      where fulfilled_by_report_id = p_target_id;
    end if;
  end if;

  execute format('delete from %I where id = $1', p_target_table) using p_target_id;

  insert into moderation_actions (moderator_user_id, action_type, target_table, target_id, reason, reason_category, snapshot)
  values (p_moderator_id, 'delete', p_target_table, p_target_id, p_reason, p_reason_category, v_snapshot);
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default; every
-- other SECURITY DEFINER function in this project has this closed
-- (20260711020000_lock_down_security_definer_execute_grants.sql) — this is
-- the one real callable RPC here (invoked directly via admin.rpc(...) from
-- lib/actions/moderateDelete.ts), so service_role-only is both correct and
-- sufficient; it must never be reachable by anon/authenticated directly.
revoke all on function public.moderate_delete_submission(text, uuid, uuid, text, text) from public;
revoke all on function public.moderate_delete_submission(text, uuid, uuid, text, text) from anon;
revoke all on function public.moderate_delete_submission(text, uuid, uuid, text, text) from authenticated;

notify pgrst, 'reload schema';
