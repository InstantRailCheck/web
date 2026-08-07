-- v10.1: scripts/backfill-rail-participation.mjs (the script that actually
-- sets banks.fednow_participant/rtp_participant/zelle_participant from the
-- downloaded FedNow/RTP/Zelle participant lists) previously logged nothing
-- about its own runs — /research/instant-payments could only show when the
-- raw source lists were *downloaded*, never when the bank flags were
-- actually *verified* against them. Written only when the script completes
-- with zero per-bank update failures (see the script's own change in this
-- same release) — a partial-failure run must never look like a clean one.
--
-- No failure_count column: a row only ever exists for a zero-failure run,
-- so a stored column that's always 0 by construction would be noise, not
-- information.
create table rail_participation_sync_log (
  id bigint generated always as identity primary key,
  synced_at timestamptz not null default now(),
  banks_processed integer not null,
  banks_updated integer not null,
  ambiguous_count integer not null
);

alter table rail_participation_sync_log enable row level security;

-- Server-only — same reasoning as sync_runs/ncua_reference_sync_log. Only
-- scripts/backfill-rail-participation.mjs (service-role key) ever writes
-- here; no anon/authenticated policy.
grant all privileges on table public.rail_participation_sync_log to service_role;
grant usage, select on sequence public.rail_participation_sync_log_id_seq to service_role;

-- Same gap 20260714030000 fixed for four other tables — fednow_participants/
-- rtp_participants/zelle_participants never got an explicit service_role
-- grant either, and only kept working in production on legacy
-- dashboard-inherited default privileges that predate RLS. A fresh replay
-- (this release's own local db-test is the first thing to ever try writing
-- to these tables against one) fails at the SQL privilege layer with no
-- explicit grant. Made explicit here rather than assumed, per that same
-- migration's own reasoning.
grant all privileges on table public.fednow_participants to service_role;
grant all privileges on table public.rtp_participants to service_role;
grant all privileges on table public.zelle_participants to service_role;

notify pgrst, 'reload schema';
