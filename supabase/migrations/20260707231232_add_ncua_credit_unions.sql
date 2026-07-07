create table ncua_credit_unions (
  charter_number integer primary key,
  name text not null,
  search_names text[] not null default '{}',
  website text,
  address text,
  phone text,
  updated_at timestamptz not null default now()
);

create index ncua_credit_unions_search_names_idx on ncua_credit_unions using gin (search_names);

alter table ncua_credit_unions enable row level security;

create policy "Allow public read access" on ncua_credit_unions
for select
to public
using (true);

notify pgrst, 'reload schema';
