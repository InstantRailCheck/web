// One-time backfill: converts every ALL-CAPS NCUA-sourced institution
// name to a normal-looking title case (see lib/institutionNameCase.ts for
// exactly what the transform does and doesn't handle). Scoped to
// source_authority='ncua' specifically — NCUA's raw CU_NAME field is
// submitted in all-caps as a data convention (confirmed: 4,331/4,336 NCUA
// names vs only 45/4,257 FDIC names are all-caps), so this fixes a known
// formatting artifact rather than guessing at FDIC's much smaller,
// lower-confidence set of all-caps names, some of which look like
// genuine initialism-style legal names (AB&T, YNB, MNB Bank).
//
// name_normalized is a Postgres STORED GENERATED column derived from
// name (lowercased, non-alphanumeric stripped) — a pure casing change
// recomputes to the exact same normalized value, so this can't affect
// duplicate-name grouping or any name-based matching elsewhere. Dry-run
// by default; --apply to write.
import { createClient } from "@supabase/supabase-js";
import { smartTitleCase, isAllCapsName } from "../lib/institutionNameCase.ts";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchAllNcuaBanks() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, name")
      .eq("source_authority", "ncua")
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

  console.log("Loading NCUA-sourced banks...");
  const banks = await fetchAllNcuaBanks();
  console.log(`${banks.length} NCUA-sourced bank(s) loaded.\n`);

  let plannedCount = 0;
  let appliedCount = 0;
  let failedCount = 0;

  for (const bank of banks) {
    if (!isAllCapsName(bank.name)) continue;
    const newName = smartTitleCase(bank.name);
    if (newName === bank.name) continue;

    plannedCount++;
    console.log(`- ${bank.name} -> ${newName}`);

    if (!APPLY) continue;

    const { error } = await supabase.from("banks").update({ name: newName }).eq("id", bank.id);
    if (error) {
      failedCount++;
      console.log(`    FAILED: ${error.message}`);
    } else {
      appliedCount++;
    }
  }

  console.log(
    APPLY
      ? `\nDone. ${appliedCount}/${plannedCount} name(s) updated${failedCount ? `, ${failedCount} FAILED` : ""}.`
      : `\nDry run complete. ${plannedCount} name(s) would be updated. Re-run with --apply to write.`
  );

  if (failedCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
