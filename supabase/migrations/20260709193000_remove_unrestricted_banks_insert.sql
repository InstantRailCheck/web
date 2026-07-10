-- The "auth_insert" policy allowed any authenticated user to insert an
-- arbitrary row into banks via a direct client call, with no restriction
-- on which columns they set — including fednow_participant/rtp_participant/
-- zelle_participant/total_assets, letting a signed-in user fabricate a
-- fully "verified" bank from scratch, bypassing all official-source
-- matching. The only legitimate caller (adding a new bank when submitting
-- a route report) is moving to a proper authenticated server action using
-- the service role, so the direct client-insert path is removed rather
-- than narrowed — matches the admin-only pattern already used for
-- webhooks/webhook_deliveries/api_rate_limits.

drop policy if exists "auth_insert" on banks;
