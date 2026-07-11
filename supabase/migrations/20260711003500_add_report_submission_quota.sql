-- Evidence dedup (dedupeToNewestPerReporter etc.) prevents one account from
-- inflating public reporter counts, but nothing previously stopped a signed-
-- in account from inserting indefinitely — RLS proves ownership, not
-- reasonable submission volume. Direct browser inserts bypass React/Server
-- Actions entirely, so the limit has to live at the table itself rather
-- than in application code. Thresholds are deliberately generous — this is
-- an abuse/cost guard, not a UX-facing limit a genuine user should ever
-- notice.

create or replace function check_route_report_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
begin
  -- Rows inserted by the admin/service-role client (e.g. seed data, backfill
  -- scripts) have no user_id under the current RLS policy's authenticated
  -- insert path and are trusted, not subject to this per-user guard.
  if new.user_id is null then
    return new;
  end if;

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

drop trigger if exists route_reports_quota_trigger on route_reports;
create trigger route_reports_quota_trigger
  before insert on route_reports
  for each row
  execute function check_route_report_quota();

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

drop trigger if exists edd_reports_quota_trigger on edd_reports;
create trigger edd_reports_quota_trigger
  before insert on edd_reports
  for each row
  execute function check_edd_report_quota();
