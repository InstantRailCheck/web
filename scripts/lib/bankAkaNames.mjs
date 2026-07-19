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

// NCUA's own TradeNames.txt is submitted by each credit union's own staff
// with no independent verification of what an entry represents (NCUA's own
// guidance treats a trade name as a self-registered marketing alias, not an
// attestation of affiliation or a merger record) — confirmed live to
// contain at least one row (ANECA, charter 3212) listing "morgan stanley"
// and "jp morgan" with no discoverable relationship to either company.
// Blindly promoting every TradeNames entry into the public aka_names field
// (and from there into page text, metadata, and JSON-LD alternateName)
// risks publishing a false claim of affiliation with a real, unrelated,
// well-known institution.
//
// Never delete the raw data — ncua_credit_unions.search_names keeps every
// entry NCUA published, verbatim, for auditability. This only gates what's
// safe to promote into the PUBLIC banks.aka_names field.
//
// A candidate is unsafe to promote if either:
//  1. It names a distinct, well-known major bank/brokerage brand that this
//     institution's own name doesn't already reference (an "also known as
//     Morgan Stanley" claim implies affiliation the data can't support).
//  2. It shares no meaningful word with the institution's own name at all —
//     a genuine DBA/trade name is normally a shortened, abbreviated, or
//     rebranded form of the SAME name (e.g. "FNFCU" for "First Neshoba
//     Federal Credit Union"), so zero lexical relationship is itself a
//     signal something else is going on, even without a brand-name hit.
// Anything that doesn't clearly pass is suppressed by default — "blank
// over wrong" applied to the source data itself, not just to our own
// matching logic elsewhere in this project.
const MAJOR_FINANCIAL_BRAND_TERMS = [
  "jpmorgan", "jpmorganchase", "morganstanley", "chase", "wellsfargo", "bankofamerica",
  "citibank", "citigroup", "citi", "goldmansachs", "hsbc", "barclays", "capitalone",
  "usaa", "pncbank", "truist", "usbank", "regionsbank", "fifththird", "tdbank",
  "santander", "discoverbank", "americanexpress", "amex", "merrilllynch", "charlesschwab",
  "fidelity", "vanguard", "allyfinancial", "morgan", "stanley",
];

const GENERIC_INSTITUTION_WORDS = new Set([
  "federal", "credit", "union", "fcu", "cu", "employees", "employee", "inc",
  "incorporated", "association", "assn", "the", "of", "and", "no", "number",
  "corp", "corporation", "company", "co", "bank", "national", "na", "trust",
]);

function flatten(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function meaningfulTokens(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC_INSTITUTION_WORDS.has(w));
}

// Substring-based, not exact-match, so a compound token like "jpmorgan"
// still relates to a spaced-out alias token like "morgan" — real trade-name
// data routinely compounds or splits words differently than the primary
// name does.
function tokensRelated(aliasTokens, primaryTokens) {
  return aliasTokens.some((a) => primaryTokens.some((p) => a === p || a.includes(p) || p.includes(a)));
}

export function classifyAlias(primaryName, candidateAlias) {
  const flatAlias = flatten(candidateAlias);
  const flatPrimary = flatten(primaryName);
  const brandTerm = MAJOR_FINANCIAL_BRAND_TERMS.find((term) => flatAlias.includes(term));
  if (brandTerm && !flatPrimary.includes(brandTerm)) {
    return { safe: false, reason: `contains unrelated major-brand term "${brandTerm}"` };
  }

  // A genuine initialism of the primary name (e.g. "fnfcu" for "First
  // Neshoba Federal Credit Union") shares no literal substring with any of
  // the expanded words it stands for — the token-overlap check below can
  // never accept it on its own, so it needs its own check, reusing the
  // same initials computation deriveDomainInitialsAka already trusts
  // elsewhere in this file. A short (<2-letter) match is too likely to be
  // coincidental to rely on here.
  const initials = computeNameInitials(primaryName);
  if (initials.length >= 2 && flatAlias === initials) {
    return { safe: true, reason: "matches the primary name's own initials" };
  }

  const primaryTokens = meaningfulTokens(primaryName);
  const aliasTokens = meaningfulTokens(candidateAlias);
  if (aliasTokens.length === 0) {
    return primaryTokens.length === 0
      ? { safe: true, reason: "no meaningful tokens on either side" }
      : { safe: false, reason: "alias has no meaningful words to relate to the primary name" };
  }
  if (tokensRelated(aliasTokens, primaryTokens)) {
    return { safe: true, reason: "shares a meaningful word with the primary name" };
  }
  return { safe: false, reason: "no lexical relationship to the primary name" };
}

