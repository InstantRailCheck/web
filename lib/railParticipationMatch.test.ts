import { describe, it, expect } from "vitest";
import { matchInstitution } from "./railParticipationMatch";

describe("matchInstitution", () => {
  it("matches a non-duplicate bank on name alone, location irrelevant", () => {
    const bank = { name: "First National Bank", city: null, state: null };
    const result = matchInstitution(bank, [bank], [{ searchName: "first national bank" }], "city_state");
    expect(result).toBe("matched");
  });

  it("returns no_match for a non-duplicate bank with no name hit", () => {
    const bank = { name: "First National Bank", city: null, state: null };
    const result = matchInstitution(bank, [bank], [{ searchName: "some other bank" }], "city_state");
    expect(result).toBe("no_match");
  });

  it("matches within a duplicate-name group when the bank's location is unique in the group and the candidate's location agrees", () => {
    const bank = { name: "Pinnacle Bank", city: "Nashville", state: "TN" };
    const siblings = [
      bank,
      { name: "Pinnacle Bank", city: "Elberton", state: "GA" },
      { name: "Pinnacle Bank", city: "Los Angeles", state: "CA" },
    ];
    const candidates = [{ searchName: "pinnacle bank", city: "Nashville", state: "TN" }];
    expect(matchInstitution(bank, siblings, candidates, "city_state")).toBe("matched");
  });

  it("is ambiguous within a duplicate-name group when the bank's location is not unique in the group, even with a clean name hit", () => {
    // Two Pinnacle Bank charters both in TN — state alone (RTP's only
    // location field) can't tell them apart, so RTP data can never
    // resolve this group regardless of what the participant list says.
    const bank = { name: "Pinnacle Bank", city: "Nashville", state: "TN" };
    const siblings = [
      bank,
      { name: "Pinnacle Bank", city: "Memphis", state: "TN" },
    ];
    const candidates = [{ searchName: "pinnacle bank", state: "TN" }];
    expect(matchInstitution(bank, siblings, candidates, "state")).toBe("ambiguous");
  });

  it("is always ambiguous for a duplicate-name group on Zelle (no location fields at all)", () => {
    const bank = { name: "Pinnacle Bank", city: "Nashville", state: "TN" };
    const siblings = [bank, { name: "Pinnacle Bank", city: "Elberton", state: "GA" }];
    const candidates = [{ searchName: "pinnacle bank" }];
    expect(matchInstitution(bank, siblings, candidates, "none")).toBe("ambiguous");
  });

  it("returns no_match (not ambiguous) for a duplicate-name group with no name hit at all", () => {
    const bank = { name: "Pinnacle Bank", city: "Nashville", state: "TN" };
    const siblings = [bank, { name: "Pinnacle Bank", city: "Elberton", state: "GA" }];
    const candidates = [{ searchName: "unrelated bank", city: "Nashville", state: "TN" }];
    expect(matchInstitution(bank, siblings, candidates, "city_state")).toBe("no_match");
  });

  it("is ambiguous when the bank's location is unique in the group but the candidate's location is absent or mismatched", () => {
    const bank = { name: "Pinnacle Bank", city: "Nashville", state: "TN" };
    const siblings = [bank, { name: "Pinnacle Bank", city: "Elberton", state: "GA" }];
    const mismatched = [{ searchName: "pinnacle bank", city: "Elberton", state: "GA" }];
    expect(matchInstitution(bank, siblings, mismatched, "city_state")).toBe("ambiguous");

    const noLocation = [{ searchName: "pinnacle bank" }];
    expect(matchInstitution(bank, siblings, noLocation, "city_state")).toBe("ambiguous");
  });

  it("matches on the entry for this bank's own location even when the pool also has unrelated entries for other locations", () => {
    const bank = { name: "Pinnacle Bank", city: "Nashville", state: "TN" };
    const siblings = [bank, { name: "Pinnacle Bank", city: "Elberton", state: "GA" }];
    const candidates = [
      { searchName: "pinnacle bank", city: "Nashville", state: "TN" },
      { searchName: "pinnacle bank", city: "Springfield", state: "IL" },
    ];
    expect(matchInstitution(bank, siblings, candidates, "city_state")).toBe("matched");
  });
});
