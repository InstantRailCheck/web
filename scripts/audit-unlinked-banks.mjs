// v8.0 §5 — read-only. Reconciles the 546 banks with neither fdic_cert nor
// ncua_charter_number set against the two real institution-directory
// sources, so a later, separately-reviewed apply-reconciliation.mjs run
// can link genuine matches without ever guessing. A name match alone is
// NEVER enough — "blank over wrong" means a candidate is only trusted once
// corroborated by a second, independent field (this bank's own recorded
// website or phone actually matching that candidate's). Multiple
// corroborated candidates is real ambiguity, not something to arbitrarily
// resolve. A bank with no name hit, or a name hit with no corroboration,
// is labeled "unresolved" — never "presumed community-only", since the
// absence of a match here doesn't prove that; it may just mean this
// script's matching wasn't good enough, or the bank predates FDIC/NCUA's
// current records under a different name.
//
// Writes a JSON report to scripts/reports/ (gitignored — real institution
// data, never committed) for a human to review before anything is ever
// applied. This script itself never writes to `banks`.
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findNcuaCandidates, findFdicCandidates, isCorroborated, snapshotHash } from "./lib/unlinkedBankReconciliation.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");

async function fetchAllUnlinkedBanks() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, slug, name, website, phone")
      .is("fdic_cert", null)
      .is("ncua_charter_number", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log("Loading unlinked banks...");
  const banks = await fetchAllUnlinkedBanks();
  console.log(`${banks.length} unlinked bank(s) to reconcile.\n`);

  const results = [];
  const auditedAt = new Date().toISOString();
  let matched = 0;
  let ambiguous = 0;
  let unresolved = 0;

  for (let i = 0; i < banks.length; i++) {
    const bank = banks[i];

    const [ncuaCandidates, fdicCandidates] = await Promise.all([
      findNcuaCandidates(supabase, bank.name),
      findFdicCandidates(bank.name),
    ]);
    const allCandidates = [...ncuaCandidates, ...fdicCandidates];
    const corroborated = allCandidates.filter((c) => isCorroborated(bank, c));

    let status;
    if (corroborated.length === 1) {
      status = "matched";
      matched++;
    } else if (corroborated.length > 1) {
      status = "ambiguous";
      ambiguous++;
    } else {
      status = "unresolved";
      unresolved++;
    }

    results.push({
      bankId: bank.id,
      bankSlug: bank.slug,
      bankName: bank.name,
      bankWebsite: bank.website,
      bankPhone: bank.phone,
      status,
      candidates: allCandidates,
      corroboratedCandidates: corroborated,
      sourceSnapshotHash: snapshotHash(bank, allCandidates),
      auditedAt,
    });

    if ((i + 1) % 50 === 0) console.log(`  processed ${i + 1}/${banks.length} (matched=${matched} ambiguous=${ambiguous} unresolved=${unresolved})`);
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `unlinked-banks-audit-${auditedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(reportPath, JSON.stringify(results, null, 2));

  console.log(`\nDone. ${banks.length} bank(s) audited: ${matched} matched, ${ambiguous} ambiguous, ${unresolved} unresolved.`);
  console.log(`Report written to ${reportPath}`);
  console.log("No changes were made — this script is read-only. Review the report before running apply-reconciliation.mjs.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
