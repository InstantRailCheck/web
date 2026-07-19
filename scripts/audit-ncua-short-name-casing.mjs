// Read-only. The ANECA casing bug (NCUA's raw name "ANECA" got flattened
// to "Aneca" because ANECA wasn't in institutionNameCase.ts's curated
// ACRONYMS list) raises the obvious follow-up question: how many OTHER
// NCUA institutions have a short, single-token, all-caps raw name that
// might be a genuine acronym/initialism rather than an ordinary word?
//
// This can't be resolved automatically without a real dictionary — most
// short single-token NCUA names (MIDCOAST, TRUMBULL, CAMPUS, HOPE, ...)
// are ordinary words or coined brand names that are correctly title-cased
// today, and only a small minority are true initialisms. Rather than guess
// at scale, this reports the population so each addition to ACRONYMS stays
// a deliberate, individually-verified judgment call, same as every
// existing entry in that list.
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllCapsName, smartTitleCase } from "../lib/institutionNameCase.ts";

const MAX_LENGTH = Number(process.argv[2] ?? 6);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");

async function fetchAllNcuaCreditUnions() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("ncua_credit_unions")
      .select("charter_number, name, website")
      .order("charter_number", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log(`Loading NCUA credit unions (single-token all-caps names, <=${MAX_LENGTH} chars)...`);
  const rows = await fetchAllNcuaCreditUnions();

  const atRisk = rows
    .filter((r) => {
      const n = r.name.trim();
      return isAllCapsName(n) && /^[A-Z0-9]+$/.test(n) && n.length <= MAX_LENGTH;
    })
    .map((r) => ({
      charterNumber: r.charter_number,
      rawName: r.name,
      website: r.website,
      currentlyPreservedAsAcronym: smartTitleCase(r.name) === r.name,
      titleCasedResult: smartTitleCase(r.name),
    }));

  const alreadyPreserved = atRisk.filter((r) => r.currentlyPreservedAsAcronym);
  const titleCased = atRisk.filter((r) => !r.currentlyPreservedAsAcronym);

  console.log(`Total at-risk (single-token, all-caps, <=${MAX_LENGTH} chars): ${atRisk.length}`);
  console.log(`  Already preserved via the ACRONYMS list: ${alreadyPreserved.length}`);
  console.log(`  Currently title-cased (candidates for manual review): ${titleCased.length}\n`);
  console.log("This report does NOT attempt to classify which of the title-cased names are");
  console.log("mis-cased acronyms vs. correctly-cased ordinary words/brand names — that");
  console.log("distinction needs a human (or a real dictionary source), same as every");
  console.log("existing ACRONYMS entry. Review the written report and flag any real ones.\n");

  const auditedAt = new Date().toISOString();
  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `ncua-short-name-casing-audit-${auditedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(reportPath, JSON.stringify({ auditedAt, maxLength: MAX_LENGTH, totalAtRisk: atRisk.length, alreadyPreserved, titleCased }, null, 2));
  console.log(`Full report (${titleCased.length} title-cased candidates) written to ${reportPath}`);
  console.log("No changes were made — this script is read-only.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
