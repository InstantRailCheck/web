import { describe, it, expect, vi } from "vitest";
import type { CoverageReport } from "@/lib/coverageReport";

vi.mock("server-only", () => ({}));

function emptyBuckets() {
  return { confirmed: 0, notConfirmed: 0, unknown: 0 };
}

function emptyBreakdown() {
  return { total: 0, fednow: emptyBuckets(), rtp: emptyBuckets(), zelle: emptyBuckets() };
}

const fakeReport: CoverageReport = {
  totalActive: 1,
  institutionTypes: { fdic: 1, ncua: 0, unknown: 0 },
  overall: { ...emptyBreakdown(), total: 1, fednow: { confirmed: 1, notConfirmed: 0, unknown: 0 } },
  byAuthority: { fdic: emptyBreakdown(), ncua: emptyBreakdown(), unknown: emptyBreakdown() },
  byAssetTier: [{ tier: "Under $100M", breakdown: emptyBreakdown() }],
  byState: [{ state: "CA", breakdown: emptyBreakdown() }],
  bothFedNowAndRtp: 0,
};

vi.mock("@/lib/coverageReportFreshness", () => ({
  getCachedCoverageReport: vi.fn(() => Promise.resolve(fakeReport)),
}));

const { GET } = await import("./route");

describe("GET /research/instant-payments/coverage.csv", () => {
  it("sets CSV content-type and a download filename", async () => {
    const res = await GET();
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="instant-payments-coverage.csv"');
  });

  it("body contains the expected header row and a real data row", async () => {
    const res = await GET();
    const body = await res.text();
    const lines = body.split("\n");

    expect(lines[0]).toBe(
      "dimension,category,total,fednow_confirmed,fednow_not_confirmed,fednow_unknown,rtp_confirmed,rtp_not_confirmed,rtp_unknown,zelle_confirmed,zelle_not_confirmed,zelle_unknown"
    );
    expect(body).toContain("overall,all,1,1,0,0");
    expect(body).toContain("state,CA,0,0,0,0");
  });
});
