// Shared between audit-duplicate-institutions.mjs (read-only) and
// apply-duplicate-merge.mjs (writes) so the two can never silently
// diverge on what counts as "confirmed" vs "flagged" — see the audit
// script's own header comment for why phone alone isn't sufficient and
// what corroboration is required.

export function isLinked(bank) {
  return !!(bank.fdic_cert || bank.ncua_charter_number);
}

export function findDuplicatePairs(banks) {
  const unlinked = banks.filter((b) => !isLinked(b) && b.phone);
  const linked = banks.filter(isLinked);

  const linkedByPhone = new Map();
  for (const b of linked) {
    if (!b.phone) continue;
    if (!linkedByPhone.has(b.phone)) linkedByPhone.set(b.phone, []);
    linkedByPhone.get(b.phone).push(b);
  }

  const confirmed = [];
  const flagged = [];

  for (const u of unlinked) {
    const candidates = (linkedByPhone.get(u.phone) ?? []).filter((c) => c.name_normalized !== u.name_normalized);
    if (candidates.length === 0) continue;

    if (candidates.length > 1) {
      flagged.push({
        reason: "multiple linked banks share this unlinked bank's phone number — cannot confirm which one, if any, is the real match",
        unlinked: { id: u.id, slug: u.slug, name: u.name, phone: u.phone, address: u.address },
        candidates: candidates.map((c) => ({ id: c.id, slug: c.slug, name: c.name, address: c.address, ncua_charter_number: c.ncua_charter_number, fdic_cert: c.fdic_cert })),
      });
      continue;
    }

    const c = candidates[0];
    const addressConflict = u.address && c.address && u.address !== c.address;
    const assetsConflict = u.total_assets != null && c.total_assets != null && u.total_assets !== c.total_assets;

    const pair = {
      unlinked: { id: u.id, slug: u.slug, name: u.name, phone: u.phone, address: u.address, total_assets: u.total_assets, created_at: u.created_at },
      linked: { id: c.id, slug: c.slug, name: c.name, address: c.address, total_assets: c.total_assets, ncua_charter_number: c.ncua_charter_number, fdic_cert: c.fdic_cert, created_at: c.created_at },
    };

    if (addressConflict || assetsConflict) {
      flagged.push({
        reason: [addressConflict && "address does not match", assetsConflict && "total_assets does not match"].filter(Boolean).join("; "),
        ...pair,
      });
    } else {
      confirmed.push(pair);
    }
  }

  return { confirmed, flagged };
}
