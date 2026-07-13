import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { generateMetadata } = await import("./page");

describe("/compare generateMetadata", () => {
  it("/compare is indexable with canonical /compare", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(result).toEqual({ alternates: { canonical: "https://www.instantrailcheck.com/compare" } });
  });

  it("/compare?banks=chase,sofi emits noindex,follow and canonicalizes to /compare", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ banks: "chase,sofi" }) });
    expect(result).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/compare" },
      robots: { index: false, follow: true },
    });
  });
});
