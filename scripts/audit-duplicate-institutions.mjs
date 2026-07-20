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
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDuplicatePairs } from "./lib/duplicateInstitutions.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");

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

  console.log(`Confirmed duplicate pairs (address + assets corroborated): ${confirmed.length}`);
  console.log(`Flagged for manual review (conflicting or ambiguous): ${flagged.length}\n`);

  for (const f of flagged) {
    console.log(`FLAGGED: ${f.reason}`);
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
  await writeFile(reportPath, JSON.stringify({ auditedAt, totalBanks: banks.length, confirmed, flagged }, null, 2));

  console.log(`Report written to ${reportPath}`);
  console.log("No changes were made — this script is read-only. Review flagged pairs manually; confirmed pairs can be applied with apply-duplicate-merge.mjs.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
