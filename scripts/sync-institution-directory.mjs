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
import { normalizeWebsite, extractFdicAkaNames, deriveDomainInitialsAka, mergeAkaNames, computeAkaNamesFromSearchNames } from "./lib/bankAkaNames.mjs";

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
  const website = row.WEBADDR ? normalizeWebsite(row.WEBADDR.startsWith("http") ? row.WEBADDR : `https://${row.WEBADDR}`) : null;
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
    name: row.name,
    city: row.city,
    state: row.state,
    website: row.website,
    phone: row.phone,
    address: row.address,
    totalAssets: row.total_assets,
    akaNames: computeAkaNamesFromSearchNames(row.name, row.search_names ?? []),
  };
}

async function fetchAllBanksInScope() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, slug, source_authority, fdic_cert, ncua_charter_number, is_active")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
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

  console.log("Loading existing banks for slug/identifier context...");
  const existingBanks = await fetchAllBanksInScope();

  // Computed immediately after the read this whole run's diff is based
  // on — not after building/staging the diff, which can take a while
  // (paginated fetches, chunked inserts) and would otherwise leave a
  // window where a concurrent production write is invisible to both this
  // script's own decisions (slug reuse, the inactivation-cap estimate)
  // AND to the drift check, since that only compares against whatever
  // moment the hash itself was captured at. Capturing it here, at the
  // same moment as the read, means ANY change from this point through to
  // apply time is caught.
  console.log("Computing base_snapshot_hash against the exact banks state this diff is built from...");
  const { data: baseHash, error: hashError } = await supabase.rpc("compute_banks_base_snapshot_hash", { p_source_scope: sourceScope });
  if (hashError) throw hashError;

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
  const wouldInactivateFdic = activeFdicBanks.filter((b) => !stagedFdicIdentifiers.has(b.fdic_cert)).length;
  const wouldInactivateNcua = sourceScope === "both" ? activeNcuaBanks.filter((b) => !stagedNcuaIdentifiers.has(b.ncua_charter_number)).length : 0;

  const capResults = [checkInactivationCap("fdic", wouldInactivateFdic, activeFdicBanks.length)];
  if (sourceScope === "both") capResults.push(checkInactivationCap("ncua", wouldInactivateNcua, activeNcuaBanks.length));
  const capExceeded = capResults.some((c) => c.exceeded);
  console.log(`  ${capResults.map((c) => c.message).join("\n  ")}`);

  console.log(`Staging ${allStagingRows.length} row(s)...`);
  await chunkedInsert("sync_staging_institutions", allStagingRows.map((r) => ({ run_id: runId, ...r })));

  const stagedOk = await transition(runId, "running", "staged", {
    ...countUpdate,
    base_snapshot_hash: baseHash,
    requires_override_reason: capExceeded ? "inactivation_cap_exceeded" : null,
  });
  if (!stagedOk) throw new Error(`could not transition run ${runId} to staged`);

  const rejectReasonCounts = {};
  for (const row of allStagingRows) {
    if (row.status !== "rejected") continue;
    rejectReasonCounts[row.reject_reason] = (rejectReasonCounts[row.reject_reason] ?? 0) + 1;
  }

  const summaryLines = [
    `## Institution sync — staged`,
    `Run: ${runId}`,
    `Scope: ${sourceScope}`,
    `FDIC: ${fdicCollectedCount} collected (source total ${fdicSourceTotal}), ${fdicRejectedCount} rejected, ~${wouldInactivateFdic} would be inactivated.`,
    ...(sourceScope === "both" ? [`NCUA: ${ncuaCollectedCount} collected (source total ${ncuaSourceTotal}), ${ncuaRejectedCount} rejected, ~${wouldInactivateNcua} would be inactivated.`] : []),
    `Reject reasons: ${JSON.stringify(rejectReasonCounts)}`,
    capExceeded
      ? `INACTIVATION CAP EXCEEDED — apply requires --allow-large-inactivation.`
      : `Inactivation cap OK.`,
    ``,
    `Review this run, then apply with:`,
    `  node scripts/sync-institution-directory.mjs --apply --run-id ${runId}${capExceeded ? " --allow-large-inactivation" : ""}`,
  ];
  await printAndSummarize(summaryLines);

  // The actual reviewable diff — every valid row classified as a new
  // insert vs. an update to a specific existing bank (by id/slug/current
  // name), not just the rejected rows. This is a preview computed from the
  // same existingBanks snapshot the run was staged against; the true
  // insert/update/unchanged split is only known for certain when
  // finalize_sync_run runs its own live lookup at apply time.
  const insertRows = [];
  const updateRows = [];
  for (const row of allStagingRows) {
    if (row.status !== "valid") continue;
    const existing = existingBankByKey.get(`${row.source_authority}:${row.source_identifier}`);
    if (existing) {
      updateRows.push({ ...row, existingBankId: existing.id, existingBankSlug: existing.slug });
    } else {
      insertRows.push(row);
    }
  }

  const reportPath = await writeReport(`institution-sync-${runId}.json`, {
    runId,
    sourceScope,
    stagedAt: new Date().toISOString(),
    counts: { ...countUpdate, wouldInactivateFdic, wouldInactivateNcua, previewInsertCount: insertRows.length, previewUpdateCount: updateRows.length },
    rejectReasonCounts,
    capExceeded,
    insertRows,
    updateRows,
    rejectedRows: allStagingRows.filter((r) => r.status === "rejected"),
  });
  console.log(`\nFull staging report (every row — inserts, updates, and rejects) written to ${reportPath}`);
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
