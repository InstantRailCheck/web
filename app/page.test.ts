import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { metadata } = await import("./page");

describe("Home page canonical", () => {
  it("has an explicit canonical URL for the homepage", () => {
    expect(metadata.alternates).toEqual({ canonical: "https://www.instantrailcheck.com/" });
  });

  it("is a static export, so route-query variants like ?from=chase&to=sofi resolve the same canonical", () => {
    // metadata is a plain object, not generateMetadata — it can't vary per
    // request, so every route-query variant inherits this exact value.
    expect(metadata).not.toBeInstanceOf(Function);
  });
});
