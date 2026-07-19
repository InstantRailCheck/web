// v8.0 §6/§7/§9/§13 — the real ongoing FDIC/NCUA institution-directory
// sync, replacing the retired one-off import-fdic-banks.mjs/
// import-ncua-credit-unions.mjs. Every write to `banks` happens inside
// finalize_sync_run (one atomic transaction, see
// supabase/migrations/20260716004000_add_finalize_sync_run.sql) — this
// script only ever fetches source data, stages it, runs the §7 guards, and
// (in --apply mode) drives the run's state machine. It never writes to
// `banks` directly.
//
// Two entry points:
//   node scripts/sync-institution-directory.mjs --source {fdic|both}
//     Fetches + stages a new run. Never touches `banks`. Ends in
//     status='staged' (ready for review) or 'guard_blocked' (a fatal §7
//     guard tripped — the only remedy is a fresh run, never this one).
//
//   node scripts/sync-institution-directory.mjs --apply --run-id <uuid> [--allow-large-inactivation]
//     Applies a specific, already-reviewed 'staged' run. Requires
//     --allow-large-inactivation when that run's requires_override_reason
//     is set — checked client-side before ever calling the RPC, which
//     enforces the same gate server-side regardless.
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStagingRows,
  checkExactCountGuard,
  checkRejectRateGuard,
  checkRetentionGuard,
  checkInactivationCap,
} from "../lib/institutionSync.ts";
import {
  normalizeWebsite,
  extractFdicAkaNames,
  deriveDomainInitialsAka,
  mergeAkaNames,
  computeAkaNamesFromSearchNames,
  isValidWebsiteDomain,
  repairDoubledProtocol,
  repairFdicWebsite,
} from "./lib/bankAkaNames.mjs";
import { smartTitleCase, isAllCapsName } from "../lib/institutionNameCase.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const runIdIndex = argv.indexOf("--run-id");
  const runId = runIdIndex !== -1 ? argv[runIdIndex + 1] : null;
  const allowLargeInactivation = argv.includes("--allow-large-inactivation");
  const sourceIndex = argv.indexOf("--source");
  const source = sourceIndex !== -1 ? argv[sourceIndex + 1] : null;
  return { apply, runId, allowLargeInactivation, source };
}

// Mirrors the CLI's own atomic compare-and-set transitions used throughout
// this project (see apply-reconciliation.mjs, the db-tests) — WHERE
// status = <expected>, and zero rows affected is a real conflict, never
// treated as success.
async function transition(runId, from, to, extra = {}) {
  const { data, error } = await supabase
    .from("sync_runs")
    .update({ status: to, ...extra })
    .eq("id", runId)
    .eq("status", from)
    .select("id");
  if (error) throw error;
  return data.length === 1;
}

const FDIC_TRADE_NAME_FIELD_COUNT = 10;
const FDIC_TRADE_NAME_FIELDS = Array.from({ length: FDIC_TRADE_NAME_FIELD_COUNT }, (_, i) => `TE${String(i + 1).padStart(2, "0")}N529`).join(",");
const FDIC_FIELDS = `NAME,CERT,WEBADDR,ADDRESS,CITY,STALP,ZIP,ASSET,${FDIC_TRADE_NAME_FIELDS}`;

// Paginated, explicit sort_by/sort_order — without a stable sort, FDIC's API
// pagination order isn't guaranteed consistent between requests, silently
// dropping institutions between offset pages (verified live in
// backfill-bank-assets.mjs's history). Returns both the raw rows and the
// API's own reported total, so the caller can run the exact-count guard
// against a number this script never computed itself.
async function fetchAllFdicInstitutions() {
  const pageSize = 1000;
  const rows = [];
  let sourceTotal = null;
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(
      `https://api.fdic.gov/banks/institutions?filters=ACTIVE:1&fields=${FDIC_FIELDS}&sort_by=CERT&sort_order=ASC&limit=${pageSize}&offset=${offset}`
    );
    if (!res.ok) throw new Error(`FDIC fetch failed: ${res.status}`);
    const json = await res.json();
    if (sourceTotal === null) sourceTotal = json.meta?.total ?? null;
    const page = (json.data ?? []).map((d) => d.data);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows, sourceTotal };
}

