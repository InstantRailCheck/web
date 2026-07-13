import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { generateMetadata } = await import("./page");

describe("/routes/needs-fresh-reports generateMetadata", () => {
  it("is noindex,follow with the bare canonical for page 1 (default)", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(result).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports" },
      robots: { index: false, follow: true },
    });
  });

  it("self-canonicalizes page 2+ while staying noindex,follow", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ page: "2" }) });
    expect(result).toEqual({
      alternates: { canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports?page=2" },
      robots: { index: false, follow: true },
    });
  });

  it("normalizes an invalid page param (decimal) to page 1's canonical", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ page: "2.5" }) });
    expect(result.alternates).toEqual({ canonical: "https://www.instantrailcheck.com/routes/needs-fresh-reports" });
  });
});
