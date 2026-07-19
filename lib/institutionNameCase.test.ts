import { describe, it, expect } from "vitest";
import { smartTitleCase, isAllCapsName } from "./institutionNameCase";

describe("isAllCapsName", () => {
  it("is true for a fully-uppercase name", () => {
    expect(isAllCapsName("A.S.H. EMPLOYEES")).toBe(true);
  });

  it("is false for a name with any lowercase letter", () => {
    expect(isAllCapsName("A.s.h. Employees Credit Union")).toBe(false);
  });

  it("is false for a name with no letters at all", () => {
    expect(isAllCapsName("1166")).toBe(false);
  });
});

describe("smartTitleCase", () => {
  it("title-cases simple words", () => {
    expect(smartTitleCase("WESTEX COMMUNITY")).toBe("Westex Community");
  });

  it("preserves a possessive 's without capitalizing it", () => {
    expect(smartTitleCase("LONGSHOREMEN'S LOCAL 4")).toBe("Longshoremen's Local 4");
    expect(smartTitleCase("PEOPLE'S ALLIANCE")).toBe("People's Alliance");
    expect(smartTitleCase("AMERICA'S CREDIT UNION")).toBe("America's Credit Union");
  });

  it("still capitalizes the letter after an apostrophe when it's not a possessive 's", () => {
    expect(smartTitleCase("JEANNE D'ARC")).toBe("Jeanne D'Arc");
    expect(smartTitleCase("L'OREAL USA")).toBe("L'Oreal USA");
  });

  it("capitalizes each side of a hyphenated compound", () => {
    expect(smartTitleCase("WRIGHT-DUNBAR AREA")).toBe("Wright-Dunbar Area");
    expect(smartTitleCase("CO-OPERATIVE")).toBe("Co-Operative");
  });

  it("lowercases ordinal suffixes, including inside a hyphenated compound", () => {
    expect(smartTitleCase("MEMBERS 1ST")).toBe("Members 1st");
    expect(smartTitleCase("77TH STREET DEPOT")).toBe("77th Street Depot");
    expect(smartTitleCase("CTA-74TH STREET DEPOT")).toBe("Cta-74th Street Depot");
  });

  it("lowercases minor words that aren't the first word", () => {
    expect(smartTitleCase("MASS. INSTITUTE OF TECH.")).toBe("Mass. Institute of Tech.");
    expect(smartTitleCase("OLEAN TEACHERS' AND POSTAL")).toBe("Olean Teachers' and Postal");
  });

  it("never lowercases a single-letter word, even if it matches a minor word", () => {
    // "A" here is an initial (as in "A&M"), never the article "a".
    expect(smartTitleCase("FLORIDA A & M UNIVERSITY")).toBe("Florida A & M University");
    expect(smartTitleCase("F & A")).toBe("F & A");
  });

  it("keeps single letters separated by periods intact (initials-style abbreviations)", () => {
    expect(smartTitleCase("U.P.S.")).toBe("U.P.S.");
    expect(smartTitleCase("F.C.I. ASHLAND")).toBe("F.C.I. Ashland");
    expect(smartTitleCase("KENMORE N. Y. TEACHERS")).toBe("Kenmore N. Y. Teachers");
  });

  it("preserves known acronyms/state codes in the ACRONYMS list", () => {
    expect(smartTitleCase("INTERNATIONAL UAW")).toBe("International UAW");
    expect(smartTitleCase("HMC (NJ)")).toBe("Hmc (NJ)");
  });

  it("preserves ANECA's own genuine all-caps name rather than flattening it to 'Aneca' (charter 3212)", () => {
    expect(smartTitleCase("ANECA")).toBe("ANECA");
  });

  it("leaves bare numbers and symbol-only tokens untouched", () => {
    expect(smartTitleCase("1166")).toBe("1166");
    expect(smartTitleCase("Y-12")).toBe("Y-12");
    expect(smartTitleCase("OCNAC #1")).toBe("Ocnac #1");
  });

  it("is idempotent on an already-correct mixed-case name", () => {
    const name = "Members 1st of NJ";
    expect(smartTitleCase(name)).toBe(name);
  });
});
