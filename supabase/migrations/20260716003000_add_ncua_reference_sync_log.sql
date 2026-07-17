-- v8.0 §7: ncua_credit_unions only ever upserts by charter_number
-- (scripts/sync-ncua-directory.mjs) and never removes or flags a charter
-- absent from the newest FOICU file — so "read every row in
-- ncua_credit_unions" can never observe a closure, no matter how the
-- institution-directory sync's guard logic is written, because the table
-- itself has no concept of "not in the latest file." Comparing the
-- table's own row count against itself is also circular — it can never
-- catch a truncated/partial NCUA download either.
--
-- Fixed at the source: every successful monthly sync-ncua-directory.mjs
-- run writes one row here BEFORE its upsert loop runs (with its own
-- retention guard — see the script), and stamps every charter it upserts
-- that run with this run's id. A charter not touched by the latest
-- successful run is then correctly invisible to a query scoped to
-- last_seen_sync_id = <latest log id> — real closure detection, without
-- ever deleting a historical ncua_credit_unions row.
create table ncua_reference_sync_log (
  id bigint generated always as identity primary key,
  synced_at timestamptz not null default now(),
  quarter text not null,
  foicu_row_count integer not null
);

alter table ncua_credit_unions add column last_seen_sync_id bigint references ncua_reference_sync_log(id);

create index ncua_credit_unions_last_seen_sync_id_idx on ncua_credit_unions (last_seen_sync_id);

alter table ncua_reference_sync_log enable row level security;

-- Server-only — same reasoning as sync_runs/sync_staging_institutions.
-- Only scripts/sync-ncua-directory.mjs and
-- scripts/sync-institution-directory.mjs (service-role key) ever touch
-- this.
grant all privileges on table public.ncua_reference_sync_log to service_role;
grant usage, select on sequence public.ncua_reference_sync_log_id_seq to service_role;

-- No tracked migration ever explicitly granted service_role write access
-- to ncua_credit_unions (only a public-read RLS policy exists) — it has
-- presumably relied on production's dashboard-inherited default
-- privileges, the exact gap 20260714030000 found and fixed for four other
-- tables ("fresh migration replays do not inherit the same
-- dashboard-created default privileges as production"). Made explicit
-- here rather than assumed, since this release's local rehearsal
-- (scripts/db-tests/) is the first thing to ever exercise a real write to
-- this table against a freshly-replayed local Postgres.
grant all privileges on table public.ncua_credit_unions to service_role;

notify pgrst, 'reload schema';
