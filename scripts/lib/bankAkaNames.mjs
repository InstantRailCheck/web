export function normalizeWebsite(url) {
  if (!url) return null;
  const trimmed = url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
  return trimmed || null;
}

// ncua_credit_unions.search_names already includes the credit union's own
// primary name (lowercased) alongside any real trade names from NCUA's
// TradeNames.txt — strip it out so aka_names only ever holds genuine
// alternates, never a redundant copy of the name already on the page.
export function computeAkaNamesFromSearchNames(primaryName, searchNames) {
  const primaryLower = primaryName.toLowerCase().trim();
  const akaNames = (searchNames ?? []).filter((n) => n.toLowerCase().trim() !== primaryLower);
  return akaNames.length > 0 ? akaNames : null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// FDIC's `search=` parameter is a loose relevance search, not an exact
// match - e.g. querying "City National Bank" returns Citibank ranked above
// the actual City National Bank purely because Citibank has more assets.
// Blindly taking the highest-asset candidate (the previously-existing
// pattern in backfill-bank-info.mjs) trusts whatever the fuzzy search
// happened to rank first, regardless of whether it's actually the same
// institution. Only trust a candidate whose own NAME contains the search
// term as a whole-word match, and only when exactly one distinct
// institution qualifies - the same word-boundary + uniqueness rule this
// codebase already applies to rail-participation matching.
export function pickFdicMatch(candidates, searchTerm) {
  const boundary = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`, "i");
  const matching = candidates.filter((c) => boundary.test(c.NAME));
  const distinctCerts = new Set(matching.map((c) => c.CERT));
  return distinctCerts.size === 1 ? matching[0] : null;
}

const FDIC_TRADE_NAME_FIELD_COUNT = 10;

// Occasional FDIC data-entry quirk: a small number of institutions have a
// URL sitting in what's normally a trade-name slot (confirmed live -
// Commerce Bank's TE01N529 is literally "www.finemarkbank.com", not a
// name) - live-verified against FDIC's own record, not a guess. A URL
// isn't an alternate name a person would search for, so exclude it rather
// than display "Also known as www.example.com" on the page.
const URL_LIKE_PATTERN = /^(https?:\/\/|www\.)|\.(com|org|net|bank)(\/|$)/i;

// FDIC's institutions API exposes up to 10 trade-name slots as TE01N529
// through TE10N529 (each paired with a TE0{n}N528 website field this doesn't
// need) - most banks have none populated; only multi-brand ones like large
// national banks typically do.
export function extractFdicAkaNames(record, primaryName) {
  const primaryLower = primaryName.toLowerCase().trim();
  const names = [];
  for (let i = 1; i <= FDIC_TRADE_NAME_FIELD_COUNT; i++) {
    const field = `TE${String(i).padStart(2, "0")}N529`;
    const raw = record[field];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (URL_LIKE_PATTERN.test(trimmed)) continue;
    if (trimmed && trimmed.toLowerCase() !== primaryLower) names.push(trimmed);
  }
  return Array.from(new Set(names));
}
