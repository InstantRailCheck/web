import { createClient } from "@supabase/supabase-js";
import { matchInstitution, resolveRailFlag } from "../lib/railParticipationMatch.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Matches lib/utils.ts's normalizeForSearch exactly — not imported directly
// because lib/utils.ts pulls in other modules via the "@/" path alias,
// which plain Node (no bundler) can't resolve the way
// lib/railParticipationMatch.ts (zero dependencies) can. Deliberately
// recomputed from `name` here rather than read from banks.name_normalized —
// that generated column bakes in aka_names for fuzzy search, which would
// silently split one real duplicate-name group into two whenever only one
// sibling has aliases attached.
function normalizeForSearch(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchAllRows(table, columns, orderBy) {
  // Supabase caps a single select() at 1000 rows by default.
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
  console.log("Loading participant lists and banks...");
  const [fednowRows, rtpRows, zelleRows, banks] = await Promise.all([
    fetchAllRows("fednow_participants", "search_name, city, state", "id"),
    fetchAllRows("rtp_participants", "search_name, state", "id"),
    fetchAllRows("zelle_participants", "search_name", "id"),
    fetchAllRows(
      "banks",
      "id, name, city, state, is_active, fednow_participant, rtp_participant, zelle_participant",
      "id"
    ),
  ]);

  const fednowCandidates = fednowRows.map((r) => ({ searchName: r.search_name, city: r.city, state: r.state }));
  const rtpCandidates = rtpRows.map((r) => ({ searchName: r.search_name, state: r.state }));
  const zelleCandidates = zelleRows.map((r) => ({ searchName: r.search_name }));

  // Every ACTIVE bank sharing a normalized name is a duplicate-name group
  // of its own siblings, including itself — computed once for the whole
  // batch rather than once per bank per rail. An inactive/merged bank is
  // excluded here so it can never manufacture false ambiguity for an
  // active sibling's uniqueness-within-group check.
  // Always computed from `name` alone, never bank.name_normalized — that
  // column bakes in aka_names for fuzzy search, so a bank carrying aliases
  // would group under a different key than a same-named sibling without
  // aliases, silently splitting one real duplicate-name group into two
  // (discovered while fixing the same root cause elsewhere post-v8.14.5).
  const siblingsByNormalizedName = new Map();
  for (const bank of banks) {
    if (!bank.is_active) continue;
    const key = normalizeForSearch(bank.name);
    const list = siblingsByNormalizedName.get(key) ?? [];
    list.push({ city: bank.city, state: bank.state });
    siblingsByNormalizedName.set(key, list);
  }

  console.log(`Processing ${banks.length} bank(s).`);

  let updated = 0;
  let ambiguous = 0;
  for (const bank of banks) {
    const siblingLocations = siblingsByNormalizedName.get(normalizeForSearch(bank.name)) ?? [bank];

    const fednowResult = matchInstitution(bank, siblingLocations, fednowCandidates, "city_state");
    const rtpResult = matchInstitution(bank, siblingLocations, rtpCandidates, "state");
    const zelleResult = matchInstitution(bank, siblingLocations, zelleCandidates, "none");

    if (fednowResult === "ambiguous" || rtpResult === "ambiguous" || zelleResult === "ambiguous") {
      ambiguous++;
    }

    const fednow = resolveRailFlag(bank.fednow_participant, fednowResult);
    const rtp = resolveRailFlag(bank.rtp_participant, rtpResult);
    const zelle = resolveRailFlag(bank.zelle_participant, zelleResult);

    if (
      fednow === bank.fednow_participant &&
      rtp === bank.rtp_participant &&
      zelle === bank.zelle_participant
    ) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("banks")
      .update({ fednow_participant: fednow, rtp_participant: rtp, zelle_participant: zelle })
      .eq("id", bank.id);

    if (updateError) {
      console.log(`- ${bank.name}: update failed — ${updateError.message}`);
    } else {
      updated++;
      console.log(`- ${bank.name}: FedNow=${fednow} RTP=${rtp} Zelle=${zelle}`);
    }
  }

  console.log(`Done. Updated ${updated}/${banks.length} bank(s). ${ambiguous} bank(s) had at least one ambiguous (unresolved) rail match.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
