-- Captures every change to a bank's fednow/rtp/zelle participation flags,
-- regardless of which code path makes the change (live enrichment, bulk
-- import scripts, backfills, manual corrections). A trigger is used instead
-- of application-level logging so nothing can slip through — there are
-- multiple call sites today and more will likely be added later.
--
-- Not displayed anywhere yet. Collecting now so the data exists when a
-- historical-timeline feature is eventually built — that data is otherwise
-- unrecoverable once lost, unlike a UI which can be added anytime.

create table bank_rail_history (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id) on delete cascade,
  rail text not null check (rail in ('fednow', 'rtp', 'zelle')),
  old_value boolean,
  new_value boolean not null,
  changed_at timestamptz not null default now()
);

create index bank_rail_history_bank_id_idx on bank_rail_history(bank_id);
create index bank_rail_history_changed_at_idx on bank_rail_history(changed_at);

alter table bank_rail_history enable row level security;
-- No public policies yet (service-role only) — matches bank_corrections and
-- webhooks, which are also internal-only until there's a reason to expose them.

create or replace function log_bank_rail_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'UPDATE') then
    if old.fednow_participant is distinct from new.fednow_participant then
      insert into bank_rail_history (bank_id, rail, old_value, new_value)
      values (new.id, 'fednow', old.fednow_participant, new.fednow_participant);
    end if;
    if old.rtp_participant is distinct from new.rtp_participant then
      insert into bank_rail_history (bank_id, rail, old_value, new_value)
      values (new.id, 'rtp', old.rtp_participant, new.rtp_participant);
    end if;
    if old.zelle_participant is distinct from new.zelle_participant then
      insert into bank_rail_history (bank_id, rail, old_value, new_value)
      values (new.id, 'zelle', old.zelle_participant, new.zelle_participant);
    end if;
  elsif (TG_OP = 'INSERT') then
    -- Record any already-true flag on a newly inserted bank as a baseline
    -- fact, so a bank's history isn't empty just because it was added
    -- already-participating (e.g. via the FDIC/NCUA bulk imports).
    if new.fednow_participant then
      insert into bank_rail_history (bank_id, rail, old_value, new_value)
      values (new.id, 'fednow', null, true);
    end if;
    if new.rtp_participant then
      insert into bank_rail_history (bank_id, rail, old_value, new_value)
      values (new.id, 'rtp', null, true);
    end if;
    if new.zelle_participant then
      insert into bank_rail_history (bank_id, rail, old_value, new_value)
      values (new.id, 'zelle', null, true);
    end if;
  end if;
  return new;
end;
$$;

create trigger bank_rail_history_trigger
after insert or update on banks
for each row
execute function log_bank_rail_changes();

-- One-time baseline for banks that already existed before this migration —
-- otherwise their history would start empty despite already having
-- confirmed participation. old_value is left null (unknown prior state, not
-- a captured transition) to stay honest about what we actually know.
insert into bank_rail_history (bank_id, rail, old_value, new_value)
select id, 'fednow', null, true from banks where fednow_participant = true;

insert into bank_rail_history (bank_id, rail, old_value, new_value)
select id, 'rtp', null, true from banks where rtp_participant = true;

insert into bank_rail_history (bank_id, rail, old_value, new_value)
select id, 'zelle', null, true from banks where zelle_participant = true;

notify pgrst, 'reload schema';
