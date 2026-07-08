alter table banks add column if not exists zelle_participant boolean;

create table zelle_participants (
  id bigint generated always as identity primary key,
  name text not null,
  search_name text not null,
  slug text,
  updated_at timestamptz not null default now()
);

create index zelle_participants_search_name_idx on zelle_participants (search_name);

alter table zelle_participants enable row level security;

create policy "Allow public read access" on zelle_participants
for select
to public
using (true);

notify pgrst, 'reload schema';
