import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { generateMetadata } = await import("./page");

describe("/banks generateMetadata", () => {
  it("/banks is indexable with canonical /banks", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(result).toEqual({ alternates: { canonical: "https://www.instantrailcheck.com/banks" } });
  });

  it("/banks?page=1 canonicalizes to /banks", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ page: "1" }) });
    expect(result).toEqual({ alternates: { canonical: "https://www.instantrailcheck.com/banks" } });
  });

  it("/banks?page=2 self-canonicalizes and stays indexable", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ page: "2" }) });
    expect(result).toEqual({ alternates: { canonical: "https://www.instantrailcheck.com/banks?page=2" } });
  });

  it("/banks?q=chase emits noindex,follow", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ q: "chase" }) });
    expect(result.robots).toEqual({ index: false, follow: true });
  });

  it("/banks?fednow=true emits noindex,follow", async () => {
    const result = await generateMetadata({ searchParams: Promise.resolve({ fednow: "true" }) });
    expect(result.robots).toEqual({ index: false, follow: true });
  });
});
