import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sentinel marking a name that resolves to 2+ distinct real-world
// institutions with genuinely different asset totals (e.g. "United Bank" is
// 4 unrelated FDIC charters). A plain Map<name, value> would silently keep
// whichever one was inserted last — defeating the whole point of this
// project's ambiguous-match-means-no-match rule. Building the map this way
// makes that collision impossible to miss downstream.
const AMBIGUOUS = Symbol("ambiguous");

function addToMap(map, rawKey, value) {
  // Strip commas/periods identically to matchInMap's candidate normalization
  // — otherwise "Capital One, National Association" (candidate, comma
  // stripped) can never match a map key stored as "capital one, national
  // association" (comma intact), failing both the exact and boundary checks
  // even though they're the same institution.
  // Collapse whitespace too, not just commas/periods — FDIC's own source
  // data contains literal double spaces in some names ("Frost  Bank",
  // "Univest  Bank and Trust Co."), and matchInMap's candidates are always
  // rejoined with single spaces, so an unnormalized key silently never
  // matches even the exact same institution.
  const key = rawKey.replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  if (!map.has(key)) {
    map.set(key, value);
    return;
  }
  const existing = map.get(key);
  if (existing !== AMBIGUOUS && existing !== value) map.set(key, AMBIGUOUS);
}

// Same word-boundary + uniqueness-of-1 approach already proven for rail
// participation matching (see lib/railParticipation.ts) — a truncated
// candidate or a substring match against multiple distinct institutions is
// ambiguous, not a match. Adapted here for an in-memory name->value map
// instead of DB queries, since we're matching against thousands of FDIC
// institutions per bank and a DB round-trip per candidate would be too slow.
function matchInMap(name, map) {
  const words = name.replace(/[.,]/g, "").trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidate = words.slice(0, i).join(" ").toLowerCase().trim();

    if (map.has(candidate)) {
      const value = map.get(candidate);
      if (value !== AMBIGUOUS) return value;
      // The untruncated name itself is ambiguous — truncating further can
      // only match a superset of institutions, never disambiguate, so bail.
      if (i === words.length) return null;
    }

    if (i === words.length) {
      const boundary = new RegExp(`\\b${escapeRegex(candidate)}\\b`, "i");
      const matches = new Set();
      let ambiguousHit = false;
      for (const [key, value] of map) {
        if (!boundary.test(key)) continue;
        if (value === AMBIGUOUS) {
          ambiguousHit = true;
          continue;
        }
        matches.add(value);
      }
      if (!ambiguousHit && matches.size === 1) return [...matches][0];
    }
  }
  return null;
}

async function fetchAllBanks() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, name, total_assets")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchAllNcua() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("ncua_credit_unions")
      .select("search_names, total_assets")
      .not("total_assets", "is", null)
      .order("charter_number", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchAllFdicAssets() {
  const pageSize = 1000;
  const map = new Map();
  for (let offset = 0; ; offset += pageSize) {
    // sort_by/sort_order must be explicit — without a stable sort, FDIC's
    // API pagination order isn't guaranteed consistent between requests,
    // which silently drops institutions between offset pages (verified:
    // omitting this returned only 3739 of 4262 active institutions).
    const res = await fetch(
      `https://api.fdic.gov/banks/institutions?filters=ACTIVE:1&fields=NAME,ASSET&sort_by=CERT&sort_order=ASC&limit=${pageSize}&offset=${offset}`
    );
    if (!res.ok) throw new Error(`FDIC fetch failed: ${res.status}`);
    const json = await res.json();
    const rows = (json.data ?? []).map((d) => d.data);
    for (const row of rows) {
      if (row.NAME && row.ASSET) {
        // FDIC's ASSET field is reported in thousands of dollars.
        addToMap(map, row.NAME.toLowerCase().trim(), Math.round(row.ASSET * 1000));
      }
    }
    if (rows.length < pageSize) break;
  }
  return map;
}

async function main() {
  console.log("Fetching all banks...");
  const banks = await fetchAllBanks();
  console.log(`Loaded ${banks.length} banks.`);

  console.log("Fetching NCUA credit union assets...");
  const ncuaRows = await fetchAllNcua();
  const ncuaMap = new Map();
  for (const row of ncuaRows) {
    for (const alias of row.search_names ?? []) {
      addToMap(ncuaMap, alias, row.total_assets);
    }
  }
  console.log(`Loaded ${ncuaRows.length} credit unions (${ncuaMap.size} name aliases).`);

  console.log("Fetching FDIC bank assets...");
  const fdicMap = await fetchAllFdicAssets();
  console.log(`Loaded ${fdicMap.size} FDIC institutions.`);

  let matched = 0;
  let unmatched = 0;
  let cleared = 0;
  let processed = 0;
  for (const bank of banks) {
    const isCreditUnion = bank.name.toLowerCase().includes("credit union");
    const stripped = bank.name.replace(/\s+credit union$/i, "").trim();

    // The "credit union" substring check is just a heuristic for which
    // source to try first — some real credit unions go by an acronym with
    // no literal "credit union" in the name (e.g. "BECU", "WSECU"), so if
    // the guessed source comes up empty, try the other one too. Safe to do
    // unconditionally: matchInMap already refuses ambiguous/multi-hit
    // results, so this can only ever recover a genuinely unique match, not
    // introduce a wrong one.
    const assets = isCreditUnion
      ? matchInMap(stripped, ncuaMap) ?? matchInMap(bank.name, fdicMap)
      : matchInMap(bank.name, fdicMap) ?? matchInMap(stripped, ncuaMap);

    if (assets) {
      matched++;
      // Only write when the value actually needs to change — avoids
      // touching rows that are already correct on a re-run.
      if (bank.total_assets !== assets) {
        await supabase.from("banks").update({ total_assets: assets }).eq("id", bank.id);
      }
    } else {
      unmatched++;
      // Clear stale values left over from an earlier, buggier version of
      // this script (e.g. a name that used to resolve to an arbitrary
      // institution via a since-fixed matching bug, but is now correctly
      // recognized as ambiguous). Blank over wrong.
      if (bank.total_assets !== null) {
        await supabase.from("banks").update({ total_assets: null }).eq("id", bank.id);
        cleared++;
      }
    }

    processed++;
    if (processed % 500 === 0) {
      console.log(`  processed ${processed}/${banks.length} (matched ${matched}, cleared ${cleared} stale)`);
    }
  }

  console.log(`Done. Matched ${matched}/${banks.length} banks, ${unmatched} left blank, ${cleared} stale values cleared.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
