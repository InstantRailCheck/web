// One-time correction (post-v8.4.1 audit): resets every (bank, rail) pair
// where the stored value is `true` but a fresh matchInstitution call
// returns "ambiguous" back to null — "unconfirmed", not "not
// participating". This deliberately overrides resolveRailFlag's normal
// "never downgrade an already-true value" rule, which assumes an
// existing true value was legitimately confirmed at some point; this
// script exists specifically for the case audit-duplicate-name-rail-flags.mjs
// found where that assumption no longer holds — the flag can no longer be
// attributed to this specific charter now that a sibling with the same
// name exists in the duplicate-name group (most were set before that
// sibling existed, or before duplicate-safe matching existed at all).
//
// Recomputes the match fresh at correction time rather than trusting a
// prior audit JSON snapshot, in case production has changed since that
// audit ran. Only ever touches a field going true -> null; never sets
// true -> false, never touches a field that isn't currently true, and
// never touches a bank outside a duplicate-name group. Dry-run by
// default; --apply to write.
import { createClient } from "@supabase/supabase-js";
import { matchInstitution } from "../lib/railParticipationMatch.ts";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RAILS = [
  { key: "fednow_participant", table: "fednow_participants", locationFields: "city_state" },
  { key: "rtp_participant", table: "rtp_participants", locationFields: "state" },
  { key: "zelle_participant", table: "zelle_participants", locationFields: "none" },
];

function normalizeForSearch(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchAllRows(table, columns, orderBy) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log(APPLY ? "Running in APPLY mode — will write to production.\n" : "Running in DRY-RUN mode (pass --apply to write).\n");

  console.log("Loading banks and participant lists...");
  const [banks, fednowRows, rtpRows, zelleRows] = await Promise.all([
    fetchAllRows(
      "banks",
      "id, slug, name, name_normalized, city, state, fednow_participant, rtp_participant, zelle_participant",
      "id"
    ),
    fetchAllRows("fednow_participants", "search_name, city, state", "id"),
    fetchAllRows("rtp_participants", "search_name, state", "id"),
    fetchAllRows("zelle_participants", "search_name", "id"),
  ]);

  const candidatesByRail = {
    fednow_participant: fednowRows.map((r) => ({ searchName: r.search_name, city: r.city, state: r.state })),
    rtp_participant: rtpRows.map((r) => ({ searchName: r.search_name, state: r.state })),
    zelle_participant: zelleRows.map((r) => ({ searchName: r.search_name })),
  };

  const groups = new Map();
  for (const bank of banks) {
    const key = bank.name_normalized ?? normalizeForSearch(bank.name);
    const list = groups.get(key) ?? [];
    list.push(bank);
    groups.set(key, list);
  }
  const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);

  let plannedCount = 0;
  let appliedCount = 0;
  let failedCount = 0;

  for (const group of duplicateGroups) {
    const siblingLocations = group.map((b) => ({ city: b.city, state: b.state }));

    for (const bank of group) {
      const updates = {};
      for (const rail of RAILS) {
        if (!bank[rail.key]) continue;
        const result = matchInstitution(bank, siblingLocations, candidatesByRail[rail.key], rail.locationFields);
        if (result === "ambiguous") updates[rail.key] = null;
      }

      if (Object.keys(updates).length === 0) continue;

      plannedCount += Object.keys(updates).length;
      console.log(`- ${bank.slug}: ${Object.keys(updates).map((k) => `${k} true -> null`).join(", ")}`);

      if (!APPLY) continue;

      const { error } = await supabase.from("banks").update(updates).eq("id", bank.id);
      if (error) {
        failedCount += Object.keys(updates).length;
        console.log(`    FAILED: ${error.message}`);
      } else {
        appliedCount += Object.keys(updates).length;
      }
    }
  }

  console.log(
    APPLY
      ? `\nDone. ${appliedCount}/${plannedCount} field correction(s) applied${failedCount ? `, ${failedCount} FAILED` : ""}.`
      : `\nDry run complete. ${plannedCount} field correction(s) would be applied. Re-run with --apply to write.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
