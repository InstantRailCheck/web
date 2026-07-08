create table webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  url text not null,
  secret text not null,
  event text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index webhooks_event_idx on webhooks (event) where is_active = true;
create index webhooks_user_id_idx on webhooks (user_id);

alter table webhooks enable row level security;

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event text not null,
  success boolean not null,
  response_status integer,
  error text,
  created_at timestamptz not null default now()
);

create index webhook_deliveries_webhook_id_idx on webhook_deliveries (webhook_id);

alter table webhook_deliveries enable row level security;

notify pgrst, 'reload schema';
