-- v8.0 institution lifecycle (§11): banks.is_active becomes a real,
-- enforced flag. RLS proves report ownership, not that the referenced
-- bank is a currently-listed institution — a direct client insert
-- (bypassing every Server Action) could otherwise still attach a report
-- to a bank the sync has marked inactive. Enforced here, not just in
-- Server Actions, for the same reason route_reports/edd_reports' other
-- constraints are enforced at the table (20260711003000): the boundary
-- that actually receives the writes is the only one that can't be
-- bypassed.
--
-- On INSERT, any reference to an inactive bank is rejected unconditionally.
-- On UPDATE, a bank reference is only checked when it's actually changing
-- in this update — an edit that leaves both bank references untouched
-- (a moderation correction to notes, say) must not be blocked just because
-- the existing, unchanged referenced bank has since gone inactive; only a
-- reference being newly set/changed to an inactive bank is rejected.
create or replace function route_reports_derive_bank_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_active boolean;
  to_active boolean;
begin
  if new.from_bank_id is not null then
    select name, is_active into new.from_bank_name, from_active from banks where id = new.from_bank_id;
    if tg_op = 'INSERT' then
      if not from_active then
        raise exception 'Cannot report a route referencing an inactive institution' using errcode = 'P0001';
      end if;
    elsif new.from_bank_id is distinct from old.from_bank_id and not from_active then
      raise exception 'Cannot report a route referencing an inactive institution' using errcode = 'P0001';
    end if;
  end if;

  if new.to_bank_id is not null then
    select name, is_active into new.to_bank_name, to_active from banks where id = new.to_bank_id;
    if tg_op = 'INSERT' then
      if not to_active then
        raise exception 'Cannot report a route referencing an inactive institution' using errcode = 'P0001';
      end if;
    elsif new.to_bank_id is distinct from old.to_bank_id and not to_active then
      raise exception 'Cannot report a route referencing an inactive institution' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- edd_reports had no derive/validation trigger at all before this release
-- (confirmed: 20260708181541 created the table with only RLS, no trigger).
-- Same insert-unconditional/update-only-on-change rule as above, for
-- bank_id.
create or replace function edd_reports_reject_inactive_bank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bank_active boolean;
begin
  select is_active into bank_active from banks where id = new.bank_id;
  if tg_op = 'INSERT' then
    if not bank_active then
      raise exception 'Cannot report EDD for an inactive institution' using errcode = 'P0001';
    end if;
  elsif new.bank_id is distinct from old.bank_id and not bank_active then
    raise exception 'Cannot report EDD for an inactive institution' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists edd_reports_reject_inactive_bank_trigger on edd_reports;
create trigger edd_reports_reject_inactive_bank_trigger
  before insert or update on edd_reports
  for each row
  execute function edd_reports_reject_inactive_bank();

-- Trigger-only function, never meant to be called directly via PostgREST —
-- same hardening as every other trigger function in this project (see
-- 20260711020000/20260711035000's reasoning: trigger execution does not
-- require the firing role to hold EXECUTE on the trigger function itself).
-- REVOKE ALL FROM PUBLIC also removes service_role's implicit PUBLIC-
-- inherited access, so it needs its own explicit re-grant — confirmed live
-- via this release's local rehearsal (audit-rls-manifest.mjs, which had
-- never been run against a fresh migration replay before now) — matching
-- rlsManifest.mjs's expectation that service_role can execute it.
revoke all on function public.edd_reports_reject_inactive_bank() from public;
revoke all on function public.edd_reports_reject_inactive_bank() from anon;
revoke all on function public.edd_reports_reject_inactive_bank() from authenticated;
grant execute on function public.edd_reports_reject_inactive_bank() to service_role;

notify pgrst, 'reload schema';
