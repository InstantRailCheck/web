-- Two real gaps in the v6.1.2 submission-quota triggers, per ChatGPT's
-- follow-up review of 73dd522a:
--
-- 1. created_at has a `now()` DEFAULT but nothing forced it — a direct
--    client insert (bypassing React/Server Actions, same as the quota
--    trigger itself exists to guard against) could supply an old
--    created_at, keeping every submission outside the rolling window the
--    quota counts against and bypassing the limit entirely.
-- 2. The trigger's "SELECT count(*), then permit if under the limit" is a
--    classic check-then-act race — concurrent inserts from the same user
--    can all observe the same pre-insert count and all proceed, letting a
--    burst exceed the quota even with created_at fixed. Serialized per user
--    (not globally) via a transaction-scoped advisory lock, keyed separately
--    per table so route/EDD quota checks for the same user don't block each
--    other unnecessarily.

create or replace function check_route_report_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
begin
  if new.user_id is null then
    return new;
  end if;

  -- Force server-generated timestamps for attributable reports — a client
  -- can otherwise submit any value here, same way it could submit any
  -- bank name before route_reports_derive_bank_names_trigger existed.
  new.created_at := now();

  -- Serializes concurrent quota checks for this user+table only; released
  -- automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext('route_reports_quota'), hashtext(new.user_id::text));

  select count(*) into recent_count
  from route_reports
  where user_id = new.user_id
    and created_at > now() - interval '10 minutes';

  if recent_count >= 20 then
    raise exception 'Too many route reports submitted recently. Please wait a few minutes and try again.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function check_edd_report_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
begin
  if new.user_id is null then
    return new;
  end if;

  new.created_at := now();

  perform pg_advisory_xact_lock(hashtext('edd_reports_quota'), hashtext(new.user_id::text));

  select count(*) into recent_count
  from edd_reports
  where user_id = new.user_id
    and created_at > now() - interval '10 minutes';

  if recent_count >= 10 then
    raise exception 'Too many EDD reports submitted recently. Please wait a few minutes and try again.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
