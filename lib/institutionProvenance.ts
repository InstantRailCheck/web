// Provenance must be decided from the authoritative source fields, never
// from the institution's display name (a prior bug guessed FDIC vs NCUA by
// checking whether bank.name contained "credit union" - wrong for e.g.
// "Aneca", an NCUA-linked credit union whose name doesn't contain those
// words). source_authority is the single source of truth; the identifier
// fallback below exists only as defense-in-depth for a row that predates
// the sync (source_authority null) but still carries exactly one
// regulator identifier - banks_source_authority_identifier_check already
// makes source_authority null + either identifier set unreachable in
// practice, and having both identifiers set simultaneously is also blocked
// by that same constraint, but this function never trusts either
// possibility - it only returns a source when it's unambiguous.
export type SourceAuthority = "fdic" | "ncua" | null;

export function resolveProvenance(bank: {
  source_authority: SourceAuthority;
  fdic_cert: number | null;
  ncua_charter_number: number | null;
}): SourceAuthority {
  if (bank.source_authority === "fdic" || bank.source_authority === "ncua") {
    return bank.source_authority;
  }
  if (bank.fdic_cert !== null && bank.ncua_charter_number === null) return "fdic";
  if (bank.ncua_charter_number !== null && bank.fdic_cert === null) return "ncua";
  return null;
}

export function contactInfoSourceLabel(sourceAuthority: SourceAuthority): string | null {
  if (sourceAuthority === "ncua") return "NCUA's quarterly call report data";
  if (sourceAuthority === "fdic") return "FDIC BankFind";
  return null;
}
