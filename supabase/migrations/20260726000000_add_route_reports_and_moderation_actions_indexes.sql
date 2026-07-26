-- route_reports and moderation_actions are read on nearly every request
-- this app serves (route lookups, bank profiles, the admin moderation
-- queue, risk triage) but only ever gained an index for the insert-quota
-- check (route_reports_user_id_created_at_idx, see
-- 20260711030000_add_quota_and_backlog_indexes.sql). Every index below is
-- tied to a real, currently-shipping query — no speculative columns.
--
-- Not validated against EXPLAIN (ANALYZE, BUFFERS) on production-like data
-- volume: this environment has no access to a Postgres instance (local or
-- production) to run that against. Before this ships, re-run EXPLAIN
-- (ANALYZE, BUFFERS) for the query patterns cited below against a
-- realistic row count and confirm each index is actually chosen by the
-- planner and improves the plan — `if not exists` makes this safe to
-- apply either way, but an unused index still costs write overhead and
-- storage for no benefit.

-- lib/routingEngine.ts's getRouteIntelligence() — the route-check lookup
-- hit on every homepage search and every /api/routes call — filters
-- .eq("from_bank_id", ...).eq("to_bank_id", ...) with no rail_used filter
-- (it groups by rail after fetching), so (from_bank_id, to_bank_id) alone
-- would serve that query. rail_used is still added as a third column
-- because lib/actions/submitRouteReport.ts's existing-reports check
-- filters .eq("from_bank_id", ...).eq("to_bank_id", ...).eq("rail_used", ...)
-- on every single report submission (duplicate/consensus detection) — the
-- exact same leading two columns plus an equality on the third is what
-- this composite is for, so one index serves both call sites instead of
-- carrying two overlapping ones.
create index if not exists route_reports_from_bank_id_to_bank_id_rail_used_idx
  on route_reports (from_bank_id, to_bank_id, rail_used);

-- lib/bankProfile.ts's buildProfile() loads a bank's full report history
-- with .or(`from_bank_id.eq.${id},to_bank_id.eq.${id}`) — an OR across two
-- different columns, which the composite index above cannot serve (it can
-- only be used when from_bank_id is constrained). Postgres satisfies an OR
-- like this with a BitmapOr over one index scan per branch, so each side
-- needs its own single-column index.
create index if not exists route_reports_from_bank_id_idx
  on route_reports (from_bank_id);

create index if not exists route_reports_to_bank_id_idx
  on route_reports (to_bank_id);

-- Three call sites order/filter route_reports by recency:
--   lib/moderation.ts's listRouteReports(): .order("created_at", desc).order("id", desc)
--     — the admin queue's stable-pagination ordering, id as an explicit
--     tiebreaker for rows sharing a created_at timestamp.
--   lib/activityFeed.ts's getActivityFeed(): .order("created_at", desc).limit(n)
--     — the public changelog feed.
--   lib/riskTriage.ts: multiple .gte("created_at", ...).lte("created_at", ...)
--     range scans over a fixed window — a leading created_at column serves
--     a range condition the same way it serves an ORDER BY.
-- id is included as a second key (not a separate index) purely to give
-- moderation.ts's exact ordering an index-only tiebreak; the other two
-- callers simply use created_at as the index's leading column.
create index if not exists route_reports_created_at_id_idx
  on route_reports (created_at desc, id desc);

-- lib/moderation.ts's listUserModerationHistory(): .eq("subject_user_id", userId)
-- .order("created_at", desc).limit(20) — a single user's moderation history,
-- newest first. subject_user_id leading, created_at desc second, so the
-- filter and the ordering are both served by one index-order scan instead
-- of a filter followed by a sort.
create index if not exists moderation_actions_subject_user_id_created_at_idx
  on moderation_actions (subject_user_id, created_at desc);

-- lib/riskTriage.ts's per-signal aggregate counts:
--   .eq("action_type", "delete").in("subject_user_id", userIds)
--   .in("action_type", ["restrict","suspend","ban"]).in("subject_user_id", userIds)
-- Both constrain action_type to a small fixed set and subject_user_id to a
-- batch of candidate users at once — action_type leading keeps the low-
-- cardinality filter first, narrowing before the per-user IN-list lookup.
-- Distinct from the index above: that one is keyed for "one user, ordered
-- by time"; this one is "one or few action types, many users," and neither
-- composite can serve the other's query efficiently since subject_user_id
-- and action_type swap which column leads.
create index if not exists moderation_actions_action_type_subject_user_id_idx
  on moderation_actions (action_type, subject_user_id);
