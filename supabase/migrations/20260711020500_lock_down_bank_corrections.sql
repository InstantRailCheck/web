-- bank_corrections' only legitimate write path is submitCorrection.ts,
-- which authenticates, rate-limits, validates the bank and field, re-runs
-- the official-source lookups, derives status server-side, and inserts via
-- the admin client — RLS was never actually needed for this table anymore,
-- same reasoning that already removed banks' direct-insert policy in
-- v5.0.0. A direct client insert bypassed all of that (throttling included)
-- and could set arbitrary field/status/previous_value, polluting the
-- review queue. Nothing in the app reads bank_corrections client-side
-- either (also always goes through the admin client), so both the INSERT
-- and SELECT policies are dropped, not just INSERT.

drop policy if exists authenticated_insert_own on bank_corrections;
drop policy if exists select_own on bank_corrections;

-- Defense in depth even though only server code writes here now — matches
-- the two values submitCorrection.ts actually ever produces. Table is
-- currently empty in production, so nothing existing to violate this.
alter table bank_corrections
  add constraint bank_corrections_field_check
  check (field in ('website', 'phone'));

alter table bank_corrections
  add constraint bank_corrections_status_check
  check (status in ('auto_applied', 'pending_review'));
