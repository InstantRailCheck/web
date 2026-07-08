alter table banks add column if not exists fednow_participant boolean;
alter table banks add column if not exists rtp_participant boolean;

create table fednow_participants (
  id bigint generated always as identity primary key,
  name text not null,
  search_name text not null,
  city text,
  state text,
  updated_at timestamptz not null default now()
);

create index fednow_participants_search_name_idx on fednow_participants (search_name);

alter table fednow_participants enable row level security;

create policy "Allow public read access" on fednow_participants
for select
to public
using (true);

create table rtp_participants (
  id bigint generated always as identity primary key,
  name text not null,
  search_name text not null,
  state text,
  updated_at timestamptz not null default now()
);

create index rtp_participants_search_name_idx on rtp_participants (search_name);

alter table rtp_participants enable row level security;

create policy "Allow public read access" on rtp_participants
for select
to public
using (true);

notify pgrst, 'reload schema';
