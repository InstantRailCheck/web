-- v7.0.0 "Request route verification": a lightweight, authenticated demand
-- signal ("please someone check this route") that is explicitly NOT
-- transfer evidence and must never be confused with a route_reports row.
-- Lives in its own table so it can never be mistaken for or merged into
-- real evidence.

create table route_requests (
  id uuid primary key default gen_random_uuid(),
  from_bank_id uuid not null references banks(id),
  to_bank_id uuid not null references banks(id),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  constraint route_requests_distinct_banks_check check (from_bank_id <> to_bank_id)
);

-- Partial, not table-wide: enforces "at most one *active* (unfulfilled)
-- request per user per pair" while still allowing that same user to open a
-- new active request for the same pair later, once their previous one has
-- been fulfilled (see the trigger below) — a user's demand signal shouldn't
-- be permanently "used up" the first time they ever ask for that pair.
create unique index route_requests_active_unique_idx
  on route_requests (from_bank_id, to_bank_id, user_id)
  where fulfilled_at is null;

-- No policies of any kind, for any command. The only write path is the
-- authenticated lib/actions/requestRoute.ts Server Action, using the
-- admin/service-role client (bypasses RLS entirely, same as addBank/
-- submitCorrection) — there is no client-direct insert path to protect with
-- an RLS policy, and no read path at all except the server-side
-- aggregation in lib/needsFreshReports.ts. This means requester identity is
-- private by construction: nobody (anon, authenticated, or another user)
-- can SELECT a raw row.
alter table route_requests enable row level security;

-- Requests can't accumulate forever: if a pair goes requested_only -> (new
-- report arrives) -> drops off the needs-fresh-reports list -> (that same
-- evidence later goes stale) -> reappears as stale, the *old* pre-report
-- requests must not silently reappear as demand against the new stale
-- entry, and the original requesters must be able to signal renewed demand
-- later. Any new attributable (user_id is not null) route_reports insert
-- for a pair marks every currently-active route_requests row for that
-- exact pair as fulfilled — a real report arriving is a direct answer to
-- "please someone check this," regardless of whether that single report is
-- enough to flip the pair's aggregate evidence all the way to "sufficient".
create or replace function route_requests_fulfill_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update route_requests
    set fulfilled_at = now()
    where from_bank_id = new.from_bank_id
      and to_bank_id = new.to_bank_id
      and fulfilled_at is null;
  end if;
  return new;
end;
$$;

create trigger route_requests_fulfill_on_report_trigger
  after insert on route_reports
  for each row
  execute function route_requests_fulfill_on_report();

-- Postgres grants EXECUTE on new functions to PUBLIC by default; this
-- project already closed that gap once for every other SECURITY DEFINER
-- function (20260711020000_lock_down_security_definer_execute_grants.sql).
-- Applying the same treatment here rather than leaving this one open.
revoke all on function public.route_requests_fulfill_on_report() from public;
revoke all on function public.route_requests_fulfill_on_report() from anon;
revoke all on function public.route_requests_fulfill_on_report() from authenticated;

notify pgrst, 'reload schema';
