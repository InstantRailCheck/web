// Canonical values for edd_reports.deposit_type and .payroll_provider — the
// single source of truth for the submission form, aggregation, API types,
// and /developers docs. The database CHECK constraints (see the migration)
// must be kept in sync with these value lists by hand, since SQL can't
// import this file — if either list changes, update the other.
//
// Storage semantics for both fields (kept distinct on purpose):
//   null      = not answered
//   "unknown" = user answered, but doesn't know
//   "other"   = user knows, but it isn't one of the listed options
export const DEPOSIT_TYPES = [
  { value: "paycheck", label: "Paycheck" },
  { value: "government_benefit", label: "Government benefit" },
  { value: "tax_refund", label: "Tax refund" },
  { value: "pension", label: "Pension" },
  { value: "gig_platform", label: "Gig platform payout" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Not sure" },
] as const;

export type DepositType = (typeof DEPOSIT_TYPES)[number]["value"];

export const PAYROLL_PROVIDERS = [
  { value: "adp", label: "ADP" },
  { value: "workday", label: "Workday" },
  { value: "paychex", label: "Paychex" },
  { value: "ukg", label: "UKG" },
  { value: "dayforce", label: "Dayforce" },
  { value: "gusto", label: "Gusto" },
  { value: "rippling", label: "Rippling" },
  { value: "quickbooks_payroll", label: "QuickBooks Payroll" },
  { value: "government_treasury", label: "Government Treasury (e.g. IRS, SSA)" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Not sure" },
] as const;

export type PayrollProvider = (typeof PAYROLL_PROVIDERS)[number]["value"];

// Deposit types for which a "payroll provider" claim doesn't make sense — a
// government benefit, tax refund, or pension isn't payroll, even though a
// user might still answer payroll_provider for one (e.g. "government_treasury"
// on a tax refund is a perfectly sensible answer to record). The exclusion
// is enforced at the aggregation layer, not the form: these deposit types
// never contribute to public payroll-provider summaries, regardless of what
// provider value is stored alongside them.
export const NON_PAYROLL_DEPOSIT_TYPES: ReadonlySet<DepositType> = new Set([
  "government_benefit",
  "tax_refund",
  "pension",
]);

export function depositTypeLabel(value: string | null): string | null {
  return DEPOSIT_TYPES.find((d) => d.value === value)?.label ?? null;
}

export function payrollProviderLabel(value: string | null): string | null {
  return PAYROLL_PROVIDERS.find((p) => p.value === value)?.label ?? null;
}
