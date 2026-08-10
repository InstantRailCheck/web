-- v11.0 Phase 1: the foundational data model for "Follow this bank" /
-- "Watch this route" — the missing retention loop (Search -> verify ->
-- follow -> receive an update -> return -> contribute). No activity feed
-- yet (that's Phase 2); this is just the follow relationship itself.
--
-- on delete cascade on user_id (not set null, unlike route_reports/
-- edd_reports) — a watchlist is purely personal with no communal evidence
-- value once its owner is gone, same treatment as webhooks
-- (20260711033000_add_account_deletion_fk_actions.sql). on delete cascade
-- on bank_id too — a dangling follow pointing at a hard-deleted bank is
-- never useful.
create table watchlist_bank_follows (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bank_id uuid not null references banks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, bank_id)
);

-- Directional pair (from/to, not an unordered pair), matching every other
-- route table (route_reports, route_requests) — a real transfer has a
-- direction, and route evidence/status can differ by direction.
create table watchlist_route_follows (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_bank_id uuid not null references banks(id) on delete cascade,
  to_bank_id uuid not null references banks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, from_bank_id, to_bank_id),
  constraint watchlist_route_follows_distinct_banks_check check (from_bank_id <> to_bank_id)
);

alter table watchlist_bank_follows enable row level security;
alter table watchlist_route_follows enable row level security;

-- No policies of any kind, for any command — same reasoning as
-- route_requests (20260713050000_add_route_requests.sql): the only write
-- path is lib/actions/{follow,unfollow}{Bank,Route}.ts, using the
-- admin/service-role client, and the only read path is
-- lib/actions/getWatchlist.ts (also admin client, filtered to the caller's
-- own user_id server-side). Nobody — anon, authenticated, or another user —
-- can SELECT a raw row directly.
grant all privileges on table public.watchlist_bank_follows to service_role;
grant all privileges on table public.watchlist_route_follows to service_role;
grant usage, select on sequence public.watchlist_bank_follows_id_seq to service_role;
grant usage, select on sequence public.watchlist_route_follows_id_seq to service_role;

notify pgrst, 'reload schema';
