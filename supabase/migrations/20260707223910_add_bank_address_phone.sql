alter table banks add column if not exists address text;
alter table banks add column if not exists phone text;

notify pgrst, 'reload schema';
