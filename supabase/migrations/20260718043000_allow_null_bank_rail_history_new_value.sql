-- bank_rail_history.new_value was `not null` because, before v8.3.3,
-- every write path coerced a rail-participation flag to a definite
-- true/false — a genuinely-unknown null could never be the RESULT of a
-- transition, only ever an untouched starting state. The v8.3.3 fix to
-- backfill-rail-participation.mjs (resolveRailFlag) makes that no longer
-- true: a one-time correction can now legitimately transition a
-- wrongly-set false back to null (an "ambiguous" match must never have
-- forced a confident false in the first place). The schema needs to be
-- able to record that transition rather than reject it.
alter table bank_rail_history alter column new_value drop not null;

-- Same gap as 20260714030000_make_service_role_grants_replayable.sql, just
-- for this table — never explicitly granted, so production's dashboard-
-- inherited default privileges made it work there while a fresh local
-- migration replay (this session's own rehearsal, just now) fails at the
-- SQL privilege layer with "permission denied for table bank_rail_history"
-- the moment anything actually tries to read it back.
grant all privileges on table public.bank_rail_history to service_role;

notify pgrst, 'reload schema';
