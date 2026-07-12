import { createClient } from "@supabase/supabase-js";
import { slugify, uniqueSlug } from "../lib/slugify.ts";
import { extractFdicAkaNames } from "./lib/bankAkaNames.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TOP_N = Number(process.argv[2]) || 500;

function normalizeWebsite(url) {
  if (!url) return null;
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function matchesTable(table, name) {
  // Strip commas/periods before splitting — legal names like "Capital One,
  // National Association" otherwise leave a trailing comma stuck to the
  // last word of a truncated candidate ("capital one,"), which matches
  // neither an exact nor an ilike lookup against a clean "capital one" row.
  const words = name.replace(/[.,]/g, "").trim().split(/\s+/);
  const floor = Math.min(2, words.length);
  for (let i = words.length; i >= floor; i--) {
    const candidate = words.slice(0, i).join(" ").toLowerCase().trim();
    const { data: exact } = await supabase.from(table).select("id").eq("search_name", candidate).limit(1).maybeSingle();
    if (exact) return true;
    // ilike is only tried on the complete, untruncated name, and only
    // trusted if it hits exactly one distinct whole-word-boundary match —
    // see lib/railParticipation.ts for the full reasoning (character-level
    // accidental substrings and generic-word ambiguity).
    if (i === words.length) {
      const { data: partial } = await supabase.from(table).select("search_name").ilike("search_name", `%${candidate}%`);
      if (partial && partial.length > 0) {
        const boundary = new RegExp(`\\b${escapeRegex(candidate)}\\b`, "i");
        const distinct = new Set(partial.filter((row) => boundary.test(row.search_name)).map((row) => row.search_name));
        if (distinct.size === 1) return true;
      }
    }
  }
  return false;
}

async function fetchAllBanks() {
  // Supabase caps a single select() at 1000 rows by default — banks now has
  // 1000+, so this must be paginated with .range() or it silently truncates.
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, name, website, slug")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

// TE01N529 through TE10N529 are FDIC's trade/DBA name slots (paired with a
// TE0{n}N528 website field this doesn't need) - most banks have none
// populated, but multi-brand ones do (e.g. Chase's record lists "Chase",
// "J.P.Morgan", "JPMorgan Chase" here). CERT is needed so future re-checks
// can look a bank back up directly instead of matching by name again.
const TRADE_NAME_FIELDS = Array.from({ length: 10 }, (_, i) => `TE${String(i + 1).padStart(2, "0")}N529`).join(",");

async function main() {
  console.log(`Fetching top ${TOP_N} active FDIC banks by asset size...`);
  const res = await fetch(
    `https://api.fdic.gov/banks/institutions?filters=ACTIVE:1&fields=NAME,WEBADDR,ADDRESS,CITY,STALP,ZIP,ASSET,CERT,${TRADE_NAME_FIELDS}&sort_by=ASSET&sort_order=DESC&limit=${TOP_N}&offset=0`
  );
  if (!res.ok) throw new Error(`FDIC fetch failed: ${res.status}`);
  const json = await res.json();
  const candidates = (json.data ?? []).map((d) => d.data);
  console.log(`Fetched ${candidates.length} candidates.`);

  console.log("Loading existing banks for dedup and slug collision checks...");
  const existingBanks = await fetchAllBanks();

  const existingWebsites = new Set(
    existingBanks.filter((b) => b.website).map((b) => normalizeWebsite(b.website))
  );
  const usedSlugs = new Set(existingBanks.map((b) => b.slug));
  const usedNames = new Set(existingBanks.map((b) => b.name));

  const toInsert = [];
  let skippedDupes = 0;
  let skippedNameCollisions = 0;

  for (const c of candidates) {
    const website = c.WEBADDR ? (c.WEBADDR.startsWith("http") ? c.WEBADDR : `https://${c.WEBADDR}`) : null;
    const normalized = normalizeWebsite(website);

    if (normalized && existingWebsites.has(normalized)) {
      skippedDupes++;
      continue;
    }

    // banks.name has a unique constraint, and the FDIC data itself has
    // distinct institutions that legally share the same name (e.g. two
    // separate charters both named "FirstBank"). Keep the higher-asset
    // one (candidates are already sorted by asset descending) and drop
    // the rest rather than fail the batch.
    if (usedNames.has(c.NAME)) {
      skippedNameCollisions++;
      continue;
    }
    usedNames.add(c.NAME);

    const baseSlug = slugify(c.NAME);
    const slug = uniqueSlug(baseSlug, usedSlugs);
    usedSlugs.add(slug);
    if (normalized) existingWebsites.add(normalized);

    const address = c.ADDRESS ? [c.ADDRESS, c.CITY, c.STALP, c.ZIP].filter(Boolean).join(", ") : null;

    const akaNames = extractFdicAkaNames(c, c.NAME);

    toInsert.push({
      name: c.NAME,
      slug,
      website,
      address,
      phone: null,
      fdic_cert: c.CERT ?? null,
      aka_names: akaNames.length > 0 ? akaNames : null,
    });
  }

  console.log(`Skipped ${skippedDupes} already-present banks (matched by website).`);
  console.log(`Skipped ${skippedNameCollisions} banks with a duplicate legal name (kept the higher-asset one).`);
  console.log(`Inserting ${toInsert.length} new banks...`);

  const inserted = [];
  const chunkSize = 100;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { data, error } = await supabase.from("banks").insert(chunk).select("id, name");
    if (error) throw error;
    inserted.push(...data);
    console.log(`  inserted ${Math.min(i + chunkSize, toInsert.length)}/${toInsert.length}`);
  }

  console.log("Checking rail participation for newly inserted banks...");
  let processed = 0;
  for (const bank of inserted) {
    const [fednow, rtp, zelle] = await Promise.all([
      matchesTable("fednow_participants", bank.name),
      matchesTable("rtp_participants", bank.name),
      matchesTable("zelle_participants", bank.name),
    ]);

    await supabase
      .from("banks")
      .update({ fednow_participant: fednow, rtp_participant: rtp, zelle_participant: zelle })
      .eq("id", bank.id);

    processed++;
    if (processed % 50 === 0) console.log(`  rail-checked ${processed}/${inserted.length}`);
  }

  console.log(`Done. Inserted ${inserted.length} banks, skipped ${skippedDupes} duplicates.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
