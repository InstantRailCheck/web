// Relative import, not the "@/" alias — this file is imported directly by
// scripts/sync-institution-directory.mjs via Node's native TypeScript
// stripping, which can't resolve Next.js's path alias (see
// lib/railParticipationMatch.ts for the same constraint).
import { institutionSlug } from "./institutionSlug.ts";

// v8.0 §6/§7/§9 — pure logic shared by scripts/sync-institution-directory.mjs.
// Everything that genuinely needs transactional atomicity against
// concurrent writes (matching an existing bank, insert/update/reactivate,
// inactivation, the base_snapshot_hash drift check) already lives in
// finalize_sync_run (SQL) — this module only covers what has to happen
// BEFORE any row in `banks` is touched: turning a raw source fetch into
// staging rows (dedup, slug assignment) and deciding whether a run is even
// safe to stage in the first place (§7's guards).

export type SourceAuthority = "fdic" | "ncua";

export interface SourceInstitution {
  sourceAuthority: SourceAuthority;
  identifier: number | null | undefined;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  totalAssets: number | null;
  akaNames: string[] | null;
}

// A bank already linked to a given (sourceAuthority, identifier) — used
// only to decide when a slug must be RESERVED (never recomputed) rather
// than assigned fresh. finalize_sync_run itself never writes `slug` on an
// UPDATE/reactivate path; proposed_slug is only ever consumed on INSERT.
export interface ExistingLinkedBank {
  sourceAuthority: SourceAuthority;
  identifier: number;
  slug: string;
}

export type RejectReason = "duplicate_identifier_in_source" | "missing_identifier" | "slug_collision";

export interface StagingRow {
  source_authority: SourceAuthority;
  source_identifier: number | null;
  status: "valid" | "rejected";
  reject_reason: RejectReason | null;
  name: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  total_assets: number | null;
  aka_names: string[] | null;
  proposed_slug: string | null;
}

function keyFor(sourceAuthority: SourceAuthority, identifier: number) {
  return `${sourceAuthority}:${identifier}`;
}

