-- v8.0 §6: staging + a single atomic finalize transaction, replacing the
-- append-only import scripts. A sync run always goes through
-- sync_staging_institutions before anything in `banks` is touched, so a
-- reviewed dry-run report and the diff actually applied later are
-- guaranteed to be the same rows (bound further by base_snapshot_hash,
-- computed in 20260716004000).
--
-- Server-only, same reasoning as bank_corrections/webhooks/moderation_
-- actions — no anon/authenticated policy of any kind. Only
-- scripts/sync-institution-directory.mjs (service-role key) ever reads or
-- writes these.
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_scope text not null check (source_scope in ('fdic', 'ncua', 'both')),
  status text not null default 'running'
    check (status in ('running', 'staged', 'applying', 'applied', 'failed', 'guard_blocked', 'expired')),
  fdic_source_total integer,
  fdic_collected_count integer,
  ncua_source_total integer,
  ncua_collected_count integer,
  source_snapshot_hash text,
  -- Hash of every in-scope `banks` row at the moment this run was staged
  -- (see compute_banks_base_snapshot_hash, 20260716004000) — recomputed
  -- and compared at the start of finalize_sync_run so an approved dry-run
  -- diff can never be applied against production state that has since
  -- drifted.
  base_snapshot_hash text,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  inactivated_count integer not null default 0,
  reactivated_count integer not null default 0,
  ambiguous_count integer not null default 0,
  rejected_count integer not null default 0,
  -- A FATAL guard (exact-count mismatch, reject-rate abort, retention-
  -- threshold abort, duplicate-source-identifier abort — §7). Only ever
  -- set alongside status='guard_blocked'; no override exists, the only
  -- remedy is a fresh run.
  guard_reason text,
  -- A NON-fatal, reviewable condition on an otherwise-normal staged run —
  -- today only the inactivation cap. Orthogonal to guard_reason/
  -- guard_blocked on purpose: this run is still status='staged' and can
  -- still be applied, just only with the matching override.
  requires_override_reason text
    check (requires_override_reason is null or requires_override_reason = 'inactivation_cap_exceeded'),
  override_applied boolean not null default false,
  report jsonb
);

create index sync_runs_status_idx on sync_runs (status);

create table sync_staging_institutions (
  id bigint generated always as identity primary key,
  run_id uuid not null references sync_runs(id) on delete cascade,
  source_authority text not null check (source_authority in ('fdic', 'ncua')),
  -- Nullable on purpose: a missing identifier from the source IS a reject
  -- reason, not something this table can refuse to hold. See the partial
  -- unique index below for why this can't be a NOT NULL primary-key column.
  source_identifier integer,
  status text not null check (status in ('valid', 'rejected')),
  reject_reason text,
  -- Defense-in-depth alongside the partial unique index below: a 'valid'
  -- row without an identifier would have nothing for finalize_sync_run to
  -- match against an existing bank or key a new insert on — only a
  -- 'rejected' row may have a null source_identifier.
  constraint sync_staging_valid_requires_identifier_check
    check (status = 'rejected' or source_identifier is not null),
  name text,
  city text,
  state text,
  website text,
  phone text,
  address text,
  total_assets bigint,
  aka_names text[],
  -- Populated for status='valid' rows only — computed once during staging
  -- (§9) and never recomputed at apply time.
  proposed_slug text
);

create index sync_staging_run_id_idx on sync_staging_institutions (run_id);

-- Duplicate identifiers within one source fetch reject EVERY occurrence
-- (§7) — the app computes valid/rejected via an in-memory seen-identifiers
-- check during fetch/parse, before insert. This partial index (scoped to
-- status='valid' only) is defense-in-depth against that in-memory check
-- having a bug, not the primary detection path: at most one row per
-- (run_id, source_authority, source_identifier) can ever be staged valid,
-- while any number of rejected rows sharing that same identifier can
-- coexist.
create unique index sync_staging_valid_identifier_idx
  on sync_staging_institutions (run_id, source_authority, source_identifier)
  where status = 'valid';

alter table sync_runs enable row level security;
alter table sync_staging_institutions enable row level security;

grant all privileges on table public.sync_runs to service_role;
grant all privileges on table public.sync_staging_institutions to service_role;
grant usage, select on sequence public.sync_staging_institutions_id_seq to service_role;

notify pgrst, 'reload schema';
