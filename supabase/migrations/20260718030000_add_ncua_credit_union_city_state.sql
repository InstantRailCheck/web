-- Code review finding (external, post-v8.3.0): ncua_credit_unions has no
-- separate city/state columns, only a combined `address` string — even
-- though sync-ncua-directory.mjs already parses PhysicalAddressCity/
-- PhysicalAddressStateCode out of NCUA's own branch data before folding
-- them into that combined string. scripts/sync-institution-directory.mjs
-- was therefore staging every NCUA-sourced bank with city=null/state=null,
-- weakening duplicate-name disambiguation, SEO, and search — not because
-- the data doesn't exist, but because it was discarded one step too early.
-- Fixed at the source: real columns here, populated directly, so nothing
-- downstream has to parse them back out of the combined string.
alter table ncua_credit_unions add column city text;
alter table ncua_credit_unions add column state text;

notify pgrst, 'reload schema';
