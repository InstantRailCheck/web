// Shared duplicate-safe rail-participation matcher (v8.0 §1), replacing
// four copy-pasted versions of the same word-truncation matching logic
// (lib/railParticipation.ts, scripts/backfill-rail-participation.mjs, and
// the now-retired scripts/import-fdic-banks.mjs/import-ncua-credit-unions.mjs).
//
// A name match alone was always ambiguous the moment two banks share a
// name — before duplicate names were permitted this was moot (name
// uniquely identified a bank), but now a single matching participant-list
// name would independently set the flag on EVERY duplicate-name bank,
// regardless of which specific charter actually participates. Location
// only resolves that ambiguity if it's also unique within the bank's own
// duplicate-name group — two same-state Pinnacle Bank charters checked
// against RTP's state-only data still can't be told apart by state alone.

export type MatchResult = "matched" | "ambiguous" | "no_match";

export type BankLocation = {
  city: string | null;
  state: string | null;
};

export type RailCandidate = {
  searchName: string;
  city?: string | null;
  state?: string | null;
};

// Which location field(s) a given rail's participant list actually carries
// — FedNow has city+state, RTP has state only, Zelle has neither.
export type LocationFields = "city_state" | "state" | "none";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same word-truncation + whole-word-boundary + uniqueness-of-1 matching as
// the original per-table implementations — unchanged semantics, just
// operating on an in-memory candidate list so callers can choose either a
// per-lookup DB query (lib/railParticipation.ts) or a single bulk
// prefetch (scripts/backfill-rail-participation.mjs).
function findNameMatches(name: string, candidates: RailCandidate[]): RailCandidate[] {
  const words = name.replace(/[.,]/g, "").trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidateName = words.slice(0, i).join(" ").toLowerCase().trim();

    const exact = candidates.filter((c) => c.searchName === candidateName);
    if (exact.length > 0) return exact;

    if (i === words.length) {
      const boundary = new RegExp(`\\b${escapeRegex(candidateName)}\\b`, "i");
      const partial = candidates.filter((c) => boundary.test(c.searchName));
      const distinctNames = new Set(partial.map((c) => c.searchName));
      if (distinctNames.size === 1) return partial;
    }
  }

  return [];
}

function locationsEqual(a: BankLocation, b: RailCandidate, fields: LocationFields): boolean {
  if (fields === "none") return false;
  if (!a.city && !a.state) return false;
  if (fields === "city_state") {
    return !!a.city && !!a.state && !!b.city && !!b.state && sameText(a.city, b.city) && sameText(a.state, b.state);
  }
  return !!a.state && !!b.state && sameText(a.state, b.state);
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function locationKey(loc: BankLocation, fields: LocationFields): string | null {
  if (fields === "none") return null;
  if (fields === "city_state") {
    if (!loc.city || !loc.state) return null;
    return `${loc.city.trim().toLowerCase()}|${loc.state.trim().toLowerCase()}`;
  }
  if (!loc.state) return null;
  return loc.state.trim().toLowerCase();
}

// Is this bank's own location distinct from every sibling sharing its
// normalized name? Only meaningful for a duplicate-name group
// (siblingLocations.length > 1) — a single-bank "group" trivially passes,
// but that case never reaches this function (see matchInstitution).
function isLocationUniqueWithinGroup(
  bank: BankLocation,
  siblingLocations: BankLocation[],
  fields: LocationFields
): boolean {
  const key = locationKey(bank, fields);
  if (key === null) return false;
  const matchingSiblings = siblingLocations.filter((s) => locationKey(s, fields) === key);
  return matchingSiblings.length === 1;
}

export function matchInstitution(
  bank: { name: string } & BankLocation,
  siblingLocations: BankLocation[],
  candidates: RailCandidate[],
  locationFields: LocationFields
): MatchResult {
  const nameMatches = findNameMatches(bank.name, candidates);

  // Not a duplicate-name group — existing (pre-v8.0) behavior: a name
  // match resolving to exactly one candidate is accepted outright,
  // location is irrelevant.
  if (siblingLocations.length <= 1) {
    return nameMatches.length > 0 ? "matched" : "no_match";
  }

  // Zelle (locationFields === "none") can never disambiguate a
  // duplicate-name group — always ambiguous, regardless of what the
  // participant list says.
  if (locationFields === "none") {
    return nameMatches.length > 0 ? "ambiguous" : "no_match";
  }

  // A location match can't be safely attributed to one specific charter
  // among co-located siblings, even with a clean name hit.
  if (!isLocationUniqueWithinGroup(bank, siblingLocations, locationFields)) {
    return nameMatches.length > 0 ? "ambiguous" : "no_match";
  }

  if (nameMatches.length === 0) return "no_match";

  // A name-matched candidate is only accepted if its location data is
  // present and equals this bank's own — every entry that survives this
  // filter shares that exact location by construction, so there's no
  // further distinctness check needed here. Absent or mismatched location
  // data on every name-matched candidate is ambiguous, not a match.
  const withLocation = nameMatches.filter((c) => locationsEqual(bank, c, locationFields));
  return withLocation.length > 0 ? "matched" : "ambiguous";
}

// Turns a MatchResult into the flag value that should actually be written
// — pulled out of scripts/backfill-rail-participation.mjs so it's directly
// unit-testable (its previous inline form, `current || result === "matched"`,
// silently coerced a genuinely-unknown null into a confident false the
// moment a result was merely "ambiguous", asserting non-participation the
// matcher never actually confirmed; that bug went unnoticed for lack of a
// test exactly like the ones below). "ambiguous" must leave whatever is
// already there untouched — null stays null, an existing false or true is
// preserved exactly, not just "not downgraded from true."
export function resolveRailFlag(current: boolean | null, result: MatchResult): boolean | null {
  if (current === true) return true;
  if (result === "matched") return true;
  if (result === "ambiguous") return current;
  return false;
}
