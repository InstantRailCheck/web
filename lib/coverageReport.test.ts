import { describe, it, expect } from "vitest";
import { computeCoverageReport, pct, NOT_ON_FILE, type CoverageBankRow, type CoverageBreakdown } from "./coverageReport";

function bankRow(overrides: Partial<CoverageBankRow> = {}): CoverageBankRow {
  return {
    is_active: true,
    source_authority: "fdic",
    state: "CA",
    total_assets: 500_000_000,
    fednow_participant: null,
    rtp_participant: null,
    zelle_participant: null,
    ...overrides,
  };
}

function sumBreakdownTotals(breakdowns: CoverageBreakdown[]): number {
  return breakdowns.reduce((sum, b) => sum + b.total, 0);
}

describe("pct", () => {
  it("returns 0 rather than NaN/Infinity for a zero-total denominator", () => {
    expect(pct(0, 0)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    expect(pct(1, 3)).toBe(33.3);
  });

  it("returns 100 when numerator equals denominator", () => {
    expect(pct(5, 5)).toBe(100);
  });
});

describe("computeCoverageReport", () => {
  it("excludes inactive institutions from every count", () => {
    const report = computeCoverageReport([
      bankRow({ is_active: true, fednow_participant: true }),
      bankRow({ is_active: false, fednow_participant: true }),
    ]);

    expect(report.totalActive).toBe(1);
    expect(report.overall.fednow.confirmed).toBe(1);
    expect(report.overall.total).toBe(1);
  });

  it("never merges null into false for any rail", () => {
    const report = computeCoverageReport([
      bankRow({ fednow_participant: true }),
      bankRow({ fednow_participant: false }),
      bankRow({ fednow_participant: null }),
    ]);

    expect(report.overall.fednow).toEqual({ confirmed: 1, notConfirmed: 1, unknown: 1 });
  });

  it("normalizes null, empty-string, and whitespace-only state all to 'Not on file'", () => {
    const report = computeCoverageReport([
      bankRow({ state: null }),
      bankRow({ state: "" }),
      bankRow({ state: "   " }),
      bankRow({ state: "CA" }),
    ]);

    const notOnFile = report.byState.find((row) => row.state === NOT_ON_FILE);
    expect(notOnFile?.breakdown.total).toBe(3);
    expect(report.byState.find((row) => row.state === "CA")?.breakdown.total).toBe(1);
  });

  it("buckets total_assets boundary values into the correct asset tier on both sides", () => {
    const report = computeCoverageReport([
      bankRow({ total_assets: 99_999_999 }), // just under $100M
      bankRow({ total_assets: 100_000_000 }), // exactly $100M
      bankRow({ total_assets: 999_999_999 }), // just under $1B
      bankRow({ total_assets: 1_000_000_000 }), // exactly $1B
      bankRow({ total_assets: 9_999_999_999 }), // just under $10B
      bankRow({ total_assets: 10_000_000_000 }), // exactly $10B
      bankRow({ total_assets: null }),
    ]);

    const tierTotal = (tier: string) => report.byAssetTier.find((t) => t.tier === tier)?.breakdown.total ?? 0;
    expect(tierTotal("Under $100M")).toBe(1);
    expect(tierTotal("$100M–$1B")).toBe(2);
    expect(tierTotal("$1B–$10B")).toBe(2);
    expect(tierTotal("$10B+")).toBe(1);
    expect(tierTotal("Unknown")).toBe(1);
  });

  it("never drops the Unknown asset tier from the report even when every bank has assets on file", () => {
    const report = computeCoverageReport([bankRow({ total_assets: 500_000_000 })]);
    expect(report.byAssetTier.find((t) => t.tier === "Unknown")?.breakdown.total).toBe(0);
    expect(report.byAssetTier.map((t) => t.tier)).toContain("Unknown");
  });

  it("byAuthority breakdowns sum back to totalActive", () => {
    const report = computeCoverageReport([
      bankRow({ source_authority: "fdic" }),
      bankRow({ source_authority: "ncua" }),
      bankRow({ source_authority: null }),
      bankRow({ source_authority: "fdic" }),
    ]);

    expect(report.institutionTypes).toEqual({ fdic: 2, ncua: 1, unknown: 1 });
    expect(sumBreakdownTotals(Object.values(report.byAuthority))).toBe(report.totalActive);
  });

  it("byAssetTier and byState breakdowns each sum back to totalActive", () => {
    const banks = [
      bankRow({ total_assets: 1, state: "CA" }),
      bankRow({ total_assets: null, state: null }),
      bankRow({ total_assets: 5_000_000_000, state: "NY" }),
    ];
    const report = computeCoverageReport(banks);

    expect(sumBreakdownTotals(report.byAssetTier.map((t) => t.breakdown))).toBe(report.totalActive);
    expect(sumBreakdownTotals(report.byState.map((s) => s.breakdown))).toBe(report.totalActive);
  });

  it("counts bothFedNowAndRtp only when both are exactly true", () => {
    const report = computeCoverageReport([
      bankRow({ fednow_participant: true, rtp_participant: true }),
      bankRow({ fednow_participant: true, rtp_participant: false }),
      bankRow({ fednow_participant: true, rtp_participant: null }),
      bankRow({ fednow_participant: false, rtp_participant: false }),
    ]);

    expect(report.bothFedNowAndRtp).toBe(1);
  });

  it("sorts byState by total descending, alphabetically breaking ties", () => {
    const report = computeCoverageReport([
      bankRow({ state: "NY" }),
      bankRow({ state: "NY" }),
      bankRow({ state: "CA" }),
      bankRow({ state: "TX" }),
    ]);

    expect(report.byState.map((row) => row.state)).toEqual(["NY", "CA", "TX"]);
  });
});
