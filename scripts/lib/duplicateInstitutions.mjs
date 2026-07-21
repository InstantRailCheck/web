// Shared between audit-duplicate-institutions.mjs (read-only) and
// apply-duplicate-merge.mjs (writes) so the two can never silently
// diverge on what counts as "confirmed" vs "flagged" — see the audit
// script's own header comment for why phone alone isn't sufficient and
// what corroboration is required.

export function isLinked(bank) {
  return !!(bank.fdic_cert || bank.ncua_charter_number);
}

// banks.name_normalized is generated as normalize(name + ' ' + aka_names
// joined) — built for fuzzy ILIKE search, not identity matching. A linked
// bank with aliases attached (e.g. "Bank of America, National Association"
// carrying aka_names ["BofA", "Merrill Lynch", ...]) gets a name_normalized
// value that no longer matches a plain unlinked row sharing its literal
// name — confirmed in production: Bank of America and TD Bank both went
// undetected by an earlier version of this same-name pass that compared
// name_normalized directly. Same-name identity must always be computed
// from `name` alone, matching the SQL side's own normalization
// (lower + strip non-alphanumeric) without the aka_names blob.
function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeWebsite(url) {
  if (!url) return null;
  return url.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "") || null;
}

// Code review finding (post-v8.14.5): this used to only check for
// CONTRADICTION (a mismatched address/assets) and treated its absence as
// proof of a match — two banks sharing a name with both sides' address and
// assets null were confirmed on "nothing disagrees," never on "something
// agrees." ADR-0006 explicitly rejects name/website alone as identity
// ("Rejected alternatives: Name or website as identity"), so a bare name or
// phone match (this function's only two callers) needs a genuine positive
// corroborator — a matching address, website, or total_assets — before
// being confirmed; absent that, it's flagged for a human instead, same
// "blank over wrong" rule already governing every other case here.
function evaluate(u, c) {
  const uWebsite = normalizeWebsite(u.website);
  const cWebsite = normalizeWebsite(c.website);

  const addressConflict = u.address && c.address && u.address !== c.address;
  const assetsConflict = u.total_assets != null && c.total_assets != null && u.total_assets !== c.total_assets;
  const websiteConflict = uWebsite && cWebsite && uWebsite !== cWebsite;

  const addressMatch = u.address && c.address && u.address === c.address;
  const assetsMatch = u.total_assets != null && c.total_assets != null && u.total_assets === c.total_assets;
  const websiteMatch = uWebsite && cWebsite && uWebsite === cWebsite;

  return {
    conflictReasons: [addressConflict && "address does not match", assetsConflict && "total_assets does not match", websiteConflict && "website does not match"].filter(Boolean),
    hasPositiveMatch: addressMatch || assetsMatch || websiteMatch,
  };
}

function toPair(u, c) {
  return {
    unlinked: { id: u.id, slug: u.slug, name: u.name, phone: u.phone, address: u.address, website: u.website, total_assets: u.total_assets, created_at: u.created_at },
    linked: { id: c.id, slug: c.slug, name: c.name, address: c.address, website: c.website, total_assets: c.total_assets, ncua_charter_number: c.ncua_charter_number, fdic_cert: c.fdic_cert, created_at: c.created_at },
  };
}

// Shared by both matching passes below: given a single unlinked bank and
// its list of same-key linked candidates, decide confirmed vs flagged and
// push onto the right array. `reasonForMultiple` is the flagged reason used
// only when more than one linked bank shares the same key — the two passes
// key on different things (phone vs name) so need different wording there.
function resolveCandidates(u, candidates, reasonForMultiple, confirmed, flagged) {
  if (candidates.length > 1) {
    flagged.push({
      reason: reasonForMultiple,
      unlinked: { id: u.id, slug: u.slug, name: u.name, phone: u.phone, address: u.address, website: u.website },
      candidates: candidates.map((c) => ({ id: c.id, slug: c.slug, name: c.name, address: c.address, website: c.website, ncua_charter_number: c.ncua_charter_number, fdic_cert: c.fdic_cert })),
    });
    return;
  }

  const c = candidates[0];
  const { conflictReasons, hasPositiveMatch } = evaluate(u, c);
  const pair = toPair(u, c);

  if (conflictReasons.length > 0) {
    flagged.push({ reason: conflictReasons.join("; "), ...pair });
  } else if (!hasPositiveMatch) {
    flagged.push({ reason: "no corroborating signal — address, website, and total_assets are all absent or unmatched", ...pair });
  } else {
    confirmed.push(pair);
  }
}

export function findDuplicatePairs(banks) {
  // Excludes already-merged/inactive rows from both sides: an inactive
  // "unlinked" row is already resolved (re-matching it just re-detects a
  // merge already applied in a prior run), and an inactive "linked" row is
  // never a valid merge target regardless.
  const activeBanks = banks.filter((b) => b.is_active);
  const linked = activeBanks.filter(isLinked);
  const confirmed = [];
  const flagged = [];
  const handledUnlinkedIds = new Set();

  // Pass 1: phone-number match, excluding same-name candidates (those are
  // the pre-sync reconciliation's job — see pass 2 for the rows it missed).
  const unlinkedWithPhone = activeBanks.filter((b) => !isLinked(b) && b.phone);
  const linkedByPhone = new Map();
  for (const b of linked) {
    if (!b.phone) continue;
    if (!linkedByPhone.has(b.phone)) linkedByPhone.set(b.phone, []);
    linkedByPhone.get(b.phone).push(b);
  }

  for (const u of unlinkedWithPhone) {
    const candidates = (linkedByPhone.get(u.phone) ?? []).filter((c) => normalizeName(c.name) !== normalizeName(u.name));
    if (candidates.length === 0) continue;
    handledUnlinkedIds.add(u.id);
    resolveCandidates(
      u,
      candidates,
      "multiple linked banks share this unlinked bank's phone number — cannot confirm which one, if any, is the real match",
      confirmed,
      flagged
    );
  }

  // Pass 2: same-normalized-name collision. Catches legacy rows with no
  // phone (invisible to pass 1) that also never resolved through the
  // earlier one-time audit-unlinked-banks.mjs reconciliation, since that
  // requires phone/website corroboration a bare name hit alone can't give.
  // A name match shared by 2+ authoritative charters is never confirmed —
  // there's no way to tell which charter (if any) the old row belongs to.
  const linkedByName = new Map();
  for (const b of linked) {
    const key = normalizeName(b.name);
    if (!linkedByName.has(key)) linkedByName.set(key, []);
    linkedByName.get(key).push(b);
  }

  const unlinkedRemaining = activeBanks.filter((b) => !isLinked(b) && !handledUnlinkedIds.has(b.id));
  for (const u of unlinkedRemaining) {
    const candidates = linkedByName.get(normalizeName(u.name)) ?? [];
    if (candidates.length === 0) continue;
    resolveCandidates(
      u,
      candidates,
      "name shared by multiple authoritative charters — cannot confirm which one, if any, is the real match",
      confirmed,
      flagged
    );
  }

  return { confirmed, flagged };
}
