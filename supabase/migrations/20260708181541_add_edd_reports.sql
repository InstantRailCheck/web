-- Early Direct Deposit is a per-bank property (does this bank release
-- incoming deposits early), not a route between two banks like every other
-- rail — a separate table rather than reusing route_reports. No official
-- directory exists for this (it's a marketing feature banks choose to
-- offer), so like ACH/Wire/Visa Direct/Mastercard Send, it's self-reported.

create table edd_reports (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id) on delete cascade,
  days_early smallint not null check (days_early in (0, 1, 2)),
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index edd_reports_bank_id_idx on edd_reports(bank_id);

alter table edd_reports enable row level security;

-- Same pattern as route_reports: authenticated users can only insert their
-- own reports, but aggregate data (avg days early, report count) needs to
-- be publicly readable to show on bank profile pages.
create policy "authenticated_insert" on edd_reports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "edd_reports is publicly readable" on edd_reports
  for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';
