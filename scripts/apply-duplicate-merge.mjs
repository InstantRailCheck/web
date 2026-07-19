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
      .select("id, slug, name, name_normalized, address, phone, city, state, fdic_cert, ncua_charter_number, total_assets, is_active, aka_names")
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
  const byId = new Map(banks.map((b) => [b.id, b]));
  const { confirmed, flagged } = findDuplicatePairs(banks);
  console.log(`${confirmed.length} confirmed pair(s), ${flagged.length} flagged pair(s) (flagged are never auto-applied).\n`);

  let appliedCount = 0;
  let failedCount = 0;

  for (const pair of confirmed) {
    console.log(`- ${pair.unlinked.name} (${pair.unlinked.slug}) -> merged into ${pair.linked.name} (${pair.linked.slug})`);

    if (!APPLY) continue;

    const linkedBank = byId.get(pair.linked.id);
    const currentAka = linkedBank?.aka_names ?? [];
    const newAka = currentAka.includes(pair.unlinked.name) ? currentAka : [...currentAka, pair.unlinked.name];

    const [oldUpdate, newUpdate] = await Promise.all([
      supabase
        .from("banks")
        .update({ is_active: false, inactive_reason: "merged", merged_into_bank_id: pair.linked.id })
        .eq("id", pair.unlinked.id),
      supabase.from("banks").update({ aka_names: newAka }).eq("id", pair.linked.id),
    ]);

    if (oldUpdate.error || newUpdate.error) {
      failedCount++;
      console.log(`    FAILED: ${oldUpdate.error?.message ?? ""} ${newUpdate.error?.message ?? ""}`.trim());
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
