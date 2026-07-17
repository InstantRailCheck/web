import { describe, it, expect } from "vitest";
import { bankIsIndexable, type BankForIndexability } from "./institutionIndexability";

function bank(overrides: Partial<BankForIndexability> = {}): BankForIndexability {
  return {
    is_active: true,
    website: null,
    total_assets: null,
    fednow_participant: null,
    rtp_participant: null,
    zelle_participant: null,
    aka_names: null,
    ...overrides,
  };
}

describe("bankIsIndexable", () => {
  it("is never indexable when inactive, regardless of content", () => {
    const b = bank({ is_active: false, website: "https://example.com", total_assets: 1000 });
    expect(bankIsIndexable(b, true)).toBe(false);
  });

  it("is not indexable with zero content signals", () => {
    expect(bankIsIndexable(bank(), false)).toBe(false);
  });

  it("is not indexable with exactly one content signal", () => {
    expect(bankIsIndexable(bank({ website: "https://example.com" }), false)).toBe(false);
  });

  it("is indexable with exactly two content signals: website + total_assets", () => {
    expect(bankIsIndexable(bank({ website: "https://example.com", total_assets: 5000 }), false)).toBe(true);
  });

  it("is indexable with a rail-participant flag + aka_names", () => {
    expect(bankIsIndexable(bank({ fednow_participant: true, aka_names: ["Old Name"] }), false)).toBe(true);
  });

  it("is indexable with a website + an attributable community report", () => {
    expect(bankIsIndexable(bank({ website: "https://example.com" }), true)).toBe(true);
  });

  it("an attributable report alone is only one signal, not enough by itself", () => {
    expect(bankIsIndexable(bank(), true)).toBe(false);
  });

  it("any single true rail flag counts as one signal, not one per rail", () => {
    const allThreeRails = bank({ fednow_participant: true, rtp_participant: true, zelle_participant: true });
    expect(bankIsIndexable(allThreeRails, false)).toBe(false); // still only 1 signal total
    expect(bankIsIndexable({ ...allThreeRails, total_assets: 1000 }, false)).toBe(true); // now 2
  });
});
