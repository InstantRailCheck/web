// Shared by scripts/audit-unlinked-banks.mjs (read-only) and
// scripts/apply-reconciliation.mjs (writes, after its own live re-check).
// Both must compute candidates/corroboration/the snapshot hash identically
// — the apply script's whole drift-detection guarantee depends on hashing
// the same way the audit did, so this logic exists in exactly one place.
import { createHash } from "node:crypto";

export function normalizeForSearch(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeWebsite(url) {
  if (!url) return null;
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
}

// NCUA data is already fully synced locally (ncua_credit_unions) — no live
// fetch needed, unlike FDIC below.
export async function findNcuaCandidates(supabase, bankName) {
  const normalized = normalizeForSearch(bankName);
  if (!normalized) return [];

  const { data: exact, error: exactError } = await supabase
    .from("ncua_credit_unions")
    .select("charter_number, name, website, phone")
    .contains("search_names", [bankName.toLowerCase().trim()]);
  if (exactError) throw exactError;
  if (exact && exact.length > 0) {
    return exact.map((r) => ({ sourceAuthority: "ncua", identifier: r.charter_number, name: r.name, website: r.website, phone: r.phone }));
  }

  const { data: partial, error: partialError } = await supabase
    .from("ncua_credit_unions")
    .select("charter_number, name, website, phone")
    .ilike("name", `%${bankName.trim()}%`)
    .limit(10);
  if (partialError) throw partialError;
  return (partial ?? []).map((r) => ({ sourceAuthority: "ncua", identifier: r.charter_number, name: r.name, website: r.website, phone: r.phone }));
}

// No persistent local table of every FDIC institution exists (only the
// top-N-by-asset one-off import), so this queries FDIC's live API — same
// progressively-shorter-prefix strategy as lib/fdicLookup.ts, kept
// self-contained here rather than imported (that file pulls in
// lib/externalFetch.ts via the "@/" path alias, which plain `node
// scripts/*.mjs` can't resolve without a bundler).
async function fetchFdicRaw(params) {
  const url = `https://api.fdic.gov/banks/institutions?${params}&fields=NAME,WEBADDR,CERT&limit=5`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? []).map((d) => d.data);
  } catch {
    return [];
  }
}

function toFdicCandidate(r) {
  return {
    sourceAuthority: "fdic",
    identifier: r.CERT,
    name: r.NAME,
    website: r.WEBADDR ? (r.WEBADDR.startsWith("http") ? r.WEBADDR : `https://${r.WEBADDR}`) : null,
    phone: null, // FDIC's institutions endpoint doesn't carry phone
  };
}

export async function findFdicCandidates(bankName) {
  const words = bankName.trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidateName = words.slice(0, i).join(" ");
    const search = `search=${encodeURIComponent(`NAME:${candidateName.includes(" ") ? `"${candidateName}"` : candidateName}`)}&filters=ACTIVE:1`;
    const results = await fetchFdicRaw(search);
    if (results.length > 0) return results.map(toFdicCandidate);
  }
  return [];
}

export function isCorroborated(bank, candidate) {
  const bankWebsite = normalizeWebsite(bank.website);
  const bankPhone = normalizePhone(bank.phone);
  const candidateWebsite = normalizeWebsite(candidate.website);
  const candidatePhone = normalizePhone(candidate.phone);

  if (bankWebsite && candidateWebsite && bankWebsite === candidateWebsite) return true;
  if (bankPhone && candidatePhone && bankPhone === candidatePhone) return true;
  return false;
}

export function snapshotHash(bank, candidates) {
  const canonical = JSON.stringify({
    bankId: bank.id,
    bankWebsite: normalizeWebsite(bank.website),
    bankPhone: normalizePhone(bank.phone),
    candidates: candidates
      .map((c) => ({ sourceAuthority: c.sourceAuthority, identifier: c.identifier, name: c.name, website: c.website, phone: c.phone }))
      .sort((a, b) => `${a.sourceAuthority}${a.identifier}`.localeCompare(`${b.sourceAuthority}${b.identifier}`)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
