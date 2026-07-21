import { describe, it, expect } from "vitest";
import { findDuplicatePairs } from "./duplicateInstitutions.mjs";

function bank(overrides) {
  return {
    id: "id",
    slug: "slug",
    name: "Name",
    // Deliberately NOT derived from `name` here, unlike the real
    // banks.name_normalized generated column — every test that cares about
    // same-name matching sets `name` itself; name_normalized is left as an
    // unrelated placeholder to prove the matching logic never reads it
    // (see the "aka_names divergence" describe block below for why).
    name_normalized: "unused-placeholder",
    address: null,
    website: null,
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
    const unlinked = bank({ id: "u1", slug: "old", name: "ABC Credit Union", phone: "555-1000", total_assets: 100 });
    const linked = bank({ id: "l1", slug: "new", name: "ABC Employees", phone: "555-1000", fdic_cert: 1, total_assets: 100 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(flagged).toEqual([]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].unlinked.id).toBe("u1");
    expect(confirmed[0].linked.id).toBe("l1");
  });

  it("flags multiple linked banks sharing the same phone number", () => {
    const unlinked = bank({ id: "u1", name: "Unlinked A", phone: "555-1000" });
    const linkedA = bank({ id: "l1", name: "Linked B", phone: "555-1000", fdic_cert: 1 });
    const linkedB = bank({ id: "l2", name: "Linked C", phone: "555-1000", ncua_charter_number: 2 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linkedA, linkedB]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/phone number/);
    expect(flagged[0].candidates).toHaveLength(2);
  });

  it("never treats a same-name phone match as a phone-pass candidate", () => {
    // Same name AND same phone — the phone pass explicitly excludes
    // same-name candidates, but the name pass (below) picks it up instead.
    // Matching assets given here so this actually confirms and can prove
    // routing, not corroboration (covered separately above).
    const unlinked = bank({ id: "u1", name: "Same Name Bank", phone: "555-1000", total_assets: 100 });
    const linked = bank({ id: "l1", name: "Same Name Bank", phone: "555-1000", fdic_cert: 1, total_assets: 100 });

    const { confirmed } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].unlinked.id).toBe("u1");
    expect(confirmed[0].linked.id).toBe("l1");
  });
});

