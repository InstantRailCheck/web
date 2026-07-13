import { describe, it, expect } from "vitest";
import { buildBankSitemapEntries } from "./sitemapEntries";

describe("buildBankSitemapEntries", () => {
  it("prefers updated_at over created_at when both are present", () => {
    const [entry] = buildBankSitemapEntries([
      { slug: "acme-bank", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-07-12T23:56:00.000Z" },
    ]);
    expect(entry.lastModified).toBe("2026-07-12T23:56:00.000Z");
  });

  it("falls back to created_at when updated_at is null", () => {
    const [entry] = buildBankSitemapEntries([
      { slug: "acme-bank", created_at: "2026-01-01T00:00:00.000Z", updated_at: null },
    ]);
    expect(entry.lastModified).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is undefined when both timestamps are null", () => {
    const [entry] = buildBankSitemapEntries([{ slug: "acme-bank", created_at: null, updated_at: null }]);
    expect(entry.lastModified).toBeUndefined();
  });

  it("includes every bank's URL, in order, none dropped", () => {
    const banks = [
      { slug: "bank-a", created_at: "2026-01-01T00:00:00.000Z", updated_at: null },
      { slug: "bank-b", created_at: "2026-01-02T00:00:00.000Z", updated_at: "2026-01-03T00:00:00.000Z" },
      { slug: "bank-c", created_at: null, updated_at: null },
    ];
    const entries = buildBankSitemapEntries(banks);
    expect(entries.map((e) => e.url)).toEqual([
      "https://www.instantrailcheck.com/banks/bank-a",
      "https://www.instantrailcheck.com/banks/bank-b",
      "https://www.instantrailcheck.com/banks/bank-c",
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(buildBankSitemapEntries([])).toEqual([]);
  });
});
