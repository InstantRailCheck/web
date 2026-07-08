alter table route_reports add column if not exists same_day boolean;

notify pgrst, 'reload schema';
