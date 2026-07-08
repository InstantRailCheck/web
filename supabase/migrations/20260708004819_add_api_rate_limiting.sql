create table api_rate_limits (
  key text not null,
  window_start bigint not null,
  count integer not null default 1,
  primary key (key, window_start)
);

alter table api_rate_limits enable row level security;

create or replace function increment_rate_limit(p_key text, p_window bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into api_rate_limits (key, window_start, count)
  values (p_key, p_window, 1)
  on conflict (key, window_start)
  do update set count = api_rate_limits.count + 1
  returning count into new_count;

  return new_count;
end;
$$;

notify pgrst, 'reload schema';
