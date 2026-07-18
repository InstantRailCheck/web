import { describe, it, expect } from "vitest";
import {
  buildStagingRows,
  checkExactCountGuard,
  checkRejectRateGuard,
  checkRetentionGuard,
  checkInactivationCap,
  type SourceInstitution,
  type ExistingLinkedBank,
} from "./institutionSync";

function record(overrides: Partial<SourceInstitution> = {}): SourceInstitution {
  return {
    sourceAuthority: "fdic",
    identifier: 100,
    name: "Test Bank",
    city: "Springfield",
    state: "IL",
    website: null,
    phone: null,
    address: null,
    totalAssets: null,
    akaNames: null,
    ...overrides,
  };
}

describe("buildStagingRows", () => {
  it("stages a unique valid record as valid with a computed slug", () => {
    const rows = buildStagingRows([record({ identifier: 1, name: "Pinnacle Bank", state: "TN" })], [], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("valid");
    expect(rows[0].proposed_slug).toBe("pinnacle-bank");
  });

  it("rejects EVERY occurrence of a duplicate identifier within one fetch, not just the later ones", () => {
    const rows = buildStagingRows(
      [
        record({ identifier: 5, name: "First Record" }),
        record({ identifier: 5, name: "Second Record" }),
      ],
      [],
      new Set()
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "rejected")).toBe(true);
    expect(rows.every((r) => r.reject_reason === "duplicate_identifier_in_source")).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(["First Record", "Second Record"]);
  });

  it("rejects a record with a missing identifier", () => {
    const rows = buildStagingRows([record({ identifier: null })], [], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("rejected");
    expect(rows[0].reject_reason).toBe("missing_identifier");
    expect(rows[0].source_identifier).toBeNull();
  });

  it("never recomputes the slug of an already-linked bank — reuses its existing slug untouched", () => {
    const existingLinked: ExistingLinkedBank[] = [{ sourceAuthority: "fdic", identifier: 42, slug: "some-old-slug-42" }];
    const rows = buildStagingRows([record({ identifier: 42, name: "Renamed Bank" })], existingLinked, new Set(["some-old-slug-42"]));
    expect(rows[0].proposed_slug).toBe("some-old-slug-42");
  });

  it("assigns distinct, deterministic slugs to two new same-name institutions in the same batch", () => {
    const usedSlugs = new Set<string>();
    const rows = buildStagingRows(
      [
        record({ identifier: 1, name: "Pinnacle Bank", state: "TN" }),
        record({ identifier: 2, name: "Pinnacle Bank", state: "GA" }),
      ],
      [],
      usedSlugs
    );
    expect(rows[0].proposed_slug).toBe("pinnacle-bank");
    expect(rows[1].proposed_slug).toBe("pinnacle-bank-ga-2");
    expect(rows[0].proposed_slug).not.toBe(rows[1].proposed_slug);
  });

  it("never lets a new institution's slug collide with a pre-existing bank's slug (linked or not)", () => {
    const usedSlugs = new Set(["pinnacle-bank"]); // some other, unrelated existing bank already owns this
    const rows = buildStagingRows([record({ identifier: 9, name: "Pinnacle Bank", state: "TN" })], [], usedSlugs);
    expect(rows[0].proposed_slug).toBe("pinnacle-bank-tn-9");
  });

  it("a duplicate-identifier group is never mistaken for a fresh slug assignment", () => {
    const usedSlugs = new Set<string>();
    const rows = buildStagingRows(
      [record({ identifier: 7, name: "A" }), record({ identifier: 7, name: "B" })],
      [],
      usedSlugs
    );
    expect(rows.every((r) => r.proposed_slug === null)).toBe(true);
    expect(usedSlugs.size).toBe(0);
  });
});

describe("checkExactCountGuard", () => {
  it("passes when collected matches the source-reported total", () => {
    expect(checkExactCountGuard("fdic", 4262, 4262).passed).toBe(true);
  });

  it("fails on any mismatch, over or under", () => {
    expect(checkExactCountGuard("fdic", 4260, 4262).passed).toBe(false);
    expect(checkExactCountGuard("fdic", 4264, 4262).passed).toBe(false);
    expect(checkExactCountGuard("fdic", 4260, 4262).reason).toBe("exact_count_mismatch");
  });
});

describe("checkRejectRateGuard", () => {
  it("passes at or under 1%", () => {
    expect(checkRejectRateGuard("fdic", 1000, 10).passed).toBe(true);
    expect(checkRejectRateGuard("fdic", 100, 1).passed).toBe(true);
  });

  it("fails over 1%", () => {
    const result = checkRejectRateGuard("fdic", 100, 2);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("reject_rate_exceeded");
  });

  it("never divides by zero when nothing was collected", () => {
    expect(checkRejectRateGuard("fdic", 0, 0).passed).toBe(true);
  });
});

describe("checkRetentionGuard", () => {
  it("skips (passes, with a bootstrap note) when there's no prior applied run", () => {
    const result = checkRetentionGuard("ncua", 500, null);
    expect(result.passed).toBe(true);
    expect(result.message).toMatch(/bootstrap/i);
  });

  it("passes at exactly the 97% threshold", () => {
    expect(checkRetentionGuard("fdic", 970, 1000).passed).toBe(true);
  });

  it("fails just under the 97% threshold", () => {
    const result = checkRetentionGuard("fdic", 969, 1000);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("retention_threshold_not_met");
  });
});

describe("checkInactivationCap", () => {
  it("does not exceed when under both the absolute and relative caps", () => {
    expect(checkInactivationCap("fdic", 10, 4000).exceeded).toBe(false);
  });

  it("exceeds when over the absolute cap even though the relative cap would allow more", () => {
    // 2% of 10,000 is 200, so the relative cap alone would allow 51 — the
    // absolute cap of 50 must still be respected as a floor-level trigger
    // only when it's the LARGER of the two, so use a small population here
    // where the absolute cap (50) is actually the binding constraint.
    expect(checkInactivationCap("fdic", 51, 1000).exceeded).toBe(true);
  });

  it("the relative cap can only ever be MORE generous than the absolute floor, never less — a small population always falls back to the absolute cap of 50", () => {
    // 2% of 100 is 2, well under the absolute cap of 50 — the effective
    // cap here is still 50 (the larger of the two), so 30 does not exceed.
    expect(checkInactivationCap("fdic", 30, 100).exceeded).toBe(false);
  });

  it("uses whichever cap is larger, not whichever is smaller", () => {
    // Large population: 2% of 10,000 = 200, larger than the absolute cap
    // of 50 — 100 inactivations should NOT exceed here.
    expect(checkInactivationCap("fdic", 100, 10000).exceeded).toBe(false);
  });
});
