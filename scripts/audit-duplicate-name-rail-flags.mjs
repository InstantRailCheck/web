// Read-only. Reports, for every duplicate-name group, which rail flags are
// set on more than one member — the exact failure mode the old name-only
// matching (pre-v8.0 §1) could produce: one matching participant-list name
// independently setting a flag on every bank sharing that name, regardless
// of which specific charter actually participates. Never auto-corrects —
// per this project's "blank over wrong" rule, a human reviews each
// flagged group and decides (via the admin console or a direct, reviewed
// UPDATE) which member(s), if any, should keep the flag.
//
// Run both before any v8.0 import (confirms this tool works against real
// data) and again immediately after the first real import (rollout step
// 9), per the plan.
import { createClient } from "@supabase/supabase-js";

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
      .select("id, slug, name, name_normalized, city, state, fednow_participant, rtp_participant, zelle_participant")
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

  const groups = new Map();
  for (const bank of banks) {
    const key = bank.name_normalized ?? bank.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const list = groups.get(key) ?? [];
    list.push(bank);
    groups.set(key, list);
  }

  const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  console.log(`${duplicateGroups.length} duplicate-name group(s) found (${banks.length} banks total).`);

  let flaggedGroups = 0;
  for (const group of duplicateGroups) {
    const rails = ["fednow_participant", "rtp_participant", "zelle_participant"];
    const flaggedRails = rails.filter((rail) => group.filter((b) => b[rail]).length > 1);

    if (flaggedRails.length === 0) continue;

    flaggedGroups++;
    console.log(`\n"${group[0].name}" (${group.length} charters) — needs review:`);
    for (const rail of flaggedRails) {
      const members = group.filter((b) => b[rail]);
      console.log(`  ${rail}: set on ${members.length}/${group.length} members`);
      for (const m of members) {
        console.log(`    - ${m.slug} (${m.city ?? "?"}, ${m.state ?? "?"})`);
      }
    }
  }

  console.log(`\nDone. ${flaggedGroups}/${duplicateGroups.length} duplicate-name group(s) need manual review.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
