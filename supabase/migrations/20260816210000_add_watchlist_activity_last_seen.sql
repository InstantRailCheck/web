-- v11.1 Phase 2 of the retention loop (see 20260810000000_add_watchlist_follows.sql's
-- own "no activity feed yet" comment): a single per-user marker for how far
-- into their watchlist activity they've already seen, so the header badge
-- (a count of qualifying route_reports since this timestamp) and the
-- /account feed (the same set, in detail) agree on one cutoff instead of
-- drifting apart with two independent "last seen" concepts.
--
-- user_id is the primary key rather than a bigint identity — this is a
-- single marker row per user, not a log, so there is nothing else to key
-- it by. on delete cascade on user_id, same treatment as
-- watchlist_bank_follows/watchlist_route_follows: purely personal
-- bookkeeping with no communal value once its owner is gone.
create table watchlist_activity_last_seen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table watchlist_activity_last_seen enable row level security;

-- No policies of any kind, for any command — same reasoning as the
-- watchlist follow tables: the only write path is
-- lib/actions/markWatchlistActivitySeen.ts (an upsert), and the only read
-- paths are lib/actions/getWatchlistActivity.ts and
-- lib/actions/getWatchlistActivityCount.ts, all via the admin/service-role
-- client, filtered server-side to the caller's own user_id.
grant all privileges on table public.watchlist_activity_last_seen to service_role;

notify pgrst, 'reload schema';
