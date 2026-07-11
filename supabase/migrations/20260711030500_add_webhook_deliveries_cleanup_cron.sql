-- webhook_deliveries had no retention policy — unbounded growth for every
-- account with an active webhook. Unlike api_rate_limits (a short-lived
-- counter, already cleaned up every 10 minutes), delivery records have
-- real value to a user debugging a recent integration issue, so this keeps
-- a much longer window: 30 days is enough for that, short enough to bound
-- table growth.
select cron.schedule(
  'cleanup-webhook-deliveries',
  '0 3 * * *', -- daily at 03:00 UTC, off-peak
  $$ delete from public.webhook_deliveries where created_at < now() - interval '30 days' $$
);
