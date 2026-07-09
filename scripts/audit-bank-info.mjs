import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Read-only audit: for every bank, look up the current official record
// (FDIC, then NCUA, then FINRA as a last-resort fallback for brokerages)
// and print a diff against what's actually stored. Nothing is written —
// a stored value that disagrees with the source could be a deliberate
// manual correction (like SoFi's Zelle flag) rather than staleness, so
// deciding which is right is a human call, not something to auto-apply.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const AMBIGUOUS = Symbol("ambiguous");

function recordKey(record) {
  return JSON.stringify(record);
}

function addToMap(map, rawKey, record) {
  const key = rawKey.replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  if (!map.has(key)) {
    map.set(key, record);
    return;
  }
  const existing = map.get(key);
  if (existing !== AMBIGUOUS && recordKey(existing) !== recordKey(record)) {
    map.set(key, AMBIGUOUS);
  }
}

// Same word-boundary + uniqueness-of-1 approach used throughout this
// project (see backfill-bank-assets.mjs) — a name that resolves to 2+
// distinct real institutions is ambiguous, not a match, so it's skipped
// rather than risk comparing against the wrong one.
function matchInMap(name, map) {
  const words = name.replace(/[.,]/g, "").trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidate = words.slice(0, i).join(" ").toLowerCase().trim();

    if (map.has(candidate)) {
      const value = map.get(candidate);
      if (value !== AMBIGUOUS) return value;
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
        matches.add(recordKey(value));
      }
      if (!ambiguousHit && matches.size === 1) {
        for (const [key, value] of map) {
          if (boundary.test(key) && value !== AMBIGUOUS) return value;
        }
      }
    }
  }
  return null;
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

function normalizeWebsite(url) {
  if (!url) return null;
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/\D/g, "");
}

function normalizeAddress(address) {
  if (!address) return null;
  return address.toLowerCase().replace(/\s+/g, " ").trim();
}

async function fetchAllFdicRecords() {
  const pageSize = 1000;
  const map = new Map();
  for (let offset = 0; ; offset += pageSize) {
    // sort_by must be explicit — FDIC's default pagination order isn't
    // stable across requests, which silently drops institutions between
    // offset pages (see backfill-bank-assets.mjs for how this was found).
    const res = await fetch(
      `https://api.fdic.gov/banks/institutions?filters=ACTIVE:1&fields=NAME,WEBADDR,ADDRESS,CITY,STALP,ZIP&sort_by=CERT&sort_order=ASC&limit=${pageSize}&offset=${offset}`
    );
    if (!res.ok) throw new Error(`FDIC fetch failed: ${res.status}`);
    const json = await res.json();
    const rows = (json.data ?? []).map((d) => d.data);
    for (const row of rows) {
      if (!row.NAME) continue;
      const website = row.WEBADDR ? (row.WEBADDR.startsWith("http") ? row.WEBADDR : `https://${row.WEBADDR}`) : null;
      const address = row.ADDRESS ? [row.ADDRESS, row.CITY, row.STALP, row.ZIP].filter(Boolean).join(", ") : null;
      addToMap(map, row.NAME.toLowerCase().trim(), { website, address, phone: null });
    }
    if (rows.length < pageSize) break;
  }
  return map;
}

async function fetchAllNcuaRecords() {
  const rows = await fetchAllRows("ncua_credit_unions", "search_names, website, address, phone", "charter_number");
  const map = new Map();
  for (const row of rows) {
    const record = { website: row.website, address: row.address, phone: row.phone };
    for (const alias of row.search_names ?? []) {
      addToMap(map, alias, record);
    }
  }
  return map;
}

function diffField(field, stored, fresh, normalize) {
  const normStored = normalize(stored);
  const normFresh = normalize(fresh);
  if (!normFresh) return null; // nothing to compare against
  if (normStored === normFresh) return null; // matches
  if (!stored) return { field, kind: "MISSING", stored, fresh };
  return { field, kind: "MISMATCH", stored, fresh };
}

async function main() {
  console.log("Loading FDIC institutions...");
  const fdicMap = await fetchAllFdicRecords();
  console.log(`Loaded ${fdicMap.size} FDIC institutions.`);

  console.log("Loading NCUA credit unions...");
  const ncuaMap = await fetchAllNcuaRecords();
  console.log(`Loaded ${ncuaMap.size} NCUA name aliases.`);

  console.log("Loading banks...");
  const banks = await fetchAllRows("banks", "id, name, website, address, phone", "id");
  console.log(`Loaded ${banks.length} banks.\n`);

  let mismatchCount = 0;
  let missingCount = 0;
  let noSourceCount = 0;

  for (const bank of banks) {
    const isCreditUnion = bank.name.toLowerCase().includes("credit union");
    const stripped = bank.name.replace(/\s+credit union$/i, "").trim();

    // Deliberately no cross-source fallback here (unlike
    // backfill-bank-assets.mjs's BECU/WSECU handling) — this audit only
    // trusts a match from the source that's actually authoritative for that
    // institution type. A "Bank" whose name doesn't resolve in FDIC's data
    // has no business being compared against NCUA's credit union records
    // just because the name also happens to loosely match one; that's how
    // "Five Star Bank" got compared against an unrelated credit union's
    // website during testing. FINRA is dropped entirely for the same
    // reason — its search is fuzzy with no bulk dataset to cross-check
    // ambiguity against, so it can't support the same rigor.
    const source = isCreditUnion ? matchInMap(stripped, ncuaMap) : matchInMap(bank.name, fdicMap);
    const sourceLabel = isCreditUnion ? "NCUA" : "FDIC";

    if (!source) {
      noSourceCount++;
      continue;
    }

    const diffs = [
      diffField("website", bank.website, source.website, normalizeWebsite),
      diffField("address", bank.address, source.address, normalizeAddress),
      diffField("phone", bank.phone, source.phone, normalizePhone),
    ].filter(Boolean);

    if (diffs.length === 0) continue;

    console.log(`${bank.name} (source: ${sourceLabel})`);
    for (const d of diffs) {
      console.log(`  [${d.kind}] ${d.field}: "${d.stored ?? ""}" -> "${d.fresh}"`);
      if (d.kind === "MISMATCH") mismatchCount++;
      else missingCount++;
    }
    console.log("");
  }

  console.log("--- Summary ---");
  console.log(`Banks checked: ${banks.length}`);
  console.log(`No confident source match: ${noSourceCount}`);
  console.log(`Fields with a mismatch (source disagrees with stored): ${mismatchCount}`);
  console.log(`Fields missing (source has data, stored is blank): ${missingCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
