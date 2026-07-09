-- Some banks/fintechs advertise up to 5 days early (not just the common
-- 1-2 day range). Widen the range to 0-6, with 6 as a sentinel for "more
-- than 5 days early" rather than trying to track unbounded exact values.

alter table edd_reports drop constraint edd_reports_days_early_check;
alter table edd_reports add constraint edd_reports_days_early_check
  check (days_early >= 0 and days_early <= 6);

notify pgrst, 'reload schema';
