-- Baseline for the two tables that predate this repo's migration tracking
-- entirely: `banks` and `route_reports`. Every migration from
-- 20260707061416 onward assumes both already exist (the very first
-- tracked migration, 20260707061416_fix_route_reports_insert_rls.sql,
-- drops a policy named "public_insert" on route_reports) — without this
-- baseline, `supabase start`/`supabase db reset` cannot replay the
-- migration history from scratch on a fresh database (the FK references
-- to `banks(id)` in later migrations would fail against a nonexistent
-- table). Written 2026-07-14 for v7.2's new local-Postgres CI job
-- (scripts/db-tests/), reconstructed from two sources: (1) every later
-- migration's ALTER/comment history for these two tables (several,
-- e.g. 20260711003000, explicitly narrate the pre-migration state: "route_
-- reports predates complete migration tracking and had zero CHECK
-- constraints — only a PK and FKs"), and (2) a live read of production's
-- actual current columns to confirm exactly which ones are NOT explained
-- by any tracked migration (banks.logo_url and banks.is_active are both
-- real production columns with no corresponding tracked ADD COLUMN
-- anywhere — confirmed via a direct production query, 2026-07-14).
--
-- Deliberately narrower on NOT NULL/CHECK fidelity than the real
-- production tables: every column added by a LATER tracked migration is
-- intentionally excluded here (that migration adds it itself when
-- replayed), and where this reconstruction was uncertain whether a
-- historical column was ever NOT NULL, it defaults to nullable rather
-- than guessing a constraint that might reject a legitimate later
-- migration or insert — the goal is a schema the full migration history
-- replays cleanly against and the application can genuinely exercise, not
-- a byte-exact production replica.

create table banks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table banks enable row level security;

create policy "Allow public read access" on banks
for select
to public
using (true);

-- Original unrestricted insert policy — replaced by addBank.ts's
-- server-only path and dropped in 20260709193000_remove_unrestricted_banks_insert.sql
-- (which uses DROP POLICY IF EXISTS, so this isn't strictly required for
-- that later migration to apply, but is included for historical fidelity).
create policy "auth_insert" on banks
for insert
to authenticated
with check (true);

create table route_reports (
  id uuid primary key default gen_random_uuid(),
  from_bank_id uuid references banks(id),
  to_bank_id uuid references banks(id),
  from_bank_name text,
  to_bank_name text,
  rail_used text,
  status text,
  direction text,
  tested_at date,
  settlement_time_minutes integer,
  notes text,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table route_reports enable row level security;

-- Dropped by 20260707061416_fix_route_reports_insert_rls.sql (the
-- earliest tracked migration) WITHOUT "if exists" — must exist here for
-- that DROP POLICY to succeed on replay.
create policy "public_insert" on route_reports
for insert
to public
with check (true);

notify pgrst, 'reload schema';
