import { describe, it, expect } from "vitest";
import { findDuplicatePairs } from "./duplicateInstitutions.mjs";

function bank(overrides) {
  return {
    id: "id",
    slug: "slug",
    name: "Name",
    name_normalized: "name",
    address: null,
    phone: null,
    fdic_cert: null,
    ncua_charter_number: null,
    total_assets: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("findDuplicatePairs — phone-based pass (unchanged)", () => {
  it("confirms a single phone match with non-conflicting assets", () => {
    const unlinked = bank({ id: "u1", slug: "old", name_normalized: "abccu", phone: "555-1000", total_assets: 100 });
    const linked = bank({ id: "l1", slug: "new", name_normalized: "abcemployees", phone: "555-1000", fdic_cert: 1, total_assets: 100 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(flagged).toEqual([]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].unlinked.id).toBe("u1");
    expect(confirmed[0].linked.id).toBe("l1");
  });

  it("flags multiple linked banks sharing the same phone number", () => {
    const unlinked = bank({ id: "u1", name_normalized: "a", phone: "555-1000" });
    const linkedA = bank({ id: "l1", name_normalized: "b", phone: "555-1000", fdic_cert: 1 });
    const linkedB = bank({ id: "l2", name_normalized: "c", phone: "555-1000", ncua_charter_number: 2 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linkedA, linkedB]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/phone number/);
    expect(flagged[0].candidates).toHaveLength(2);
  });

  it("never treats a same-normalized-name phone match as a phone-pass candidate", () => {
    // Same name AND same phone — the phone pass explicitly excludes
    // same-name candidates, but the name pass (below) picks it up instead.
    const unlinked = bank({ id: "u1", name_normalized: "samename", phone: "555-1000" });
    const linked = bank({ id: "l1", name_normalized: "samename", phone: "555-1000", fdic_cert: 1 });

    const { confirmed } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].unlinked.id).toBe("u1");
    expect(confirmed[0].linked.id).toBe("l1");
  });
});

describe("findDuplicatePairs — same-name pass (new)", () => {
  it("confirms an unlinked bank with no phone against a single same-name linked bank with matching assets", () => {
    const unlinked = bank({ id: "u1", slug: "wells-fargo", name_normalized: "wellsfargo", total_assets: 1_852_239_000_000 });
    const linked = bank({ id: "l1", slug: "wells-fargo-na", name_normalized: "wellsfargo", fdic_cert: 3511, total_assets: 1_852_239_000_000 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(flagged).toEqual([]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].unlinked.id).toBe("u1");
    expect(confirmed[0].linked.id).toBe("l1");
  });

  it("still confirms when one side's total_assets is null (no conflict asserted)", () => {
    const unlinked = bank({ id: "u1", name_normalized: "samename", total_assets: null });
    const linked = bank({ id: "l1", name_normalized: "samename", fdic_cert: 1, total_assets: 500 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(flagged).toEqual([]);
    expect(confirmed).toHaveLength(1);
  });

  it("flags a same-name match whose assets conflict", () => {
    const unlinked = bank({ id: "u1", name_normalized: "samename", total_assets: 100 });
    const linked = bank({ id: "l1", name_normalized: "samename", fdic_cert: 1, total_assets: 200 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/total_assets does not match/);
  });

  it("always flags a name shared by two or more authoritative charters, regardless of assets", () => {
    const unlinked = bank({ id: "u1", name_normalized: "firstcommunitybank", total_assets: null });
    const linkedA = bank({ id: "l1", name_normalized: "firstcommunitybank", fdic_cert: 1, total_assets: 100 });
    const linkedB = bank({ id: "l2", name_normalized: "firstcommunitybank", fdic_cert: 2, total_assets: 200 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linkedA, linkedB]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/multiple authoritative charters/);
    expect(flagged[0].candidates).toHaveLength(2);
  });

  it("does not treat two unrelated linked banks under different authorities as a name collision unless normalized names actually match", () => {
    const unlinked = bank({ id: "u1", name_normalized: "onlyunlinked" });
    const linked = bank({ id: "l1", name_normalized: "somethingelse", fdic_cert: 1 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toEqual([]);
  });
});

describe("findDuplicatePairs — excludes already-merged/inactive rows", () => {
  it("never re-confirms an unlinked row a prior run already marked merged (is_active: false)", () => {
    const alreadyMerged = bank({ id: "u1", name_normalized: "samename", phone: "555-1000", is_active: false });
    const linked = bank({ id: "l1", name_normalized: "othername", phone: "555-1000", fdic_cert: 1, is_active: true });

    const { confirmed, flagged } = findDuplicatePairs([alreadyMerged, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toEqual([]);
  });

  it("never treats an inactive linked bank as a valid merge target", () => {
    const unlinked = bank({ id: "u1", name_normalized: "samename", is_active: true });
    const inactiveLinked = bank({ id: "l1", name_normalized: "samename", fdic_cert: 1, is_active: false });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, inactiveLinked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toEqual([]);
  });
});
