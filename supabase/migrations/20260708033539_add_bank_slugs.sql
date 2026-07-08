alter table banks add column if not exists slug text;

create unique index if not exists banks_slug_idx on banks (slug);

notify pgrst, 'reload schema';
