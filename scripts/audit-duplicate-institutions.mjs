// Read-only. Finds banks added before this project's official-directory
// sync existed (source_authority is null — added manually, never linked
// to a real charter) that are actually duplicates of a bank the sync
// later added under its own official charter — the pre-sync reconciliation
// step (audit-unlinked-banks.mjs / apply-reconciliation.mjs) required an
// identical normalized name to consider two banks a match, which misses
// cases like "A.s.h. Employees Credit Union" (old) vs "A.S.H. EMPLOYEES"
// (new, NCUA-linked) — same real institution, but "Credit Union" in one
// name and not the other means they never share a name_normalized value.
//
// Matches on phone number instead, which the reconciliation step doesn't
// use. Phone alone isn't reliable enough to act on though — confirmed
// directly against production: a small handful of phone matches are
// either coincidental (two unrelated credit unions in different cities
// sharing a number) or a shared back-office/service-center address used
// by several distinct small credit unions, and in one pair the two
// institutions' phone numbers were actually swapped relative to each
// other's true counterpart. So every phone match also requires a
// corroborating address AND non-conflicting total_assets before being
// treated as confirmed; anything else is flagged for manual review
// instead, per this project's "blank over wrong" rule — never guessed,
// never auto-merged.
//
// A second pass also catches same-normalized-name collisions the
// reconciliation step itself missed: it requires phone-or-website
// corroboration to leave "unresolved", so a legacy row with neither
// populated (confirmed against production: Wells Fargo, City Bank, Bank
// Hapoalim, Bank of India, First Bank & Trust, East West Bank, and others)
// never resolves and never merges. Same confirmed/flagged rules apply — a
// name shared by two or more authoritative charters is always flagged,
// never guessed.
//
// Run on a schedule via sync-data.yml. Confirmed pairs always exit non-zero
// (cheaply actionable — just run apply-duplicate-merge.mjs --apply).
// Flagged pairs only exit non-zero when new since duplicate-institutions-
// baseline.json (scripts/lib/auditBaseline.mjs) — most flagged groups are
// genuinely ambiguous and may never resolve, so re-signaling the same known
// backlog every run trains whoever's watching CI to ignore it. Pass
// --update-baseline after reviewing the current flagged list to mark it as
// known/accepted; that's a manual, reviewed action (a committed file
// change), never automatic.
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDuplicatePairs } from "./lib/duplicateInstitutions.mjs";
import { loadBaselineKeys, saveBaselineKeys, partitionByBaseline } from "./lib/auditBaseline.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");
const BASELINE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "duplicate-institutions-baseline.json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

async function fetchAllBanks() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, slug, name, name_normalized, address, phone, city, state, fdic_cert, ncua_charter_number, source_authority, total_assets, is_active, created_at")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log("Loading banks...");
  const banks = await fetchAllBanks();
  console.log(`${banks.length} bank(s) loaded.\n`);

  const { confirmed, flagged } = findDuplicatePairs(banks);

  // Confirmed pairs are cheaply actionable (a human just needs to run
  // apply-duplicate-merge.mjs --apply), so they always signal — baselining
  // them away would hide something safe to fix right now. Flagged pairs are
  // genuinely ambiguous and may never resolve (e.g. six distinct Pinnacle
  // Bank charters sharing a name); those are only worth re-signaling when a
  // *new* one shows up, not every single run forever.
  const baselineKeys = await loadBaselineKeys(BASELINE_PATH);
  const { news: newFlagged, known: knownFlagged } = partitionByBaseline(flagged, (f) => f.unlinked.slug, baselineKeys);

  console.log(`Confirmed duplicate pairs (address + assets corroborated): ${confirmed.length}`);
  console.log(
    `Flagged for manual review (conflicting or ambiguous): ${flagged.length} ` +
      `(${newFlagged.length} new since baseline, ${knownFlagged.length} already known)\n`
  );

  for (const f of flagged) {
    const isNew = newFlagged.includes(f);
    console.log(`FLAGGED${isNew ? " [NEW]" : " [known]"}: ${f.reason}`);
    console.log(`  unlinked: ${f.unlinked.name} (${f.unlinked.slug})`);
    if (f.candidates) {
      for (const c of f.candidates) console.log(`  candidate: ${c.name} (${c.slug})`);
    } else {
      console.log(`  candidate: ${f.linked.name} (${f.linked.slug})`);
    }
    console.log("");
  }

  const auditedAt = new Date().toISOString();
  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `duplicate-institutions-audit-${auditedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(reportPath, JSON.stringify({ auditedAt, totalBanks: banks.length, confirmed, flagged, newFlaggedSlugs: newFlagged.map((f) => f.unlinked.slug) }, null, 2));

  console.log(`Report written to ${reportPath}`);
  console.log("No changes were made — this script is read-only. Review flagged pairs manually; confirmed pairs can be applied with apply-duplicate-merge.mjs.");

  if (UPDATE_BASELINE) {
    await saveBaselineKeys(BASELINE_PATH, flagged.map((f) => f.unlinked.slug));
    console.log(`\nBaseline updated: ${flagged.length} flagged pair(s) now marked as known/reviewed at ${BASELINE_PATH}.`);
  }

  // Non-fatal signal, not a script failure — lets a scheduled CI run turn
  // "there's something to review" into a visible red X instead of a log
  // nobody reads, the same idiom apply-duplicate-merge.mjs already uses
  // for its own failedCount check.
  if (confirmed.length > 0 || newFlagged.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
