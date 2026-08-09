export type CoverageBankRow = {
  is_active: boolean;
  source_authority: "fdic" | "ncua" | null;
  state: string | null;
  total_assets: number | null;
  fednow_participant: boolean | null;
  rtp_participant: boolean | null;
  zelle_participant: boolean | null;
};

export type RailBuckets = { confirmed: number; notConfirmed: number; unknown: number };
export type CoverageBreakdown = { total: number; fednow: RailBuckets; rtp: RailBuckets; zelle: RailBuckets };

export type CoverageReport = {
  totalActive: number;
  institutionTypes: { fdic: number; ncua: number; unknown: number };
  overall: CoverageBreakdown;
  byAuthority: { fdic: CoverageBreakdown; ncua: CoverageBreakdown; unknown: CoverageBreakdown };
  byAssetTier: { tier: string; breakdown: CoverageBreakdown }[];
  byState: { state: string; breakdown: CoverageBreakdown }[];
  bothFedNowAndRtp: number;
};

export const NOT_ON_FILE = "Not on file";

// Fixed display order — a reader expects ascending size, not "whichever
// tier happens to have the most banks first."
const ASSET_TIERS = ["Under $100M", "$100M–$1B", "$1B–$10B", "$10B+", "Unknown"] as const;

function assetTier(totalAssets: number | null): (typeof ASSET_TIERS)[number] {
  if (totalAssets === null) return "Unknown";
  if (totalAssets < 100_000_000) return "Under $100M";
  if (totalAssets < 1_000_000_000) return "$100M–$1B";
  if (totalAssets < 10_000_000_000) return "$1B–$10B";
  return "$10B+";
}

function normalizeState(state: string | null): string {
  const trimmed = (state ?? "").trim();
  return trimmed || NOT_ON_FILE;
}

function emptyBuckets(): RailBuckets {
  return { confirmed: 0, notConfirmed: 0, unknown: 0 };
}

function emptyBreakdown(): CoverageBreakdown {
  return { total: 0, fednow: emptyBuckets(), rtp: emptyBuckets(), zelle: emptyBuckets() };
}

function addToBuckets(buckets: RailBuckets, value: boolean | null): void {
  if (value === true) buckets.confirmed += 1;
  else if (value === false) buckets.notConfirmed += 1;
  else buckets.unknown += 1;
}

function addBankToBreakdown(breakdown: CoverageBreakdown, bank: CoverageBankRow): void {
  breakdown.total += 1;
  addToBuckets(breakdown.fednow, bank.fednow_participant);
  addToBuckets(breakdown.rtp, bank.rtp_participant);
  addToBuckets(breakdown.zelle, bank.zelle_participant);
}

// Never bakes a fabricated percentage out of a zero-total bucket — a
// division by zero here would otherwise surface as NaN/Infinity on the page.
export function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function computeCoverageReport(banks: CoverageBankRow[]): CoverageReport {
  const active = banks.filter((bank) => bank.is_active);

  const overall = emptyBreakdown();
  const institutionTypes = { fdic: 0, ncua: 0, unknown: 0 };
  const byAuthority = { fdic: emptyBreakdown(), ncua: emptyBreakdown(), unknown: emptyBreakdown() };
  const assetTierBreakdowns = new Map<(typeof ASSET_TIERS)[number], CoverageBreakdown>(
    ASSET_TIERS.map((tier) => [tier, emptyBreakdown()])
  );
  const stateBreakdowns = new Map<string, CoverageBreakdown>();
  let bothFedNowAndRtp = 0;

  for (const bank of active) {
    addBankToBreakdown(overall, bank);

    const authorityKey = bank.source_authority ?? "unknown";
    institutionTypes[authorityKey] += 1;
    addBankToBreakdown(byAuthority[authorityKey], bank);

    addBankToBreakdown(assetTierBreakdowns.get(assetTier(bank.total_assets))!, bank);

    const stateKey = normalizeState(bank.state);
    if (!stateBreakdowns.has(stateKey)) stateBreakdowns.set(stateKey, emptyBreakdown());
    addBankToBreakdown(stateBreakdowns.get(stateKey)!, bank);

    if (bank.fednow_participant === true && bank.rtp_participant === true) bothFedNowAndRtp += 1;
  }

  const byState = Array.from(stateBreakdowns.entries())
    .map(([state, breakdown]) => ({ state, breakdown }))
    .sort((a, b) => b.breakdown.total - a.breakdown.total || a.state.localeCompare(b.state));

  return {
    totalActive: active.length,
    institutionTypes,
    overall,
    byAuthority,
    byAssetTier: ASSET_TIERS.map((tier) => ({ tier, breakdown: assetTierBreakdowns.get(tier)! })),
    byState,
    bothFedNowAndRtp,
  };
}

function breakdownToRow(dimension: string, category: string, breakdown: CoverageBreakdown): Record<string, unknown> {
  return {
    dimension,
    category,
    total: breakdown.total,
    fednow_confirmed: breakdown.fednow.confirmed,
    fednow_not_confirmed: breakdown.fednow.notConfirmed,
    fednow_unknown: breakdown.fednow.unknown,
    rtp_confirmed: breakdown.rtp.confirmed,
    rtp_not_confirmed: breakdown.rtp.notConfirmed,
    rtp_unknown: breakdown.rtp.unknown,
    zelle_confirmed: breakdown.zelle.confirmed,
    zelle_not_confirmed: breakdown.zelle.notConfirmed,
    zelle_unknown: breakdown.zelle.unknown,
  };
}

// One flat table — every row shares the same keys, which toCsv() (lib/csv.ts)
// requires for a sane header row. dimension/category together identify each
// row (e.g. dimension="asset_tier", category="$100M–$1B") rather than
// exporting byAssetTier/byState/byAuthority as separate mismatched tables.
export function flattenCoverageReportToRows(report: CoverageReport): Record<string, unknown>[] {
  return [
    breakdownToRow("overall", "all", report.overall),
    breakdownToRow("institution_type", "fdic", report.byAuthority.fdic),
    breakdownToRow("institution_type", "ncua", report.byAuthority.ncua),
    breakdownToRow("institution_type", "unknown", report.byAuthority.unknown),
    ...report.byAssetTier.map(({ tier, breakdown }) => breakdownToRow("asset_tier", tier, breakdown)),
    ...report.byState.map(({ state, breakdown }) => breakdownToRow("state", state, breakdown)),
  ];
}
