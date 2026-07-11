-- route_reports predates complete migration tracking and had zero CHECK
-- constraints — only a PK and FKs. RLS's `auth.uid() = user_id` proves
-- ownership, not that the submitted values are sane: a direct browser
-- insert (bypassing the UI's own client-side validation) could previously
-- set status/direction/rail_used to any string, a negative or absurd
-- settlement_time_minutes, a far-future tested_at, from_bank_id = to_bank_id,
-- or an unbounded notes string. Constraints below match what the UI already
-- restricts users to (components/SubmitRouteReport.tsx), enforced now at the
-- boundary that actually receives the writes.

alter table route_reports
  add constraint route_reports_status_check
  check (status in ('success', 'failed', 'delayed'));

alter table route_reports
  add constraint route_reports_rail_used_check
  check (rail_used in ('RTP', 'FedNow', 'ACH', 'Wire', 'Zelle', 'Visa Direct', 'Mastercard Send', 'Other', 'Unknown'));

-- Nullable historically (existing rows predate the direction field) — NULL
-- passes a CHECK by default, so no explicit allowance needed.
alter table route_reports
  add constraint route_reports_direction_check
  check (direction in ('push', 'pull'));

-- Upper bound is deliberately generous (7 days) — status='delayed' exists
-- precisely for real multi-day outliers, this is only to catch obviously
-- bogus input (e.g. a stray extra digit), not to second-guess slow but real
-- transfers.
alter table route_reports
  add constraint route_reports_settlement_time_check
  check (settlement_time_minutes >= 0 and settlement_time_minutes <= 10080);

-- +1 day grace for timezone skew between the client's local "today" and the
-- server's UTC "today" — the DatePicker already caps this client-side
-- (max={today()}), this is the same rule enforced server-side.
alter table route_reports
  add constraint route_reports_tested_at_check
  check (tested_at <= current_date + 1);

alter table route_reports
  add constraint route_reports_distinct_banks_check
  check (from_bank_id is null or to_bank_id is null or from_bank_id <> to_bank_id);

alter table route_reports
  add constraint route_reports_notes_length_check
  check (notes is null or length(notes) <= 2000);

-- from_bank_name/to_bank_name are denormalized display text with no length
-- bound and, more importantly, nothing previously verified they matched the
-- bank the ID actually points to — a client could submit a real from_bank_id
-- alongside an unrelated from_bank_name, misrepresenting that bank anywhere
-- the name is displayed (changelog, route results). The trigger below
-- ignores whatever name the client sends and always derives it from the
-- referenced bank row instead; the length check is defense in depth in case
-- the trigger is ever removed.
alter table route_reports
  add constraint route_reports_from_bank_name_length_check
  check (length(from_bank_name) <= 200);

alter table route_reports
  add constraint route_reports_to_bank_name_length_check
  check (length(to_bank_name) <= 200);

create or replace function route_reports_derive_bank_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.from_bank_id is not null then
    select name into new.from_bank_name from banks where id = new.from_bank_id;
  end if;
  if new.to_bank_id is not null then
    select name into new.to_bank_name from banks where id = new.to_bank_id;
  end if;
  return new;
end;
$$;

drop trigger if exists route_reports_derive_bank_names_trigger on route_reports;
create trigger route_reports_derive_bank_names_trigger
  before insert or update on route_reports
  for each row
  execute function route_reports_derive_bank_names();

-- Same "free text with no bound" gap on the two other client-writable free
-- text surfaces ChatGPT's review flagged: a bank name (addBank.ts, the sole
-- insert path since v5.0.0) and a submitted correction value
-- (submitCorrection.ts). Neither had a length cap before this migration.
alter table banks
  add constraint banks_name_length_check
  check (length(name) <= 200);

alter table bank_corrections
  add constraint bank_corrections_submitted_value_length_check
  check (length(submitted_value) <= 500);
