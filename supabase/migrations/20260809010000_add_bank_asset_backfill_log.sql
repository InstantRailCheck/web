-- scripts/backfill-bank-assets.mjs writes banks.total_assets directly with
-- no log of its own — unlike every other data-mutating script in this
-- project (backfill-rail-participation.mjs -> rail_participation_sync_log,
-- sync-ncua-directory.mjs -> ncua_reference_sync_log,
-- sync-institution-directory.mjs -> sync_runs). Since asset size drives
-- /research/instant-payments's byAssetTier breakdown, the coverage report's
-- dateModified could go stale silently: asset data can change with no
-- timestamp anywhere reflecting it. Same shape as
-- 20260806000000_add_rail_participation_sync_log.sql, including the
-- "only written on a zero-failure run" contract the script now enforces.
create table bank_asset_backfill_log (
  id bigint generated always as identity primary key,
  synced_at timestamptz not null default now(),
  banks_processed integer not null,
  matched integer not null,
  cleared integer not null
);

alter table bank_asset_backfill_log enable row level security;

-- Server-only — same reasoning as rail_participation_sync_log/
-- ncua_reference_sync_log. Only scripts/backfill-bank-assets.mjs (service-
-- role key) ever writes here; no anon/authenticated policy.
grant all privileges on table public.bank_asset_backfill_log to service_role;
grant usage, select on sequence public.bank_asset_backfill_log_id_seq to service_role;

notify pgrst, 'reload schema';