function fdicRecordToSourceInstitution(row) {
  // FDIC's own WEBADDR field has occasional data-entry mistakes -
  // repairFdicWebsite mechanically recovers what it safely can (two
  // websites crammed into one field, a stray leading/trailing/doubled
  // period) without guessing; isValidWebsiteDomain (inside repairFdicWebsite)
  // suppresses what's left (a colon/comma typo, "n/a") rather than
  // publishing a dead link.
  const rawWebsite = row.WEBADDR ? normalizeWebsite(row.WEBADDR.startsWith("http") ? row.WEBADDR : `https://${row.WEBADDR}`) : null;
  const website = repairFdicWebsite(rawWebsite);
  const officialAka = extractFdicAkaNames(row, row.NAME);
  const domainAka = deriveDomainInitialsAka(row.NAME, website);
  const akaNames = mergeAkaNames(officialAka, domainAka);
  return {
    sourceAuthority: "fdic",
    identifier: typeof row.CERT === "number" ? row.CERT : Number(row.CERT),
    name: row.NAME,
    city: row.CITY || null,
    state: row.STALP || null,
    website,
    phone: null, // FDIC's institutions endpoint doesn't carry phone
    address: [row.ADDRESS, row.CITY, row.STALP, row.ZIP].filter(Boolean).join(", ") || null,
    // FDIC's ASSET field is reported in thousands of dollars.
    totalAssets: typeof row.ASSET === "number" && row.ASSET > 0 ? Math.round(row.ASSET * 1000) : null,
    akaNames,
  };
}

async function fetchLatestNcuaSyncLog() {
  const { data, error } = await supabase
    .from("ncua_reference_sync_log")
    .select("id, foicu_row_count")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchNcuaCandidates(latestLogId) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("ncua_credit_unions")
      .select("charter_number, name, website, address, phone, city, state, total_assets, search_names")
      .eq("last_seen_sync_id", latestLogId)
      .order("charter_number", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

function ncuaRecordToSourceInstitution(row) {
  return {
    sourceAuthority: "ncua",
    identifier: row.charter_number,
    // NCUA's own CU_NAME field is submitted in ALL CAPS as a data
    // convention, not a stylistic choice (see lib/institutionNameCase.ts)
    // — title-cased here, at the point this becomes banks.name, rather
    // than in sync-ncua-directory.mjs, so ncua_credit_unions stays a
    // faithful raw mirror of NCUA's own file.
    name: isAllCapsName(row.name) ? smartTitleCase(row.name) : row.name,
    city: row.city,
    state: row.state,
    // NCUA's own FS220D website field is fixed-width and truncates long
    // domains mid-word (confirmed live: charter 3391/Richland) -
    // repairDoubledProtocol fixes a separate, genuinely mechanical bug
    // (sync-ncua-directory.mjs used to double-prefix a handful of values,
    // fixed alongside this) and otherwise changes nothing; isValidWebsiteDomain
    // then rejects whatever's still truncated rather than promoting a dead
    // link into the public banks.website field.
    website: isValidWebsiteDomain(repairDoubledProtocol(row.website)) ? repairDoubledProtocol(row.website) : null,
    phone: row.phone,
    address: row.address,
    totalAssets: row.total_assets,
    akaNames: computeAkaNamesFromSearchNames(row.name, row.search_names ?? []),
  };
}

// Full field set, not just id/slug/identifiers — a real reviewable diff
// needs the CURRENT value of every field finalize_sync_run can change, so
// the report can show before/after per field rather than just labeling
// every matched row "update" with no way to tell what actually changes.
async function fetchAllBanksInScope() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, slug, name, city, state, website, phone, address, total_assets, aka_names, source_authority, fdic_cert, ncua_charter_number, is_active, inactive_reason, sync_protected_fields")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function computeBaseHash(sourceScope) {
  const { data, error } = await supabase.rpc("compute_banks_base_snapshot_hash", { p_source_scope: sourceScope });
  if (error) throw error;
  return data;
}

// Unconditional — every bank's id+slug, not scoped to source_authority.
// fetchAllBanksInScope reads and reserves slugs (usedSlugs) against EVERY
// bank, linked or not, in or out of this run's own scope — so
// base_snapshot_hash alone (scoped to linked banks in-scope) can't catch a
// slug-affecting write to an unlinked or out-of-scope bank during the
// paginated read. A real collision would still be caught by the database's
// own UNIQUE constraint at apply time, but this catches the drift itself,
// up front, rather than only tolerating its worst-case symptom.
async function computeAllSlugsHash() {
  const { data, error } = await supabase.rpc("compute_all_bank_slugs_hash", {});
  if (error) throw error;
  return data;
}

// Fields finalize_sync_run can actually change on an existing bank —
// mirrors its own jsonb-equality comparison as closely as JS reasonably
// can, so the report's "would this row actually change anything" preview
// agrees with what apply time will really do. A field named in the bank's
// own sync_protected_fields (set by a manually-verified correction, e.g.
// Richland Credit Union's website) is never actually overwritten by
// finalize_sync_run — skipped here too, so the review report doesn't cry
// wolf about a change that isn't really going to happen.
const DIFF_FIELDS = ["name", "city", "state", "website", "phone", "address", "total_assets", "aka_names"];
function computeChangedFields(existing, staged) {
  const changed = {};
  const protectedFields = existing.sync_protected_fields ?? [];
  for (const field of DIFF_FIELDS) {
    if (protectedFields.includes(field)) continue;
    const before = existing[field] ?? null;
    const after = staged[field] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed[field] = { before, after };
    }
  }
  return changed;
}

