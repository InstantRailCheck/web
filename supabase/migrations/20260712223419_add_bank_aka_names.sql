-- Official-source alternate/trade names: NCUA's TradeNames.txt (already
-- synced into ncua_credit_unions.search_names but never carried into banks)
-- for credit unions, and FDIC's TE0{1-10}N529 trade-name fields for banks.
-- Never user-submitted, so this renders directly like website/address/phone
-- rather than going through the correction/review workflow.
--
-- ncua_charter_number/fdic_cert are persisted FK-style links (not just used
-- once for a backfill) so future NCUA syncs and FDIC re-checks can keep
-- aka_names current without re-running the website-matching join every time.
alter table banks
  add column aka_names text[],
  add column ncua_charter_number integer unique references ncua_credit_unions (charter_number),
  add column fdic_cert integer unique;

create index banks_aka_names_idx on banks using gin (aka_names);

notify pgrst, 'reload schema';
