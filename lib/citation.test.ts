import { describe, it, expect } from "vitest";
import { buildCoverageReportCitation } from "./citation";

describe("buildCoverageReportCitation", () => {
  it("includes a 'Data verified Month Year' clause when dateModified is present", () => {
    const result = buildCoverageReportCitation({
      dateModified: "2026-08-07T05:32:33.939361+00:00",
      url: "https://www.instantrailcheck.com/research/instant-payments",
    });

    expect(result).toBe(
      'InstantRailCheck. "U.S. Instant Payments Coverage." Data verified August 2026. https://www.instantrailcheck.com/research/instant-payments'
    );
  });

  it("omits the verified clause entirely (no double space or stray punctuation) when dateModified is null", () => {
    const result = buildCoverageReportCitation({
      dateModified: null,
      url: "https://www.instantrailcheck.com/research/instant-payments",
    });

    expect(result).toBe(
      'InstantRailCheck. "U.S. Instant Payments Coverage." https://www.instantrailcheck.com/research/instant-payments'
    );
    expect(result).not.toContain("  ");
  });
});