// Builds one staging row per fetched record. `usedSlugs` must be seeded
// with EVERY existing bank's slug (linked or not) and is mutated in place
// as fresh slugs are assigned — later records in the same batch must never
// collide with an earlier record's freshly assigned slug, any more than
// with a pre-existing one.
export function buildStagingRows(
  records: SourceInstitution[],
  existingLinked: ExistingLinkedBank[],
  usedSlugs: Set<string>
): StagingRow[] {
  const linkedByKey = new Map<string, ExistingLinkedBank>();
  for (const b of existingLinked) linkedByKey.set(keyFor(b.sourceAuthority, b.identifier), b);

  const groups = new Map<string, SourceInstitution[]>();
  const missingIdentifier: SourceInstitution[] = [];
  for (const record of records) {
    if (record.identifier === null || record.identifier === undefined || !Number.isFinite(record.identifier)) {
      missingIdentifier.push(record);
      continue;
    }
    const key = keyFor(record.sourceAuthority, record.identifier);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const rows: StagingRow[] = [];

  for (const record of missingIdentifier) {
    rows.push(rejectedRow(record, null, "missing_identifier"));
  }

  for (const group of groups.values()) {
    if (group.length > 1) {
      // Every occurrence rejected, not just the later ones — keeping
      // whichever arrived first in fetch order would arbitrarily privilege
      // one of two conflicting official records for no principled reason.
      for (const record of group) {
        rows.push(rejectedRow(record, record.identifier as number, "duplicate_identifier_in_source"));
      }
      continue;
    }

    const record = group[0];
    const identifier = record.identifier as number;
    const existing = linkedByKey.get(keyFor(record.sourceAuthority, identifier));
    const proposedSlug = existing ? existing.slug : institutionSlug(record.name, record.state, identifier, usedSlugs);
    if (!existing) usedSlugs.add(proposedSlug);

    rows.push({
      source_authority: record.sourceAuthority,
      source_identifier: identifier,
      status: "valid",
      reject_reason: null,
      name: record.name,
      city: record.city,
      state: record.state,
      website: record.website,
      phone: record.phone,
      address: record.address,
      total_assets: record.totalAssets,
      aka_names: record.akaNames,
      proposed_slug: proposedSlug,
    });
  }

  return rows;
}

function rejectedRow(record: SourceInstitution, identifier: number | null, reason: RejectReason): StagingRow {
  return {
    source_authority: record.sourceAuthority,
    source_identifier: identifier,
    status: "rejected",
    reject_reason: reason,
    name: record.name,
    city: record.city,
    state: record.state,
    website: record.website,
    phone: record.phone,
    address: record.address,
    total_assets: record.totalAssets,
    aka_names: record.akaNames,
    proposed_slug: null,
  };
}

// --- §7 guards -------------------------------------------------------

export interface GuardResult {
  passed: boolean;
  reason: string | null;
  message: string;
}

// Fatal — the source fetch itself must exactly match what the source
// reports it has, or a silently truncated/paginated-wrong fetch could
// stage an incomplete world and finalize_sync_run would inactivate every
// bank that happened to be missing.
export function checkExactCountGuard(source: SourceAuthority, collectedCount: number, sourceReportedTotal: number): GuardResult {
  if (collectedCount === sourceReportedTotal) {
    return { passed: true, reason: null, message: `${source}: collected ${collectedCount} matches source-reported total` };
  }
  return {
    passed: false,
    reason: "exact_count_mismatch",
    message: `${source}: collected ${collectedCount} does not match source-reported total ${sourceReportedTotal}`,
  };
}

// Fatal — a reject rate this high almost always means a parsing/field-
// mapping bug, not a genuine one-off day of bad source data.
export function checkRejectRateGuard(
  source: SourceAuthority,
  collectedCount: number,
  rejectedCount: number,
  maxRate = 0.01
): GuardResult {
  const rate = collectedCount === 0 ? 0 : rejectedCount / collectedCount;
  if (rate <= maxRate) {
    return { passed: true, reason: null, message: `${source}: reject rate ${(rate * 100).toFixed(2)}% is within the ${(maxRate * 100).toFixed(0)}% limit` };
  }
  return {
    passed: false,
    reason: "reject_rate_exceeded",
    message: `${source}: reject rate ${(rate * 100).toFixed(2)}% exceeds the ${(maxRate * 100).toFixed(0)}% limit (${rejectedCount}/${collectedCount})`,
  };
}

// Fatal — relative to the last successful run for this source. Skipped
// (never fails) on a source's genuine first-ever run, which the caller
// signals with previousAppliedCount === null; that bootstrap case must be
// reported explicitly rather than silently treated as a pass with no
// comment, so a human can tell "no comparison was possible" apart from
// "the comparison passed."
export function checkRetentionGuard(
  source: SourceAuthority,
  collectedCount: number,
  previousAppliedCount: number | null,
  minRatio = 0.97
): GuardResult {
  if (previousAppliedCount === null) {
    return { passed: true, reason: null, message: `${source}: no prior applied run — retention check skipped (first-run bootstrap)` };
  }
  const ratio = previousAppliedCount === 0 ? 1 : collectedCount / previousAppliedCount;
  if (ratio >= minRatio) {
    return { passed: true, reason: null, message: `${source}: collected ${collectedCount} is ${(ratio * 100).toFixed(1)}% of the last applied run's ${previousAppliedCount}` };
  }
  return {
    passed: false,
    reason: "retention_threshold_not_met",
    message: `${source}: collected ${collectedCount} is only ${(ratio * 100).toFixed(1)}% of the last applied run's ${previousAppliedCount} (minimum ${(minRatio * 100).toFixed(0)}%)`,
  };
}

// Non-fatal — an unusually large inactivation batch is worth a human's
// explicit attention, but not an automatic hard stop the way the guards
// above are. Exceeding either the absolute or the relative cap requires
// --allow-large-inactivation on apply; it never blocks staging itself.
export interface InactivationCapResult {
  exceeded: boolean;
  message: string;
}

export function checkInactivationCap(
  source: SourceAuthority,
  wouldInactivateCount: number,
  activeInScopeCount: number,
  absoluteCap = 50,
  relativeCap = 0.02
): InactivationCapResult {
  const relativeThreshold = Math.ceil(activeInScopeCount * relativeCap);
  const cap = Math.max(absoluteCap, relativeThreshold);
  if (wouldInactivateCount <= cap) {
    return { exceeded: false, message: `${source}: ${wouldInactivateCount} would be inactivated, within the cap of ${cap}` };
  }
  return {
    exceeded: true,
    message: `${source}: ${wouldInactivateCount} would be inactivated, exceeding the cap of ${cap} (absolute ${absoluteCap} / relative ${(relativeCap * 100).toFixed(0)}% of ${activeInScopeCount} active)`,
  };
}
