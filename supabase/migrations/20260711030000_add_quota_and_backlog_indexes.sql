-- The v6.1.2 rolling-quota triggers run this exact filter on every single
-- insert into route_reports/edd_reports:
--   select count(*) from <table> where user_id = ... and created_at > ...
-- With no supporting index this is a full sequential scan per insert,
-- getting linearly slower as each table grows. A composite (user_id,
-- created_at) index serves it directly.
create index if not exists route_reports_user_id_created_at_idx
  on route_reports (user_id, created_at);

create index if not exists edd_reports_user_id_created_at_idx
  on edd_reports (user_id, created_at);
