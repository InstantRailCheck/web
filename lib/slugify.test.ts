import { describe, expect, it } from "vitest";
import { uniqueSlug } from "./slugify";

describe("uniqueSlug", () => {
  it("returns the base slug unchanged when it isn't already used", () => {
    expect(uniqueSlug("chase", new Set())).toBe("chase");
    expect(uniqueSlug("chase", new Set(["wells-fargo"]))).toBe("chase");
  });

  it("appends -2 when the base slug is already used", () => {
    expect(uniqueSlug("chase", new Set(["chase"]))).toBe("chase-2");
  });

  it("keeps incrementing the suffix past collisions", () => {
    expect(uniqueSlug("chase", new Set(["chase", "chase-2", "chase-3"]))).toBe("chase-4");
  });

  it("finds the first free suffix even when a later one is also taken", () => {
    expect(uniqueSlug("chase", new Set(["chase", "chase-3"]))).toBe("chase-2");
  });
});
