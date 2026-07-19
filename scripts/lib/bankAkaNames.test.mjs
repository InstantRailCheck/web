import { describe, it, expect } from "vitest";
import {
  normalizeWebsite,
  computeAkaNamesFromSearchNames,
  extractFdicAkaNames,
  pickFdicMatch,
  deriveDomainInitialsAka,
  mergeAkaNames,
  classifyAlias,
  isSafePublicAlias,
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

describe("classifyAlias", () => {
  it("flags a real NCUA data quirk: ANECA's TradeNames row lists an unrelated major brokerage", () => {
    expect(classifyAlias("ANECA", "morgan stanley").safe).toBe(false);
    expect(classifyAlias("ANECA", "jp morgan").safe).toBe(false);
  });

  it("does not flag a brand term that's part of the institution's own name", () => {
    // "Chase" is JPMorgan Chase's own real trade name, not a foreign brand claim.
    const result = classifyAlias("JPMorgan Chase Bank, National Association", "Chase");
    expect(result).toEqual({ safe: true, reason: "shares a meaningful word with the primary name" });
  });

  it("allows a genuine abbreviation that shares no brand term but relates lexically", () => {
    expect(classifyAlias("First Neshoba Federal Credit Union", "fnfcu").safe).toBe(true);
  });

  it("allows a compound-vs-spaced variant of the same word (jpmorgan vs morgan)", () => {
    expect(classifyAlias("JPMorgan Chase Bank, National Association", "J.P.Morgan").safe).toBe(true);
  });

  it("rejects an alias with zero lexical relationship to the primary name, even without a brand hit", () => {
    const result = classifyAlias("Westex Community Credit Union", "Rainier Hardware Supply");
    expect(result).toEqual({ safe: false, reason: "no lexical relationship to the primary name" });
  });
});

describe("isSafePublicAlias", () => {
  it("is a boolean wrapper over classifyAlias", () => {
    expect(isSafePublicAlias("ANECA", "morgan stanley")).toBe(false);
    expect(isSafePublicAlias("First Neshoba Federal Credit Union", "fnfcu")).toBe(true);
  });
});

describe("computeAkaNamesFromSearchNames", () => {
  it("filters out the primary name (case-insensitively) from search_names", () => {
    const result = computeAkaNamesFromSearchNames("First Neshoba Federal Credit Union", [
      "first neshoba federal credit union",
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

  it("suppresses an unrelated major-brand alias from the real ANECA data (charter 3212)", () => {
    const result = computeAkaNamesFromSearchNames("ANECA", ["aneca", "morgan stanley", "jp morgan"]);
    expect(result).toBeNull();
  });

  it("keeps a genuine alias alongside a suppressed unsafe one", () => {
    const result = computeAkaNamesFromSearchNames("Westex Community Credit Union", [
      "westex community credit union",
      "wccu",
      "Rainier Hardware Supply",
    ]);
    expect(result).toEqual(["wccu"]);
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

describe("deriveDomainInitialsAka", () => {
  it("returns the initials when the institution's own domain exactly matches them (American Southwest Credit Union / ascu.org)", () => {
    expect(deriveDomainInitialsAka("American Southwest Credit Union", "http://www.ascu.org")).toBe("ASCU");
  });

  it("matches even with the real official name including 'Federal' (First Neshoba Federal Credit Union / fnfcu.org)", () => {
    expect(deriveDomainInitialsAka("First Neshoba Federal Credit Union", "http://www.fnfcu.org")).toBe("FNFCU");
  });

  it("does not match the name as currently stored without 'Federal' (the real gap found live)", () => {
    expect(deriveDomainInitialsAka("First Neshoba Credit Union", "http://www.fnfcu.org")).toBeNull();
  });

  it("skips stopwords ('and') when computing initials (Olean Teachers and Postal Federal Credit Union / otpfcu.com)", () => {
    expect(deriveDomainInitialsAka("Olean Teachers and Postal Federal Credit Union", "https://www.otpfcu.com")).toBe(
      "OTPFCU"
    );
  });

  it("returns null when the domain is a brand name, not initials (1st University Credit Union / culink.net)", () => {
    expect(deriveDomainInitialsAka("1st University Credit Union", "http://www.culink.net")).toBeNull();
  });

  it("returns null when initials are below the minimum length", () => {
    expect(deriveDomainInitialsAka("AB Bank", "http://www.ab.com")).toBeNull();
  });

  it("returns null with no website", () => {
    expect(deriveDomainInitialsAka("American Southwest Credit Union", null)).toBeNull();
  });

  it("returns null on a malformed website value", () => {
    expect(deriveDomainInitialsAka("American Southwest Credit Union", "not a url")).toBeNull();
  });
});

describe("mergeAkaNames", () => {
  // Reproduces the exact live bug: overwriting aka_names with only the
  // freshly-recomputed NCUA data on every sync silently erased the
  // domain-derived acronym, since NCUA's own data never contained it.
  it("adds the domain-derived acronym alongside official aka names, not overwriting them", () => {
    expect(mergeAkaNames(["first neshoba"], "FNFCU")).toEqual(["first neshoba", "FNFCU"]);
  });

  it("does not duplicate the domain-derived acronym if already present (case-insensitive)", () => {
    expect(mergeAkaNames(["fnfcu"], "FNFCU")).toEqual(["fnfcu"]);
  });

  it("returns just the domain-derived acronym when there are no official aka names", () => {
    expect(mergeAkaNames(null, "ASCU")).toEqual(["ASCU"]);
  });

  it("returns just the official aka names when there's no domain-derived acronym", () => {
    expect(mergeAkaNames(["olean teachers and postal"], null)).toEqual(["olean teachers and postal"]);
  });

  it("returns null when there's neither an official nor a domain-derived aka", () => {
    expect(mergeAkaNames(null, null)).toBeNull();
  });
});
