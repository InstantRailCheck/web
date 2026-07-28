import { describe, it, expect } from "vitest";
import { safeJsonLdString, buildBankBreadcrumbJsonLd, buildBreadcrumbJsonLd, buildFaqJsonLd } from "./jsonLd";

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

describe("buildFaqJsonLd", () => {
  it("builds a FAQPage with one Question/Answer per item, in order", () => {
    const result = buildFaqJsonLd([
      { question: "Does Chase support FedNow?", answer: "Yes." },
      { question: "Does Chase support RTP?", answer: "No." },
    ]);

    expect(result).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Does Chase support FedNow?",
          acceptedAnswer: { "@type": "Answer", text: "Yes." },
        },
        {
          "@type": "Question",
          name: "Does Chase support RTP?",
          acceptedAnswer: { "@type": "Answer", text: "No." },
        },
      ],
    });
  });

  it("builds an empty mainEntity for an empty item list", () => {
    expect(buildFaqJsonLd([])).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [],
    });
  });
});
