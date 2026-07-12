// One-time (per-bank) join of already-imported banks to their NCUA charter,
// via website matching (the same key import-ncua-credit-unions.mjs used for
// dedup at import time). Pure DB-to-DB - no external API calls, since NCUA's
// data is already fully synced locally in ncua_credit_unions. Once a bank
// has ncua_charter_number set, sync-ncua-directory.mjs keeps its aka_names
// current on every future sync without needing this script run again.
import { createClient } from "@supabase/supabase-js";
import { normalizeWebsite, computeAkaNamesFromSearchNames } from "./lib/bankAkaNames.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchAll(table, columns) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log("Loading banks and NCUA credit unions...");
  const [banks, creditUnions] = await Promise.all([
    fetchAll("banks", "id, name, website, ncua_charter_number"),
    fetchAll("ncua_credit_unions", "charter_number, website, search_names"),
  ]);

  const byWebsite = new Map();
  for (const cu of creditUnions) {
    const norm = normalizeWebsite(cu.website);
    if (norm && !byWebsite.has(norm)) byWebsite.set(norm, cu);
  }

  let updated = 0;
  let alreadyLinked = 0;
  let noWebsite = 0;
  let noMatch = 0;

  for (const bank of banks) {
    if (bank.ncua_charter_number) {
      alreadyLinked++;
      continue;
    }

    const norm = normalizeWebsite(bank.website);
    if (!norm) {
      noWebsite++;
      continue;
    }

    const cu = byWebsite.get(norm);
    if (!cu) {
      noMatch++;
      continue;
    }

    const akaNames = computeAkaNamesFromSearchNames(bank.name, cu.search_names);
    const { error } = await supabase
      .from("banks")
      .update({ ncua_charter_number: cu.charter_number, aka_names: akaNames })
      .eq("id", bank.id);

    if (error) {
      console.log(`- ${bank.name}: update failed - ${error.message}`);
      continue;
    }
    updated++;
  }

  console.log(
    `Done. Linked ${updated} banks to an NCUA charter (${alreadyLinked} already linked, ${noWebsite} had no website to match on, ${noMatch} had a website with no NCUA match).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
