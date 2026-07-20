// Read-only. Rebuilt (post-v8.4.0 review) to use the real matchInstitution
// matcher instead of a "more than one true member" heuristic — the old
// version only caught a duplicate-name group where the flag ended up set
// on multiple members. That missed the more common failure mode: a group
// where exactly one member has a rail flag set to `true`, but running
// today's duplicate-safe matcher against that same bank now returns
// "ambiguous" (its location isn't unique within the group, or no
// candidate's location matches it) — meaning the *current* true flag can
// no longer be confirmed as belonging to that specific charter. Per this
// project's "ambiguous never confirms a flag" rule (v8.0 §1), a flag in
// that state was asserted with more confidence than the data actually
// supports, whichever process set it.
//
// This audit reports every (bank, rail) pair where the stored value is
// `true` and a fresh matchInstitution call returns "ambiguous" — even
// when that bank is the ONLY true member of its group — plus the source
// evidence (which participant-list rows name-matched) and recent
// bank_rail_history for that bank/rail, so a human reviewer has enough
// context to decide the outcome. It NEVER writes anything — clearing or
// confirming a flag is a separate, explicitly reviewed action, matching
// "blank over wrong."
//
// Run before any v8.0 import, again immediately after the first real
// import (rollout step 9), and again here after v8.4.0's review fix.
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchInstitution, findNameMatches } from "../lib/railParticipationMatch.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");

const RAILS = [
  { key: "fednow_participant", historyRail: "fednow", table: "fednow_participants", locationFields: "city_state" },
  { key: "rtp_participant", historyRail: "rtp", table: "rtp_participants", locationFields: "state" },
  { key: "zelle_participant", historyRail: "zelle", table: "zelle_participants", locationFields: "none" },
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

async function recentHistory(bankId, historyRail) {
  const { data, error } = await supabase
    .from("bank_rail_history")
    .select("old_value, new_value, changed_at")
    .eq("bank_id", bankId)
    .eq("rail", historyRail)
    .order("changed_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}

async function main() {
  console.log("Loading banks and participant lists...");
  const [banks, fednowRows, rtpRows, zelleRows] = await Promise.all([
    fetchAllRows(
      "banks",
      "id, slug, name, name_normalized, city, state, is_active, fednow_participant, rtp_participant, zelle_participant",
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

  // Inactive/merged banks are excluded from every group: a merged legacy
  // row must never manufacture false ambiguity for an active sibling's
  // uniqueness-within-group check, and its own (redirect-only) flags don't
  // need review either way.
  const groups = new Map();
  for (const bank of banks) {
    if (!bank.is_active) continue;
    const key = bank.name_normalized ?? normalizeForSearch(bank.name);
    const list = groups.get(key) ?? [];
    list.push(bank);
    groups.set(key, list);
  }
  const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  console.log(`${duplicateGroups.length} duplicate-name group(s) found (${banks.length} banks total).\n`);

  const flaggedGroups = [];
  let flaggedBankRailCount = 0;

  for (const group of duplicateGroups) {
    const siblingLocations = group.map((b) => ({ city: b.city, state: b.state }));

    // Supplementary context only, not the driving signal — a rail set on
    // multiple members can be entirely correct once each is independently
    // location-confirmed against a distinct candidate.
    const multiTrueRails = RAILS.map((rail) => {
      const members = group.filter((b) => b[rail.key]);
      return members.length > 1 ? { rail: rail.key, members: members.map((b) => b.slug) } : null;
    }).filter(Boolean);

    const groupFlags = [];
    for (const bank of group) {
      for (const rail of RAILS) {
        if (!bank[rail.key]) continue;

        const result = matchInstitution(bank, siblingLocations, candidatesByRail[rail.key], rail.locationFields);
        if (result !== "ambiguous") continue;

        flaggedBankRailCount++;
        const nameMatchedCandidates = findNameMatches(bank.name, candidatesByRail[rail.key]);
        const history = await recentHistory(bank.id, rail.historyRail);

        groupFlags.push({
          bankId: bank.id,
          bankSlug: bank.slug,
          bankCity: bank.city,
          bankState: bank.state,
          rail: rail.key,
          currentValue: true,
          freshMatchResult: result,
          sourceEvidence: { nameMatchedCandidates },
          recentHistory: history,
        });
      }
    }

    if (groupFlags.length === 0) continue;

    flaggedGroups.push({
      groupName: group[0].name,
      memberCount: group.length,
      members: group.map((b) => ({ id: b.id, slug: b.slug, city: b.city, state: b.state })),
      multiTrueRails,
      flags: groupFlags,
    });

    console.log(`"${group[0].name}" (${group.length} charters) — needs review:`);
    for (const flag of groupFlags) {
      console.log(
        `  ${flag.rail}: ${flag.bankSlug} (${flag.bankCity ?? "?"}, ${flag.bankState ?? "?"}) is TRUE but no longer unambiguously attributable`
      );
    }
    console.log("");
  }

  const auditedAt = new Date().toISOString();
  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `duplicate-name-rail-flags-audit-${auditedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        auditedAt,
        totalBanks: banks.length,
        duplicateGroupCount: duplicateGroups.length,
        flaggedGroupCount: flaggedGroups.length,
        flaggedBankRailCount,
        groups: flaggedGroups,
      },
      null,
      2
    )
  );

  console.log(
    `Done. ${flaggedGroups.length}/${duplicateGroups.length} duplicate-name group(s) contain a true-but-ambiguous rail flag ` +
      `(${flaggedBankRailCount} bank/rail pair(s) total).`
  );
  console.log(`Report written to ${reportPath}`);
  console.log("No changes were made — this script is read-only. Review the report before resolving any flag.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