export function isSafePublicAlias(primaryName, candidateAlias) {
  return classifyAlias(primaryName, candidateAlias).safe;
}

// ncua_credit_unions.search_names already includes the credit union's own
// primary name (lowercased) alongside any real trade names from NCUA's
// TradeNames.txt — strip it out so aka_names only ever holds genuine
// alternates, never a redundant copy of the name already on the page. Also
// filters through classifyAlias/isSafePublicAlias above so an unverifiable
// or brand-colliding TradeNames entry never reaches the public field —
// deterministic and idempotent, so a future sync recomputing this never
// restores something already suppressed.
export function computeAkaNamesFromSearchNames(primaryName, searchNames) {
  const primaryLower = primaryName.toLowerCase().trim();
  const akaNames = (searchNames ?? [])
    .filter((n) => n.toLowerCase().trim() !== primaryLower)
    .filter((n) => isSafePublicAlias(primaryName, n));
  return akaNames.length > 0 ? akaNames : null;
}

// Combines an official-source aka list (NCUA/FDIC, refreshed each sync)
// with the domain-derived acronym (re-verified fresh each time against the
// bank's current name/website, not just carried over) - overwriting
// aka_names with only the freshly-recomputed official list, as the NCUA
// sync's refresh step originally did, would silently erase a domain-derived
// acronym on every run, since NCUA's own data never contained it to begin
// with (confirmed live for FNFCU/OTPFCU/ASCU).
export function mergeAkaNames(officialAka, domainAka) {
  const base = officialAka ?? [];
  if (!domainAka) return base.length > 0 ? base : null;
  const alreadyPresent = base.some((n) => n.toLowerCase() === domainAka.toLowerCase());
  const merged = alreadyPresent ? base : [...base, domainAka];
  return merged.length > 0 ? merged : null;
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

// Neither NCUA's nor FDIC's official trade-name data covers informal
// acronyms/initialisms (confirmed live: fnfcu/otpfcu/ascu aren't in
// NCUA's TradeNames.txt for those charters, even though each institution's
// own domain spells out its initials exactly). This isn't a guess, though
// — it only ever returns something when the institution's OWN chosen
// domain exactly matches the initials mechanically derived from its own
// name. A coincidental partial resemblance never qualifies; only an exact
// match on the whole domain label does.
const AKA_INITIALS_STOPWORDS = new Set(["and", "of", "the", "for", "at", "in", "&"]);
// Below this length, a coincidental exact match becomes plausible (e.g. a
// two-letter domain matching two-letter initials by chance) - every real
// case found so far is 4+ letters, so this costs nothing to require.
const MIN_INITIALS_LENGTH = 4;

function computeNameInitials(name) {
  const words = name.replace(/[.,'"]/g, "").split(/[\s-]+/).filter(Boolean);
  const letters = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (AKA_INITIALS_STOPWORDS.has(lower)) continue;
    const firstAlpha = lower.match(/[a-z]/);
    if (firstAlpha) letters.push(firstAlpha[0]);
  }
  return letters.join("");
}

function extractDomainLabel(website) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function deriveDomainInitialsAka(name, website) {
  const initials = computeNameInitials(name);
  if (initials.length < MIN_INITIALS_LENGTH) return null;
  const domainLabel = extractDomainLabel(website);
  if (domainLabel && domainLabel === initials) return initials.toUpperCase();
  return null;
}
