create table bank_corrections (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  user_id uuid not null references auth.users(id),
  field text not null,
  submitted_value text not null,
  previous_value text,
  status text not null,
  created_at timestamptz not null default now()
);

create index bank_corrections_bank_id_idx on bank_corrections (bank_id);

alter table bank_corrections enable row level security;

create policy "authenticated_insert_own" on bank_corrections
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "select_own" on bank_corrections
for select
to authenticated
using (auth.uid() = user_id);

notify pgrst, 'reload schema';
