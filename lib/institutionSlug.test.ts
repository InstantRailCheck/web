import { describe, it, expect } from "vitest";
import { institutionSlug } from "./institutionSlug";

describe("institutionSlug", () => {
  it("returns the bare slug when there's no collision", () => {
    expect(institutionSlug("Pinnacle Bank", "TN", 12345, new Set())).toBe("pinnacle-bank");
  });

  it("appends -{state}-{identifier} on a collision when state is known", () => {
    const used = new Set(["pinnacle-bank"]);
    expect(institutionSlug("Pinnacle Bank", "TN", 12345, used)).toBe("pinnacle-bank-tn-12345");
  });

  it("appends -{identifier} on a collision when state is unknown", () => {
    const used = new Set(["pinnacle-bank"]);
    expect(institutionSlug("Pinnacle Bank", null, 12345, used)).toBe("pinnacle-bank-12345");
  });

  it("falls back to uniqueSlug's numeric suffix when even the state+identifier slug collides", () => {
    const used = new Set(["pinnacle-bank", "pinnacle-bank-tn-12345"]);
    expect(institutionSlug("Pinnacle Bank", "TN", 12345, used)).toBe("pinnacle-bank-2");
  });

  it("never recomputes an existing slug the same identifier already owns — every call is independent, deterministic given the same inputs", () => {
    const used = new Set<string>();
    const first = institutionSlug("Pinnacle Bank", "TN", 111, used);
    used.add(first);
    const second = institutionSlug("Pinnacle Bank", "GA", 222, used);
    used.add(second);
    expect(first).toBe("pinnacle-bank");
    expect(second).toBe("pinnacle-bank-ga-222");
    expect(first).not.toBe(second);
  });
});
