-- Adds optional payroll-context fields to edd_reports: what kind of
-- deposit it was, and which payroll platform/provider (if any) the
-- reporter recognized. Both nullable — existing rows stay valid with null
-- in both columns, and the columns stay optional for new submissions too
-- (a report shouldn't be rejected just because someone doesn't know).
--
-- Deliberately no exact employer name or free-text provider field in this
-- release — only the fixed, low-cardinality value lists below, which must
-- stay in sync with lib/eddContext.ts (the app-side source of truth for
-- the form, aggregation, and API types — SQL can't import that file, so
-- if either list changes, update the other by hand).
alter table edd_reports
  add column deposit_type text
    check (deposit_type in (
      'paycheck', 'government_benefit', 'tax_refund', 'pension',
      'gig_platform', 'other', 'unknown'
    )),
  add column payroll_provider text
    check (payroll_provider in (
      'adp', 'workday', 'paychex', 'ukg', 'dayforce', 'gusto', 'rippling',
      'quickbooks_payroll', 'government_treasury', 'other', 'unknown'
    ));

notify pgrst, 'reload schema';