async function previousAppliedCount(column) {
  const { data, error } = await supabase
    .from("sync_runs")
    .select(column)
    .eq("status", "applied")
    .not(column, "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? data[column] : null;
}

async function chunkedInsert(table, rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
  }
}

async function writeReport(filename, report) {
  await mkdir(REPORT_DIR, { recursive: true });
  const fullPath = path.join(REPORT_DIR, filename);
  await writeFile(fullPath, JSON.stringify(report, null, 2));
  return fullPath;
}

function printAndSummarize(lines) {
  const text = lines.join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    return writeFile(process.env.GITHUB_STEP_SUMMARY, `\n${text}\n`, { flag: "a" });
  }
  return Promise.resolve();
}

async function stage(sourceScope) {
  if (!["fdic", "both"].includes(sourceScope)) {
    console.error(`--source must be 'fdic' or 'both' (got: ${sourceScope})`);
    process.exit(1);
  }

  console.log(`Creating a new ${sourceScope}-scope sync run...`);
  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ source_scope: sourceScope })
    .select("id")
    .single();
  if (runError) throw runError;
  const runId = run.id;
  console.log(`Run id: ${runId}`);

  // Everything below can fail partway through (a network blip fetching
  // ~8,500 records, a chunked insert failing on chunk 6 of 9) and would
  // otherwise leave this run stuck at status='running' forever, possibly
  // with a partial set of staging rows and no record of why. Any failure
  // here is reported as a real 'failed' run, the same way an apply-time
  // failure already was, rather than an orphaned row a human has to
  // notice and diagnose from scratch.
  try {
    await doStage(sourceScope, runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nStaging failed: ${message}`);
    const failedOk = await transition(runId, "running", "failed", { guard_reason: message.slice(0, 500), finished_at: new Date().toISOString() });
    if (!failedOk) {
      console.error(`Could not mark run ${runId} as failed — it may have already transitioned. Check its actual status directly.`);
    }
    throw err;
  }
}

async function doStage(sourceScope, runId) {
  console.log("Fetching all active FDIC institutions...");
  const { rows: fdicRaw, sourceTotal: fdicSourceTotal } = await fetchAllFdicInstitutions();
  const fdicRecords = fdicRaw.map(fdicRecordToSourceInstitution);
  console.log(`Fetched ${fdicRecords.length} FDIC institutions (source reports ${fdicSourceTotal}).`);

  let ncuaRecords = [];
  let ncuaSourceTotal = null;
  if (sourceScope === "both") {
    console.log("Fetching the latest NCUA reference sync log...");
    const latestLog = await fetchLatestNcuaSyncLog();
    if (!latestLog) {
      throw new Error(
        "No ncua_reference_sync_log row exists yet — run scripts/sync-ncua-directory.mjs at least once before syncing the ncua scope."
      );
    }
    ncuaSourceTotal = latestLog.foicu_row_count;
    console.log(`Latest NCUA reference sync: log id ${latestLog.id}, ${ncuaSourceTotal} FOICU rows.`);
    const ncuaRaw = await fetchNcuaCandidates(latestLog.id);
    ncuaRecords = ncuaRaw.map(ncuaRecordToSourceInstitution);
    console.log(`Loaded ${ncuaRecords.length} NCUA credit union(s) confirmed by the latest sync (closures already excluded).`);
  }

  // Hashed both immediately before AND immediately after the paginated
  // read (fetchAllBanksInScope makes several separate requests — it is
  // NOT one atomic snapshot). If the two disagree, something wrote to
  // `banks` while this run was reading it, meaning the in-memory
  // existingBanks array could be a mixed snapshot (some rows reflect the
  // state before that write, some after) — every decision built on top of
  // it (slug reuse, the inactivation-cap estimate, the diff itself) would
  // be unreliable. Aborting and requiring a fresh run is simpler and safer
  // than trying to reconcile a partial read.
  //
  // Two separate hashes, not one: base_snapshot_hash only covers linked
  // banks within THIS run's own scope, but fetchAllBanksInScope reads (and
  // reserves slugs against) every bank regardless of linkage or scope —
  // compute_all_bank_slugs_hash covers that wider surface so a slug-
  // affecting write elsewhere during the read is caught too, not just
  // drift within the narrower scope base_snapshot_hash already protects.
  console.log("Computing base_snapshot_hash and the all-bank slug hash before reading banks...");
  const hashBefore = await computeBaseHash(sourceScope);
  const slugsHashBefore = await computeAllSlugsHash();

  console.log("Loading existing banks for slug/identifier context...");
  const existingBanks = await fetchAllBanksInScope();

  console.log("Re-computing both hashes after the read to confirm nothing changed mid-read...");
  const hashAfter = await computeBaseHash(sourceScope);
  if (hashBefore !== hashAfter) {
    throw new Error(
      "banks state changed while this run was reading existing banks (before/after base_snapshot_hash mismatch) — the read may be a mixed snapshot. Aborting; re-run staging."
    );
  }
  const slugsHashAfter = await computeAllSlugsHash();
  if (slugsHashBefore !== slugsHashAfter) {
    throw new Error(
      "a bank's slug changed somewhere while this run was reading existing banks (before/after slug hash mismatch) — proposed_slug decisions may be unreliable. Aborting; re-run staging."
    );
  }
  const baseHash = hashAfter;

  const usedSlugs = new Set(existingBanks.map((b) => b.slug));
  const existingLinked = existingBanks
    .filter((b) => (b.source_authority === "fdic" && b.fdic_cert !== null) || (b.source_authority === "ncua" && b.ncua_charter_number !== null))
    .map((b) => ({
      sourceAuthority: b.source_authority,
      identifier: b.source_authority === "fdic" ? b.fdic_cert : b.ncua_charter_number,
      slug: b.slug,
    }));
  // Keyed the same way as buildStagingRows internally, so the report can
  // classify each valid row as "new insert" vs. "update to an existing
  // bank" for real review — finalize_sync_run alone knows the true
  // insert/update/unchanged split (it does its own live lookup at apply
  // time), so this is a preview, not a guarantee of what will happen.
  const existingBankByKey = new Map(existingBanks.filter((b) => b.id).map((b) => [
    `${b.source_authority}:${b.source_authority === "fdic" ? b.fdic_cert : b.ncua_charter_number}`,
    b,
  ]));

  console.log("Building staging rows (duplicate-identifier detection, slug assignment)...");
  const fdicStagingRows = buildStagingRows(fdicRecords, existingLinked, usedSlugs);
  const ncuaStagingRows = sourceScope === "both" ? buildStagingRows(ncuaRecords, existingLinked, usedSlugs) : [];
  const allStagingRows = [...fdicStagingRows, ...ncuaStagingRows];

  const fdicCollectedCount = fdicStagingRows.length;
  const fdicRejectedCount = fdicStagingRows.filter((r) => r.status === "rejected").length;
  const ncuaCollectedCount = ncuaStagingRows.length;
  const ncuaRejectedCount = ncuaStagingRows.filter((r) => r.status === "rejected").length;

  console.log("Checking retention baselines against the last applied run...");
  const fdicPrevious = await previousAppliedCount("fdic_collected_count");
  const ncuaPrevious = sourceScope === "both" ? await previousAppliedCount("ncua_collected_count") : null;

  const guardResults = [
    checkExactCountGuard("fdic", fdicCollectedCount, fdicSourceTotal),
    checkRejectRateGuard("fdic", fdicCollectedCount, fdicRejectedCount),
    checkRetentionGuard("fdic", fdicCollectedCount, fdicPrevious),
  ];
  if (sourceScope === "both") {
    guardResults.push(
      checkExactCountGuard("ncua", ncuaCollectedCount, ncuaSourceTotal),
      checkRejectRateGuard("ncua", ncuaCollectedCount, ncuaRejectedCount),
      checkRetentionGuard("ncua", ncuaCollectedCount, ncuaPrevious)
    );
  }

  const failedGuards = guardResults.filter((g) => !g.passed);
  const countUpdate = {
    fdic_source_total: fdicSourceTotal,
    fdic_collected_count: fdicCollectedCount,
    ...(sourceScope === "both" ? { ncua_source_total: ncuaSourceTotal, ncua_collected_count: ncuaCollectedCount } : {}),
    rejected_count: fdicRejectedCount + ncuaRejectedCount,
  };

  if (failedGuards.length > 0) {
    const guardReason = failedGuards.map((g) => g.message).join("; ");
    console.error(`\nFATAL guard(s) tripped — this run is blocked, no staging rows were written:\n  ${failedGuards.map((g) => g.message).join("\n  ")}`);
    const blockedOk = await transition(runId, "running", "guard_blocked", { ...countUpdate, guard_reason: guardReason, finished_at: new Date().toISOString() });
    if (!blockedOk) throw new Error(`could not transition run ${runId} to guard_blocked`);
    await printAndSummarize([
      `## Institution sync — BLOCKED`,
      `Run: ${runId}`,
      `Reason: ${guardReason}`,
    ]);
    process.exit(1);
  }

  console.log(`All guards passed:\n  ${guardResults.map((g) => g.message).join("\n  ")}`);

  console.log("Checking the inactivation cap...");
  const stagedFdicIdentifiers = new Set(fdicStagingRows.map((r) => r.source_identifier).filter((id) => id !== null));
  const stagedNcuaIdentifiers = new Set(ncuaStagingRows.map((r) => r.source_identifier).filter((id) => id !== null));
  const activeFdicBanks = existingBanks.filter((b) => b.source_authority === "fdic" && b.is_active);
  const activeNcuaBanks = existingBanks.filter((b) => b.source_authority === "ncua" && b.is_active);
  // The actual banks that would be inactivated, not just a count — a
  // reviewer can't tell whether "12 would be inactivated" is fine or
  // alarming without knowing which 12.
  const toBankSummary = (b) => ({ id: b.id, slug: b.slug, name: b.name, sourceAuthority: b.source_authority, identifier: b.source_authority === "fdic" ? b.fdic_cert : b.ncua_charter_number });
  const inactivateFdicRows = activeFdicBanks.filter((b) => !stagedFdicIdentifiers.has(b.fdic_cert)).map(toBankSummary);
  const inactivateNcuaRows = sourceScope === "both" ? activeNcuaBanks.filter((b) => !stagedNcuaIdentifiers.has(b.ncua_charter_number)).map(toBankSummary) : [];
  const wouldInactivateFdic = inactivateFdicRows.length;
  const wouldInactivateNcua = inactivateNcuaRows.length;

  const capResults = [checkInactivationCap("fdic", wouldInactivateFdic, activeFdicBanks.length)];
  if (sourceScope === "both") capResults.push(checkInactivationCap("ncua", wouldInactivateNcua, activeNcuaBanks.length));
  const capExceeded = capResults.some((c) => c.exceeded);
  console.log(`  ${capResults.map((c) => c.message).join("\n  ")}`);

  // The real reviewable diff, classified using the SAME rules
  // finalize_sync_run itself applies (reactivate only from
  // inactive_reason='unlisted'; a manually-inactive match is left alone;
  // an active match only counts as "update" if a field actually differs).
  // insertRows/reactivateRows/manuallyInactiveRows/inactivateRows carry
  // full data since every one of them is a real, reviewable event;
  // updateRows only lists the fields that actually differ (not the whole
  // row) to keep this readable at real scale; unchanged rows are counted,
  // not listed — nothing to review there. This is still a PREVIEW: the
  // true insert/update/unchanged split is only certain when
  // finalize_sync_run does its own live lookup at apply time.
  const insertRows = [];
  const updateRows = [];
  const reactivateRows = [];
  const manuallyInactiveRows = [];
  let unchangedCount = 0;
  for (const row of allStagingRows) {
    if (row.status !== "valid") continue;
    const existing = existingBankByKey.get(`${row.source_authority}:${row.source_identifier}`);
    if (!existing) {
      insertRows.push(row);
      continue;
    }
    if (!existing.is_active && existing.inactive_reason === "unlisted") {
      reactivateRows.push({ existingBankId: existing.id, existingBankSlug: existing.slug, existingName: existing.name, staged: row });
    } else if (!existing.is_active) {
      manuallyInactiveRows.push({ existingBankId: existing.id, existingBankSlug: existing.slug, existingName: existing.name, existingInactiveReason: existing.inactive_reason });
    } else {
      const changedFields = computeChangedFields(existing, row);
      if (Object.keys(changedFields).length > 0) {
        updateRows.push({ existingBankId: existing.id, existingBankSlug: existing.slug, existingName: existing.name, changedFields });
      } else {
        unchangedCount++;
      }
    }
  }

  const rejectReasonCounts = {};
  for (const row of allStagingRows) {
    if (row.status !== "rejected") continue;
    rejectReasonCounts[row.reject_reason] = (rejectReasonCounts[row.reject_reason] ?? 0) + 1;
  }

  console.log(`Staging ${allStagingRows.length} row(s)...`);
  await chunkedInsert("sync_staging_institutions", allStagingRows.map((r) => ({ run_id: runId, ...r })));

  // Computed from the rows as actually persisted (their real generated
  // ids), via the same canonical function finalize_sync_run recomputes at
  // apply time — proves the staged data itself hasn't changed since
  // review, the same way base_snapshot_hash proves `banks` hasn't.
  console.log("Computing source_snapshot_hash over the persisted staging rows...");
  const { data: stagingHash, error: stagingHashError } = await supabase.rpc("compute_staging_snapshot_hash", { p_run_id: runId });
  if (stagingHashError) throw stagingHashError;

  const report = {
    runId,
    sourceScope,
    stagedAt: new Date().toISOString(),
    counts: {
      ...countUpdate,
      wouldInactivateFdic,
      wouldInactivateNcua,
      insertCount: insertRows.length,
      updateCount: updateRows.length,
      unchangedCount,
      reactivateCount: reactivateRows.length,
      manuallyInactiveCount: manuallyInactiveRows.length,
    },
    rejectReasonCounts,
    capExceeded,
    insertRows,
    updateRows,
    reactivateRows,
    manuallyInactiveRows,
    inactivateRows: [...inactivateFdicRows, ...inactivateNcuaRows],
    rejectedRows: allStagingRows.filter((r) => r.status === "rejected"),
  };

  // The report is written into sync_runs.report IN THE SAME atomic
  // transition that marks the run 'staged' — a run only ever becomes
  // applyable together with its own durable, reviewable report, never
  // before it. Writing the report to a local file/artifact afterward
  // (below) is best-effort convenience for humans without direct DB
  // access; the DB row is the authoritative copy.
  const stagedOk = await transition(runId, "running", "staged", {
    ...countUpdate,
    base_snapshot_hash: baseHash,
    source_snapshot_hash: stagingHash,
    requires_override_reason: capExceeded ? "inactivation_cap_exceeded" : null,
    report,
  });
  if (!stagedOk) throw new Error(`could not transition run ${runId} to staged`);

  const summaryLines = [
    `## Institution sync — staged`,
    `Run: ${runId}`,
    `Scope: ${sourceScope}`,
    `FDIC: ${fdicCollectedCount} collected (source total ${fdicSourceTotal}), ${fdicRejectedCount} rejected, ~${wouldInactivateFdic} would be inactivated.`,
    ...(sourceScope === "both" ? [`NCUA: ${ncuaCollectedCount} collected (source total ${ncuaSourceTotal}), ${ncuaRejectedCount} rejected, ~${wouldInactivateNcua} would be inactivated.`] : []),
    `Inserts: ${insertRows.length}, updates: ${updateRows.length}, unchanged: ${unchangedCount}, reactivations: ${reactivateRows.length}, manually-inactive (left alone): ${manuallyInactiveRows.length}.`,
    `Reject reasons: ${JSON.stringify(rejectReasonCounts)}`,
    capExceeded
      ? `INACTIVATION CAP EXCEEDED — apply requires --allow-large-inactivation.`
      : `Inactivation cap OK.`,
    ``,
    `Review this run, then apply with:`,
    `  node scripts/sync-institution-directory.mjs --apply --run-id ${runId}${capExceeded ? " --allow-large-inactivation" : ""}`,
  ];
  await printAndSummarize(summaryLines);

  try {
    const reportPath = await writeReport(`institution-sync-${runId}.json`, report);
    console.log(`\nFull staging report (also durably stored in sync_runs.report) written to ${reportPath}`);
  } catch (err) {
    console.error(`Could not write the local report file (the run is still safely staged — sync_runs.report is the authoritative copy): ${err instanceof Error ? err.message : err}`);
  }
}

