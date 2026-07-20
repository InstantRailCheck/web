// Shared between audit-duplicate-institutions.mjs (read-only) and
// apply-duplicate-merge.mjs (writes) so the two can never silently
// diverge on what counts as "confirmed" vs "flagged" — see the audit
// script's own header comment for why phone alone isn't sufficient and
// what corroboration is required.

export function isLinked(bank) {
  return !!(bank.fdic_cert || bank.ncua_charter_number);
}

function conflictsWith(u, c) {
  const addressConflict = u.address && c.address && u.address !== c.address;
  const assetsConflict = u.total_assets != null && c.total_assets != null && u.total_assets !== c.total_assets;
  return { addressConflict, assetsConflict };
}

function toPair(u, c) {
  return {
    unlinked: { id: u.id, slug: u.slug, name: u.name, phone: u.phone, address: u.address, total_assets: u.total_assets, created_at: u.created_at },
    linked: { id: c.id, slug: c.slug, name: c.name, address: c.address, total_assets: c.total_assets, ncua_charter_number: c.ncua_charter_number, fdic_cert: c.fdic_cert, created_at: c.created_at },
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
      unlinked: { id: u.id, slug: u.slug, name: u.name, phone: u.phone, address: u.address },
      candidates: candidates.map((c) => ({ id: c.id, slug: c.slug, name: c.name, address: c.address, ncua_charter_number: c.ncua_charter_number, fdic_cert: c.fdic_cert })),
    });
    return;
  }

  const c = candidates[0];
  const { addressConflict, assetsConflict } = conflictsWith(u, c);
  const pair = toPair(u, c);

  if (addressConflict || assetsConflict) {
    flagged.push({
      reason: [addressConflict && "address does not match", assetsConflict && "total_assets does not match"].filter(Boolean).join("; "),
      ...pair,
    });
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
    const candidates = (linkedByPhone.get(u.phone) ?? []).filter((c) => c.name_normalized !== u.name_normalized);
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
    if (!linkedByName.has(b.name_normalized)) linkedByName.set(b.name_normalized, []);
    linkedByName.get(b.name_normalized).push(b);
  }

  const unlinkedRemaining = activeBanks.filter((b) => !isLinked(b) && !handledUnlinkedIds.has(b.id));
  for (const u of unlinkedRemaining) {
    const candidates = linkedByName.get(u.name_normalized) ?? [];
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
