import { describe, it, expect } from "vitest";
import { safeJsonLdString, buildBankBreadcrumbJsonLd, buildBreadcrumbJsonLd } from "./jsonLd";

describe("safeJsonLdString", () => {
  it("serializes plain data the same as JSON.stringify", () => {
    expect(safeJsonLdString({ a: 1, b: "two" })).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("escapes literal < so a value can't break out of a <script> tag", () => {
    const out = safeJsonLdString({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script>\\u003cscript>");
  });
});

describe("buildBankBreadcrumbJsonLd", () => {
  it("builds a two-item BreadcrumbList pointing at /banks and the bank profile", () => {
    const result = buildBankBreadcrumbJsonLd({ name: "Chase Bank", slug: "chase" });

    expect(result).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "All banks", item: "https://www.instantrailcheck.com/banks" },
        { "@type": "ListItem", position: 2, name: "Chase Bank", item: "https://www.instantrailcheck.com/banks/chase" },
      ],
    });
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("builds sequential list items with absolute canonical URLs", () => {
    const result = buildBreadcrumbJsonLd([
      { name: "Home", href: "/" },
      { name: "All banks", href: "/banks?page=2" },
    ]);

    expect(result.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.instantrailcheck.com/" },
      {
        "@type": "ListItem",
        position: 2,
        name: "All banks",
        item: "https://www.instantrailcheck.com/banks?page=2",
      },
    ]);
  });
});
