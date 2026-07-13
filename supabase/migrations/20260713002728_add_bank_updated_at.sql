-- Sitemap freshness: banks.created_at never changes after insert, so
-- Google's crawler has no signal that a bank page's actual content changed
-- (e.g. tonight's aka_names/name corrections) - every bank looks equally
-- "fresh" or "stale" regardless of what actually happened. A real
-- updated_at, maintained by a trigger rather than trusted to every
-- individual write path to set correctly, closes that gap.
--
-- DEFAULT now() on an ADD COLUMN evaluates once, at migration time, for
-- every existing row - so this also naturally backfills every bank to a
-- timestamp reflecting today's real content changes, without a separate
-- backfill script.
alter table banks
  add column updated_at timestamptz not null default now();

-- Same style as this project's other trigger functions (e.g.
-- route_reports_derive_bank_names, log_bank_rail_changes): plpgsql,
-- security definer + pinned search_path as defense-in-depth against
-- search_path hijacking, even though this one doesn't strictly need
-- elevated privileges (it only touches the row already being updated).
create or replace function banks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists banks_set_updated_at_trigger on banks;
create trigger banks_set_updated_at_trigger
  before update on banks
  for each row
  execute function banks_set_updated_at();

-- Trigger-only function, never meant to be called directly via PostgREST -
-- same hardening applied to bank_aka_names_blob and the quota-check
-- trigger functions.
revoke all on function public.banks_set_updated_at() from public;
revoke all on function public.banks_set_updated_at() from anon;
revoke all on function public.banks_set_updated_at() from authenticated;

notify pgrst, 'reload schema';
