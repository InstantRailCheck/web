-- Total assets (in dollars) for sorting by institution size. Sourced from
-- FDIC's ASSET field (banks) and NCUA's ACCT_010 field in FS220.txt, the
-- standard account code for Total Assets in the 5300 call report chart of
-- accounts (verified against Navy Federal's real reported figure before
-- trusting this). Nullable — not every bank has a confident match, and a
-- blank is safer than a guessed figure.

alter table banks add column total_assets bigint;
alter table ncua_credit_unions add column total_assets bigint;

notify pgrst, 'reload schema';