describe("findDuplicatePairs — same-name pass", () => {
  it("confirms an unlinked bank with no phone against a single same-name linked bank with matching assets", () => {
    const unlinked = bank({ id: "u1", slug: "wells-fargo", name: "Wells Fargo Bank, National Association", total_assets: 1_852_239_000_000 });
    const linked = bank({ id: "l1", slug: "wells-fargo-na", name: "Wells Fargo Bank, National Association", fdic_cert: 3511, total_assets: 1_852_239_000_000 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(flagged).toEqual([]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].unlinked.id).toBe("u1");
    expect(confirmed[0].linked.id).toBe("l1");
  });

  it("flags a same-name match with no positive corroborator, even though nothing conflicts", () => {
    // A name match alone (both sides' address/website/assets absent or
    // simply not both present) is "nothing disagrees," not "something
    // agrees" — ADR-0006 explicitly rejects name-alone as identity, so this
    // must never silently confirm.
    const unlinked = bank({ id: "u1", name: "Same Name Bank", total_assets: null });
    const linked = bank({ id: "l1", name: "Same Name Bank", fdic_cert: 1, total_assets: 500 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/no corroborating signal/);
  });

  it("confirms when total_assets is null on both sides but website corroborates", () => {
    const unlinked = bank({ id: "u1", name: "Same Name Bank", website: "https://www.samenamebank.com", total_assets: null });
    const linked = bank({ id: "l1", name: "Same Name Bank", fdic_cert: 1, website: "https://samenamebank.com/", total_assets: null });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(flagged).toEqual([]);
    expect(confirmed).toHaveLength(1);
  });

  it("flags when websites conflict even though assets happen to match", () => {
    const unlinked = bank({ id: "u1", name: "Same Name Bank", website: "https://a.example.com", total_assets: 100 });
    const linked = bank({ id: "l1", name: "Same Name Bank", fdic_cert: 1, website: "https://b.example.com", total_assets: 100 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/website does not match/);
  });

  it("flags a same-name match whose assets conflict", () => {
    const unlinked = bank({ id: "u1", name: "Same Name Bank", total_assets: 100 });
    const linked = bank({ id: "l1", name: "Same Name Bank", fdic_cert: 1, total_assets: 200 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/total_assets does not match/);
  });

  it("always flags a name shared by two or more authoritative charters, regardless of assets", () => {
    const unlinked = bank({ id: "u1", name: "First Community Bank", total_assets: null });
    const linkedA = bank({ id: "l1", name: "First Community Bank", fdic_cert: 1, total_assets: 100 });
    const linkedB = bank({ id: "l2", name: "First Community Bank", fdic_cert: 2, total_assets: 200 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linkedA, linkedB]);

    expect(confirmed).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toMatch(/multiple authoritative charters/);
    expect(flagged[0].candidates).toHaveLength(2);
  });

  it("does not treat two unrelated banks as a name collision unless names actually match once normalized", () => {
    const unlinked = bank({ id: "u1", name: "Only Unlinked Bank" });
    const linked = bank({ id: "l1", name: "Something Else Entirely", fdic_cert: 1 });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toEqual([]);
  });

  it("matches on name alone regardless of punctuation/case differences (the same normalization the DB's name_normalized applies to `name`)", () => {
    const unlinked = bank({ id: "u1", name: "City Bank", total_assets: 100 });
    const linked = bank({ id: "l1", name: "city-bank", fdic_cert: 1, total_assets: 100 });

    const { confirmed } = findDuplicatePairs([unlinked, linked]);

    expect(confirmed).toHaveLength(1);
  });
});

describe("findDuplicatePairs — matches on `name` even when name_normalized diverges (aka_names)", () => {
  // banks.name_normalized is generated as normalize(name + ' ' + aka_names
  // joined), for fuzzy search — not identity. A linked bank with aliases
  // attached has a name_normalized value that no longer equals a plain
  // unlinked row's, even though both share the exact same `name`. Confirmed
  // in production: Bank of America and TD Bank both went undetected by an
  // earlier version of this pass that compared name_normalized directly.
  it("still confirms a same-name match when the linked side's name_normalized has aka_names baked in", () => {
    const unlinked = bank({
      id: "u1",
      name: "Bank of America, National Association",
      name_normalized: "bankofamericanationalassociation",
      total_assets: 2_672_192_000_000,
    });
    const linked = bank({
      id: "l1",
      name: "Bank of America, National Association",
      name_normalized: "bankofamericanationalassociationbankofamericabofabofamlmerrilllynch",
      fdic_cert: 3510,
      total_assets: 2_672_192_000_000,
    });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, linked]);

    expect(flagged).toEqual([]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].unlinked.id).toBe("u1");
    expect(confirmed[0].linked.id).toBe("l1");
  });
});

describe("findDuplicatePairs — excludes already-merged/inactive rows", () => {
  it("never re-confirms an unlinked row a prior run already marked merged (is_active: false)", () => {
    const alreadyMerged = bank({ id: "u1", name: "Merged Bank", phone: "555-1000", is_active: false });
    const linked = bank({ id: "l1", name: "Other Name", phone: "555-1000", fdic_cert: 1, is_active: true });

    const { confirmed, flagged } = findDuplicatePairs([alreadyMerged, linked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toEqual([]);
  });

  it("never treats an inactive linked bank as a valid merge target", () => {
    const unlinked = bank({ id: "u1", name: "Same Name Bank", is_active: true });
    const inactiveLinked = bank({ id: "l1", name: "Same Name Bank", fdic_cert: 1, is_active: false });

    const { confirmed, flagged } = findDuplicatePairs([unlinked, inactiveLinked]);

    expect(confirmed).toEqual([]);
    expect(flagged).toEqual([]);
  });
});
