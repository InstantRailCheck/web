import { describe, it, expect } from "vitest";
import {
  HOME_CANONICAL_URL,
  resolveDirectoryPage,
  banksDirectoryCanonicalPath,
  banksDirectoryMetadata,
  compareMetadata,
  needsFreshReportsCanonicalPath,
  needsFreshReportsMetadata,
} from "./seo";

describe("HOME_CANONICAL_URL", () => {
  it("points at the bare homepage", () => {
    expect(HOME_CANONICAL_URL).toBe("https://www.instantrailcheck.com/");
  });
});

describe("resolveDirectoryPage", () => {
  it("defaults to 1 when missing", () => {
    expect(resolveDirectoryPage(undefined)).toBe(1);
  });

  it("normalizes invalid values to 1", () => {
    expect(resolveDirectoryPage("not-a-number")).toBe(1);
    expect(resolveDirectoryPage("0")).toBe(1);
    expect(resolveDirectoryPage("-5")).toBe(1);
  });

  it("rejects decimals rather than passing a fractional page through", () => {
    expect(resolveDirectoryPage("2.5")).toBe(1);
  });

  it("rejects non-finite values", () => {
    expect(resolveDirectoryPage("Infinity")).toBe(1);
    expect(resolveDirectoryPage("-Infinity")).toBe(1);
    expect(resolveDirectoryPage("NaN")).toBe(1);
  });

  it("rejects negative decimals", () => {
    expect(resolveDirectoryPage("-5.5")).toBe(1);
  });

  it("parses a valid page number", () => {
    expect(resolveDirectoryPage("2")).toBe(2);
  });
});

describe("banksDirectoryCanonicalPath", () => {
  it("collapses page 1 to the bare path", () => {
    expect(banksDirectoryCanonicalPath(1)).toBe("/banks");
  });

  it("keeps a self-referencing path for page 2+", () => {
    expect(banksDirectoryCanonicalPath(2)).toBe("/banks?page=2");
  });
});

describe("banksDirectoryMetadata", () => {
  it("/banks is indexable with canonical /banks", () => {
    expect(banksDirectoryMetadata({})).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/banks" },
    });
  });

  it("/banks?page=1 canonicalizes to /banks and stays indexable", () => {
    expect(banksDirectoryMetadata({ page: "1" })).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/banks" },
    });
  });

  it("/banks?page=2 self-canonicalizes and stays indexable", () => {
    expect(banksDirectoryMetadata({ page: "2" })).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/banks?page=2" },
    });
  });

  it.each(["q", "fednow", "rtp", "zelle", "edd"] as const)(
    "emits noindex,follow when %s is present",
    (key) => {
      const result = banksDirectoryMetadata({ [key]: key === "q" ? "chase" : "true" });
      expect(result.robots).toEqual({ index: false, follow: true });
    }
  );

  it("noindexed filter URLs still canonicalize to the page-normalized listing", () => {
    expect(banksDirectoryMetadata({ fednow: "true", page: "3" })).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/banks?page=3" },
      robots: { index: false, follow: true },
    });
  });
});

describe("compareMetadata", () => {
  it("/compare is indexable with canonical /compare", () => {
    expect(compareMetadata({})).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/compare" },
    });
  });

  it("/compare?banks=a,b is noindex,follow and canonicalizes to /compare", () => {
    expect(compareMetadata({ banks: "chase,sofi" })).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/compare" },
      robots: { index: false, follow: true },
    });
  });
});

describe("needsFreshReportsCanonicalPath", () => {
  it("collapses page 1 to the bare path", () => {
    expect(needsFreshReportsCanonicalPath(1)).toBe("/routes/needs-fresh-reports");
  });

  it("keeps a self-referencing path for page 2+", () => {
    expect(needsFreshReportsCanonicalPath(2)).toBe("/routes/needs-fresh-reports?page=2");
  });
});

describe("needsFreshReportsMetadata", () => {
  it("is noindex,follow with a self-referencing canonical for page 1", () => {
    expect(needsFreshReportsMetadata(1)).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports" },
      robots: { index: false, follow: true },
    });
  });

  it("is noindex,follow with a self-referencing canonical for page 2+", () => {
    expect(needsFreshReportsMetadata(2)).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports?page=2" },
      robots: { index: false, follow: true },
    });
  });
});
