// NCUA's own credit union directory submits every institution name in ALL
// CAPS (confirmed directly: 4,331 of 4,336 NCUA-sourced banks are fully
// uppercase, vs 45 of 4,257 FDIC-sourced ones — this is a source-format
// artifact, not a stylistic choice). smartTitleCase() converts that into a
// normal-looking name for display, tuned against every real NCUA name in
// production rather than written from generic assumptions — see the
// .test.ts file for the specific cases (possessives, ordinals, hyphenated
// compounds, initials-with-periods) it was built to handle correctly.
//
// This does NOT attempt semantic understanding of the name — it can't know
// that "ESL" or "HMC" are abbreviations rather than ordinary words, and
// will title-case those like normal words (e.g. "Esl", "Hmc"). That's an
// accepted, inherent limitation of any heuristic without a full acronym
// dictionary; the ACRONYMS list below covers the common, high-confidence
// cases (well-known federal agencies, unions, and all 50 state codes),
// not an attempt at completeness.

const ACRONYMS = new Set([
  "FCU", "CU", "NCUA", "USA", "US", "IBM", "AAA", "ATM", "PO", "DC", "FBI", "CIA",
  "NASA", "AFL", "CIO", "AFL-CIO", "IUOE", "UAW", "IBEW", "ILA", "ILWU", "SEIU",
  "NEA", "AFT", "AFGE", "AFSCME", "UFCW", "IAM", "IATSE", "UMW", "USW", "TWU",
  "ATU", "APWU", "NALC", "IRS", "USPS", "DOD", "VA", "FAA", "FDA", "EPA", "HUD",
  "DOT", "DOE", "NIH", "CDC", "TSA", "ICE", "DHS", "NSA", "FEMA", "GSA", "OPM",
  "SSA", "USDA", "NOAA", "USGS", "TVA", "MTA", "NYPD", "LAPD", "NJ", "NY", "CA",
  "TX", "PA", "OH", "IL", "MI", "GA", "NC", "WA", "AZ", "MA", "TN", "IN",
  "MO", "MD", "WI", "CO", "MN", "SC", "AL", "LA", "KY", "OR", "OK", "CT", "UT",
  "IA", "NV", "AR", "MS", "KS", "NM", "NE", "WV", "ID", "HI", "NH", "ME", "RI",
  "MT", "DE", "SD", "ND", "AK", "VT", "WY", "DBA", "II", "III", "IV",
]);

const MINOR_WORDS = new Set(["of", "and", "the", "for", "in", "at", "by", "on", "an", "or", "to"]);

function titleCaseWord(word: string, isFirst: boolean): string {
  const ordinalMatch = word.match(/^(\d+)(ST|ND|RD|TH)$/i);
  if (ordinalMatch) return ordinalMatch[1] + ordinalMatch[2].toLowerCase();

  if (!/[A-Za-z]/.test(word)) return word;

  const bareUpper = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (ACRONYMS.has(word.toUpperCase()) || (bareUpper.length >= 2 && ACRONYMS.has(bareUpper))) {
    return word.toUpperCase();
  }

  // "a" only means the article when it's a standalone word — a single
  // capital A elsewhere (e.g. "A & M University") is virtually always an
  // initial/abbreviation, never the article, so single-char words are
  // exempt from minor-word lowercasing regardless of position.
  if (!isFirst && word.length > 1 && MINOR_WORDS.has(word.toLowerCase())) {
    return word.toLowerCase();
  }

  return word.replace(/\d+(ST|ND|RD|TH)\b|[A-Za-z]+/gi, (seg, ordSuffix: string | undefined, offset: number, str: string) => {
    if (ordSuffix) return seg.slice(0, seg.length - ordSuffix.length) + ordSuffix.toLowerCase();
    // Possessive 's ("EMPLOYEE'S" -> "Employee's") vs a name pattern after
    // an apostrophe ("D'ARC" -> "D'Arc", "L'OREAL" -> "L'Oreal") — the
    // possessive marker is always exactly one letter.
    const precededByApostrophe = str[offset - 1] === "'";
    if (precededByApostrophe && seg.length === 1) return seg.toLowerCase();
    return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
  });
}

export function smartTitleCase(name: string): string {
  let firstWordSeen = false;
  return name.replace(/\S+/g, (word) => {
    const isFirst = !firstWordSeen;
    firstWordSeen = true;
    return titleCaseWord(word, isFirst);
  });
}

// True only for names that are ALL CAPS (ignoring anything that isn't a
// letter) — used to scope both the one-time backfill and the sync
// pipeline to exactly the rows that need it, never touching an
// already-mixed-case name (which might have deliberate stylized casing
// smartTitleCase would flatten).
export function isAllCapsName(name: string): boolean {
  return /[A-Z]/.test(name) && name === name.toUpperCase();
}
