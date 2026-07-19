import { describe, it, expect } from "vitest";
import { resolveProvenance, contactInfoSourceLabel } from "./institutionProvenance";

describe("resolveProvenance", () => {
  it("trusts source_authority directly for an NCUA institution whose name doesn't contain 'credit union' (the real Aneca bug)", () => {
    expect(resolveProvenance({ source_authority: "ncua", fdic_cert: null, ncua_charter_number: 3212 })).toBe("ncua");
  });

  it("trusts source_authority directly for an FDIC institution whose name happens to contain 'credit union'", () => {
    expect(resolveProvenance({ source_authority: "fdic", fdic_cert: 12345, ncua_charter_number: null })).toBe("fdic");
  });

  it("falls back to the identifier when source_authority is null but exactly one identifier is set", () => {
    expect(resolveProvenance({ source_authority: null, fdic_cert: 999, ncua_charter_number: null })).toBe("fdic");
    expect(resolveProvenance({ source_authority: null, fdic_cert: null, ncua_charter_number: 999 })).toBe("ncua");
  });

  it("returns null for a fully unlinked institution", () => {
    expect(resolveProvenance({ source_authority: null, fdic_cert: null, ncua_charter_number: null })).toBeNull();
  });

  it("returns null rather than guessing when both identifiers are set (a contradictory state the DB constraint should prevent)", () => {
    expect(resolveProvenance({ source_authority: null, fdic_cert: 1, ncua_charter_number: 2 })).toBeNull();
  });
});

describe("contactInfoSourceLabel", () => {
  it("labels ncua provenance", () => {
    expect(contactInfoSourceLabel("ncua")).toBe("NCUA's quarterly call report data");
  });

  it("labels fdic provenance", () => {
    expect(contactInfoSourceLabel("fdic")).toBe("FDIC BankFind");
  });

  it("returns null for unknown provenance rather than a guessed label", () => {
    expect(contactInfoSourceLabel(null)).toBeNull();
  });
});
