import { describe, it, expect } from "vitest";
import {
  normalizeWebsite,
  computeAkaNamesFromSearchNames,
  extractFdicAkaNames,
  pickFdicMatch,
} from "./bankAkaNames.mjs";

describe("normalizeWebsite", () => {
  it("strips protocol, www, and a trailing slash", () => {
    expect(normalizeWebsite("https://www.example.com/")).toBe("example.com");
    expect(normalizeWebsite("http://example.com")).toBe("example.com");
  });

  it("lowercases the result", () => {
    expect(normalizeWebsite("HTTPS://WWW.Example.COM")).toBe("example.com");
  });

  it("returns null for null/empty input", () => {
    expect(normalizeWebsite(null)).toBeNull();
    expect(normalizeWebsite("")).toBeNull();
  });
});

describe("computeAkaNamesFromSearchNames", () => {
  it("filters out the primary name (case-insensitively) from search_names", () => {
    const result = computeAkaNamesFromSearchNames("First Neshoba Credit Union", [
      "first neshoba credit union",
      "fnfcu",
    ]);
    expect(result).toEqual(["fnfcu"]);
  });

  it("returns null when nothing remains after filtering out the primary name", () => {
    const result = computeAkaNamesFromSearchNames("Acme Credit Union", ["acme credit union"]);
    expect(result).toBeNull();
  });

  it("returns null for an empty or missing search_names array", () => {
    expect(computeAkaNamesFromSearchNames("Acme Credit Union", [])).toBeNull();
    expect(computeAkaNamesFromSearchNames("Acme Credit Union", undefined)).toBeNull();
  });
});

describe("extractFdicAkaNames", () => {
  it("extracts populated TE0{n}N529 trade-name fields", () => {
    const record = {
      NAME: "JPMorgan Chase Bank, National Association",
      TE01N529: "Chase",
      TE02N529: "J.P.Morgan",
      TE03N529: "JPMorgan Chase",
      TE04N529: "",
      TE05N529: undefined,
    };
    const result = extractFdicAkaNames(record, record.NAME);
    expect(result).toEqual(["Chase", "J.P.Morgan", "JPMorgan Chase"]);
  });

  it("excludes a trade name that's identical to the primary name", () => {
    const record = { TE01N529: "Acme Bank" };
    expect(extractFdicAkaNames(record, "Acme Bank")).toEqual([]);
  });

  it("dedupes repeated trade names across slots", () => {
    const record = { TE01N529: "Chase", TE02N529: "Chase" };
    expect(extractFdicAkaNames(record, "JPMorgan Chase Bank")).toEqual(["Chase"]);
  });

  it("returns an empty array when no trade-name fields are populated", () => {
    expect(extractFdicAkaNames({ NAME: "Small Community Bank" }, "Small Community Bank")).toEqual([]);
  });

  it("excludes a URL sitting in a trade-name slot (real FDIC data-entry quirk, Commerce Bank/CERT 24998)", () => {
    const record = { TE01N529: "www.finemarkbank.com", TE02N529: "A Real Trade Name" };
    expect(extractFdicAkaNames(record, "Commerce Bank")).toEqual(["A Real Trade Name"]);
  });
});

describe("pickFdicMatch", () => {
  // Reproduces the exact live bug found while running the FDIC backfill:
  // searching "City National Bank" returned Citibank ranked first purely on
  // asset size, even though its name has nothing to do with the query.
  it("rejects a higher-asset candidate whose name doesn't actually contain the search term", () => {
    const candidates = [
      { NAME: "Citibank, National Association", ASSET: 1933622000, CERT: 7213 },
      { NAME: "City National Bank", ASSET: 99947369, CERT: 17281 },
      { NAME: "Zions Bancorporation, N.A.", ASSET: 87956932, CERT: 2270 },
    ];
    const match = pickFdicMatch(candidates, "City National Bank");
    expect(match).toEqual({ NAME: "City National Bank", ASSET: 99947369, CERT: 17281 });
  });

  it("returns null when no candidate's name contains the search term", () => {
    const candidates = [{ NAME: "Unrelated Bank", ASSET: 500, CERT: 1 }];
    expect(pickFdicMatch(candidates, "Acme Bank")).toBeNull();
  });

  it("returns null when multiple distinct institutions match (ambiguous)", () => {
    const candidates = [
      { NAME: "First Bank of Texas", ASSET: 500, CERT: 1 },
      { NAME: "First Bank of Ohio", ASSET: 900, CERT: 2 },
    ];
    expect(pickFdicMatch(candidates, "First Bank")).toBeNull();
  });

  it("matches on a whole-word boundary, not a substring", () => {
    const candidates = [{ NAME: "Firstbank Corporation", ASSET: 500, CERT: 1 }];
    expect(pickFdicMatch(candidates, "First Bank")).toBeNull();
  });

  it("treats repeated entries for the same institution (same CERT) as unambiguous", () => {
    const candidates = [
      { NAME: "Acme Bank", ASSET: 500, CERT: 1 },
      { NAME: "Acme Bank", ASSET: 500, CERT: 1 },
    ];
    expect(pickFdicMatch(candidates, "Acme Bank")).toEqual({ NAME: "Acme Bank", ASSET: 500, CERT: 1 });
  });
});