async function apply(runId, allowLargeInactivation) {
  console.log(`Loading sync run ${runId}...`);
  const { data: run, error: runError } = await supabase.from("sync_runs").select("*").eq("id", runId).maybeSingle();
  if (runError) throw runError;
  if (!run) {
    console.error(`No sync_runs row found for id ${runId}.`);
    process.exit(1);
  }
  if (run.status !== "staged") {
    console.error(`Run ${runId} is not staged (status: ${run.status}) — it may already be applied, applying, failed, or blocked. Nothing to do.`);
    process.exit(1);
  }
  if (run.requires_override_reason && !allowLargeInactivation) {
    console.error(
      `Run ${runId} requires an override (${run.requires_override_reason}) — re-run with --allow-large-inactivation to proceed, after reviewing why.`
    );
    process.exit(1);
  }

  console.log("Transitioning staged -> applying...");
  const applyingOk = await transition(runId, "staged", "applying", run.requires_override_reason ? { override_applied: true } : {});
  if (!applyingOk) {
    console.error(`Run ${runId} is no longer staged (concurrently modified) — aborting before calling finalize_sync_run.`);
    process.exit(1);
  }

  console.log("Calling finalize_sync_run...");
  const { data: result, error: rpcError } = await supabase.rpc("finalize_sync_run", { p_run_id: runId });
  if (rpcError) {
    console.error(`finalize_sync_run failed: ${rpcError.message}`);
    const failedOk = await transition(runId, "applying", "failed", { guard_reason: rpcError.message.slice(0, 500) });
    if (!failedOk) {
      // The transaction actually committed despite the client-perceived
      // error (e.g. a network blip after commit) — never overwrite a
      // genuine success with 'failed'. Re-read and report the real state.
      const { data: actual } = await supabase.from("sync_runs").select("status").eq("id", runId).maybeSingle();
      console.error(`Could not mark the run failed — it's no longer 'applying'. Actual current status: ${actual?.status}`);
    }
    process.exit(1);
  }

  console.log(`Done. Applied run ${runId}:`);
  console.log(`  inserted: ${result.inserted}`);
  console.log(`  updated: ${result.updated}`);
  console.log(`  unchanged: ${result.unchanged}`);
  console.log(`  reactivated: ${result.reactivated}`);
  console.log(`  inactivated: ${result.inactivated}`);
  console.log(`  reappeared (manually inactive, left untouched): ${result.reappeared_manually_inactive}`);

  // finalize_sync_run never touches fednow_participant/rtp_participant/
  // zelle_participant — rail enrichment is a genuinely separate pipeline
  // (scripts/backfill-rail-participation.mjs), and --apply is not yet
  // wired to trigger it automatically. Any newly inserted institution
  // above starts with all three flags null until that's run explicitly.
  if (result.inserted > 0) {
    console.log(
      `\n${result.inserted} newly inserted institution(s) have no rail-participation data yet (fednow/rtp/zelle_participant all null).\n` +
        `Run next, in order: refresh the participant sources (scripts/sync-rail-participants.mjs, scripts/sync-zelle-participants.mjs) if they haven't run recently, ` +
        `then node scripts/backfill-rail-participation.mjs, then scripts/audit-duplicate-name-rail-flags.mjs to review anything left ambiguous.`
    );
  }
}

async function main() {
  const { apply: applyMode, runId, allowLargeInactivation, source } = parseArgs(process.argv.slice(2));

  if (applyMode) {
    if (!runId) {
      console.error("Usage: node scripts/sync-institution-directory.mjs --apply --run-id <uuid> [--allow-large-inactivation]");
      process.exit(1);
    }
    await apply(runId, allowLargeInactivation);
    return;
  }

  if (!source) {
    console.error("Usage: node scripts/sync-institution-directory.mjs --source {fdic|both}");
    process.exit(1);
  }
  await stage(source);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
