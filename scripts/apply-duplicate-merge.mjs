// Applies only the CONFIRMED pairs from findDuplicatePairs() (never the
// flagged ones — those need a human) — recomputed fresh here rather than
// read from a prior audit's saved JSON, so a change to the data between
// audit and apply can't go unnoticed.
//
// For each confirmed pair: the old, unlinked, pre-sync duplicate record
// is marked is_active=false, inactive_reason='merged',
// merged_into_bank_id=<the real charter-linked bank> — the existing
// redirect logic in app/banks/[slug]/page.tsx already sends anyone
// hitting the old bank's slug to the correct one. Nothing is deleted:
// confirmed directly that none of these old records have any attached
// route_reports/edd_reports/bank_corrections/route_requests, so there's
// no community data to reassign, but the mechanism is non-destructive
// either way. The old name is folded into the surviving bank's aka_names
// so it stays findable under the name it used to go by. Dry-run by
// default; --apply to write.
//
// Code review finding (post-v8.14.5): the old-row deactivation and the
// surviving row's aka_names update used to be two independent requests
// (Promise.all) — one succeeding while the other failed left an
// inconsistent state. Both now happen inside merge_duplicate_bank
// (20260721013900), one transaction, same fix shape already used for
// apply_bank_correction.
import { createClient } from "@supabase/supabase-js";
import { findDuplicatePairs } from "./lib/duplicateInstitutions.mjs";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchAllBanks() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, slug, name, name_normalized, address, phone, website, city, state, fdic_cert, ncua_charter_number, total_assets, is_active, aka_names")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log(APPLY ? "Running in APPLY mode — will write to production.\n" : "Running in DRY-RUN mode (pass --apply to write).\n");

  console.log("Loading banks and recomputing matches fresh...");
  const banks = await fetchAllBanks();
  const { confirmed, flagged } = findDuplicatePairs(banks);
  console.log(`${confirmed.length} confirmed pair(s), ${flagged.length} flagged pair(s) (flagged are never auto-applied).\n`);

  let appliedCount = 0;
  let failedCount = 0;

  for (const pair of confirmed) {
    console.log(`- ${pair.unlinked.name} (${pair.unlinked.slug}) -> merged into ${pair.linked.name} (${pair.linked.slug})`);

    if (!APPLY) continue;

    const { error } = await supabase.rpc("merge_duplicate_bank", {
      p_old_bank_id: pair.unlinked.id,
      p_new_bank_id: pair.linked.id,
      p_old_bank_name: pair.unlinked.name,
    });

    if (error) {
      failedCount++;
      console.log(`    FAILED: ${error.message}`);
    } else {
      appliedCount++;
    }
  }

  console.log(
    APPLY
      ? `\nDone. ${appliedCount}/${confirmed.length} pair(s) merged${failedCount ? `, ${failedCount} FAILED` : ""}.`
      : `\nDry run complete. ${confirmed.length} pair(s) would be merged. Re-run with --apply to write.`
  );

  if (flagged.length > 0) {
    console.log(`\n${flagged.length} pair(s) flagged for manual review — never auto-applied. Run audit-duplicate-institutions.mjs for details.`);
  }

  if (failedCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
