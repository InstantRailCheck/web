// FDIC-side counterpart to backfill-bank-aka-names-ncua.mjs, for banks
// imported before aka_names/fdic_cert existed. Unlike the NCUA case, FDIC
// data isn't mirrored locally, so this re-queries FDIC's API by name (same
// word-truncation approach as backfill-bank-info.mjs's lookupFdicBank) -
// only for banks not already linked to either source, so it never re-checks
// credit unions or banks a previous run already matched.
import { createClient } from "@supabase/supabase-js";
import { extractFdicAkaNames, pickFdicMatch } from "./lib/bankAkaNames.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TRADE_NAME_FIELDS = Array.from({ length: 10 }, (_, i) => `TE${String(i + 1).padStart(2, "0")}N529`).join(",");

function quoteIfNeeded(name) {
  return name.includes(" ") ? `"${name}"` : name;
}

async function searchFdic(name) {
  const url = `https://api.fdic.gov/banks/institutions?search=${encodeURIComponent(
    `NAME:${quoteIfNeeded(name)}`
  )}&filters=ACTIVE:1&fields=NAME,ASSET,CERT,${TRADE_NAME_FIELDS}&sort_by=ASSET&sort_order=DESC&limit=5`;

  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []).map((d) => d.data);
}

async function lookupFdicMatch(name) {
  // Strip commas/periods before splitting — legal names like "Fifth Third
  // Bank, National Association" otherwise leave a trailing comma stuck to
  // the last word of a truncated candidate.
  const words = name.replace(/[.,]/g, "").trim().split(/\s+/);
  // Floor of 3, not 2: a bare 2-word candidate (often just a city/region
  // name, e.g. "Long Beach" truncated from "Long Beach Teachers Credit
  // Union") can still pass the word-boundary + uniqueness check by
  // coincidentally being the only FDIC-regulated bank with that location in
  // its name — real, but a false positive, since a shared place name isn't
  // evidence of being the same institution. Confirmed live: this exact
  // pattern silently matched several credit unions to an unrelated bank
  // before this floor was raised.
  const floor = Math.min(3, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidate = words.slice(0, i).join(" ");
    const candidates = await searchFdic(candidate);
    const match = pickFdicMatch(candidates, candidate);
    if (match) return match;
  }
  return null;
}

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
  console.log("Loading banks not yet linked to a source (NCUA or FDIC)...");
  const banks = await fetchAll("banks", "id, name, ncua_charter_number, fdic_cert");
  // Credit unions are never FDIC-member institutions - one that reached this
  // point failed to match NCUA's website-based join for some other reason
  // (no website on file, a mismatched website, etc.), not because it's
  // secretly FDIC-regulated. Querying FDIC for one can only ever produce a
  // false positive, never a real match - live-confirmed (several credit
  // unions got a wrong fdic_cert/aka_names from exactly this before being
  // excluded here).
  const candidates = banks.filter(
    (b) => !b.ncua_charter_number && !b.fdic_cert && !/credit union/i.test(b.name)
  );
  console.log(
    `${candidates.length} of ${banks.length} bank(s) need an FDIC check (excluding already-linked and credit-union-named banks).`
  );

  let linked = 0;
  let withAka = 0;
  let noMatch = 0;

  for (const bank of candidates) {
    const match = await lookupFdicMatch(bank.name);
    if (!match) {
      noMatch++;
      continue;
    }

    const akaNames = extractFdicAkaNames(match, bank.name);
    const { error } = await supabase
      .from("banks")
      .update({ fdic_cert: match.CERT ?? null, aka_names: akaNames.length > 0 ? akaNames : null })
      .eq("id", bank.id);

    if (error) {
      console.log(`- ${bank.name}: update failed - ${error.message}`);
      continue;
    }
    linked++;
    if (akaNames.length > 0) withAka++;
  }

  console.log(
    `Done. Linked ${linked} bank(s) to an FDIC record (${withAka} had at least one trade name), ${noMatch} had no FDIC match (likely a brokerage or already-covered credit union).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
