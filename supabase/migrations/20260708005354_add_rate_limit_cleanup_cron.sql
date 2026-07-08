create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-rate-limits',
  '*/10 * * * *',
  $$ delete from public.api_rate_limits where window_start < (extract(epoch from now())::bigint / 60) - 10 $$
);
