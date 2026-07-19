// One-time production correction for three fixes shipped together: the
// alias-safety filter in computeAkaNamesFromSearchNames (suppresses
// unrelated major-brand/unlexically-related NCUA TradeNames entries, e.g.
// ANECA's "morgan stanley"/"jp morgan"), the ANECA ACRONYMS addition in
// institutionNameCase.ts (restores "ANECA" instead of "Aneca"), and
// repairDoubledProtocol/isValidWebsiteDomain (fixes a doubly-prefixed
// website exactly, changes nothing else, and nulls out a truncation
// NCUA's own fixed-width source field can't recover, e.g. Richland Credit
// Union / charter 3391 - never rewrites a website that was already fine).
//
// Recomputes `name`, `aka_names`, and `website` for every NCUA-linked bank
// straight from ncua_credit_unions (the raw source of truth), the exact
// same way sync-institution-directory.mjs / sync-ncua-directory.mjs
// already do — so this is provably the same result a normal sync would
// produce, not a one-off calculation that could drift from the ongoing
// pipeline. Because all three fixes live in the shared functions those
// pipelines already call, this script (and the regular monthly sync) can
// never re-introduce a suppressed alias, the wrong casing, or a broken
// website later.
//
// name_normalized is a Postgres STORED GENERATED column derived from
// name + aka_names — Postgres recomputes it automatically on this UPDATE,
// no separate step needed. Dry-run by default; --apply to write.
import { createClient } from "@supabase/supabase-js";
import { computeAkaNamesFromSearchNames, deriveDomainInitialsAka, mergeAkaNames, isValidWebsiteDomain, repairDoubledProtocol } from "./lib/bankAkaNames.mjs";
import { isAllCapsName, smartTitleCase } from "../lib/institutionNameCase.ts";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchAllNcuaCreditUnions() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("ncua_credit_unions")
      .select("charter_number, name, search_names, website")
      .order("charter_number", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchAllNcuaLinkedBanks() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, slug, name, website, aka_names, ncua_charter_number")
      .not("ncua_charter_number", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

function sameAka(a, b) {
  return JSON.stringify((a ?? []).slice().sort()) === JSON.stringify((b ?? []).slice().sort());
}

async function main() {
  console.log(APPLY ? "Running in APPLY mode — will write to production.\n" : "Running in DRY-RUN mode (pass --apply to write).\n");

  console.log("Loading ncua_credit_unions and NCUA-linked banks...");
  const ncuaRows = await fetchAllNcuaCreditUnions();
  const banks = await fetchAllNcuaLinkedBanks();
  const byCharter = new Map(ncuaRows.map((r) => [r.charter_number, r]));
  console.log(`${banks.length} NCUA-linked bank(s) loaded.\n`);

  let plannedCount = 0;
  let appliedCount = 0;
  let failedCount = 0;

  for (const bank of banks) {
    const source = byCharter.get(bank.ncua_charter_number);
    if (!source) continue; // charter not present in the latest ncua_credit_unions snapshot

    const correctName = isAllCapsName(source.name) ? smartTitleCase(source.name) : source.name;
    const repairedWebsite = repairDoubledProtocol(source.website);
    const newWebsite = isValidWebsiteDomain(repairedWebsite) ? repairedWebsite : null;
    const ncuaAka = computeAkaNamesFromSearchNames(correctName, source.search_names ?? []);
    const domainAka = deriveDomainInitialsAka(correctName, newWebsite);
    const newAka = mergeAkaNames(ncuaAka, domainAka);

    const nameChanged = correctName !== bank.name;
    const akaChanged = !sameAka(newAka, bank.aka_names);
    const websiteChanged = newWebsite !== bank.website;
    if (!nameChanged && !akaChanged && !websiteChanged) continue;

    plannedCount++;
    const changes = [];
    if (nameChanged) changes.push(`name: "${bank.name}" -> "${correctName}"`);
    if (akaChanged) changes.push(`aka_names: ${JSON.stringify(bank.aka_names)} -> ${JSON.stringify(newAka)}`);
    if (websiteChanged) changes.push(`website: ${JSON.stringify(bank.website)} -> ${JSON.stringify(newWebsite)}`);
    console.log(`- ${bank.name} (${bank.slug}): ${changes.join("; ")}`);

    if (!APPLY) continue;

    const update = {};
    if (nameChanged) update.name = correctName;
    if (akaChanged) update.aka_names = newAka;
    if (websiteChanged) update.website = newWebsite;
    const { error } = await supabase.from("banks").update(update).eq("id", bank.id);
    if (error) {
      failedCount++;
      console.log(`    FAILED: ${error.message}`);
    } else {
      appliedCount++;
    }
  }

  console.log(
    APPLY
      ? `\nDone. ${appliedCount}/${plannedCount} bank(s) updated${failedCount ? `, ${failedCount} FAILED` : ""}.`
      : `\nDry run complete. ${plannedCount} bank(s) would be updated. Re-run with --apply to write.`
  );

  if (failedCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
