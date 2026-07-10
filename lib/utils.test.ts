import { describe, expect, it } from "vitest";
import { formatPhone, slugify, telHref } from "./utils";

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Chase")).toBe("chase");
    expect(slugify("Bank of America")).toBe("bank-of-america");
  });

  it("replaces commas, periods, and other punctuation with dashes", () => {
    expect(slugify("Capital One, National Association")).toBe("capital-one-national-association");
    expect(slugify("U.S. Bank")).toBe("u-s-bank");
  });

  it("collapses runs of punctuation/whitespace into a single dash", () => {
    expect(slugify("AT&T   Bank!!")).toBe("at-t-bank");
  });

  it("trims leading and trailing whitespace before slugifying", () => {
    expect(slugify("  Chase  ")).toBe("chase");
  });

  it("trims leading and trailing dashes left over from punctuation", () => {
    expect(slugify(".Chase.")).toBe("chase");
    expect(slugify("!!!Wells Fargo!!!")).toBe("wells-fargo");
  });

  it("preserves numbers", () => {
    expect(slugify("1st National Bank")).toBe("1st-national-bank");
  });

  it("preserves existing dashes without doubling them", () => {
    expect(slugify("First-Citizens Bank")).toBe("first-citizens-bank");
  });

  it("returns an empty string for input with no alphanumeric characters", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("replaces non-ASCII letters with a dash rather than preserving them", () => {
    // Documents actual behavior, not necessarily desired behavior — accented
    // characters fall outside [a-z0-9] even after lowercasing, so they're
    // treated as punctuation. Worth knowing if a bank name ever needs this.
    expect(slugify("Banco Español")).toBe("banco-espa-ol");
  });
});

describe("formatPhone", () => {
  it("formats a 10-digit number", () => {
    expect(formatPhone("2125551234")).toBe("(212) 555-1234");
  });

  it("formats an 11-digit number with a leading 1", () => {
    expect(formatPhone("12125551234")).toBe("(212) 555-1234");
  });

  it("strips non-digit characters before formatting", () => {
    expect(formatPhone("(212) 555-1234")).toBe("(212) 555-1234");
    expect(formatPhone("212.555.1234")).toBe("(212) 555-1234");
  });

  it("returns the original string unchanged if it isn't 10 or 11 digits", () => {
    expect(formatPhone("555-1234")).toBe("555-1234");
    expect(formatPhone("not a phone number")).toBe("not a phone number");
  });

  it("returns null for null input", () => {
    expect(formatPhone(null)).toBeNull();
  });
});

describe("telHref", () => {
  it("builds a tel: URI with a +1 prefix from a 10-digit number", () => {
    expect(telHref("2125551234")).toBe("tel:+12125551234");
  });

  it("builds a tel: URI from an 11-digit number with a leading 1", () => {
    expect(telHref("12125551234")).toBe("tel:+12125551234");
  });

  it("strips non-digit characters before building the URI", () => {
    expect(telHref("(212) 555-1234")).toBe("tel:+12125551234");
  });

  it("returns null if the number isn't 10 or 11 digits", () => {
    expect(telHref("555-1234")).toBeNull();
    expect(telHref("not a phone number")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(telHref(null)).toBeNull();
  });
});
