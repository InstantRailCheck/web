import { createClient } from "@supabase/supabase-js";
import { slugify, uniqueSlug } from "../lib/slugify.ts";
import { computeAkaNamesFromSearchNames } from "./lib/bankAkaNames.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LIMIT = Number(process.argv[2]) || Infinity;

function titleCase(name) {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function matchesTable(table, name) {
  // Strip commas/periods before splitting — see the FDIC import script for
  // why (legal-name commas otherwise stick to a truncated candidate word).
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

async function fetchAll(table, columns, orderBy) {
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
  console.log("Loading synced NCUA credit unions...");
  // Supabase caps a single select() at 1000 rows by default — the table has
  // 4,336, so this must be paginated with .range() or it silently truncates.
  const creditUnions = await fetchAll("ncua_credit_unions", "charter_number, name, website, address, phone, search_names", "charter_number");
  const candidates = creditUnions.slice(0, LIMIT);
  console.log(`Loaded ${candidates.length} credit unions.`);

  console.log("Loading existing banks for dedup and slug collision checks...");
  // Same 1000-row cap applies here — banks now has 1000+ rows too.
  const existingBanks = await fetchAll("banks", "id, name, website, slug", "id");

  const existingWebsites = new Set(
    existingBanks.filter((b) => b.website).map((b) => normalizeWebsite(b.website))
  );
  const usedSlugs = new Set(existingBanks.map((b) => b.slug));
  const usedNames = new Set(existingBanks.map((b) => b.name));

  const toInsert = [];
  let skippedDupes = 0;
  let skippedNameCollisions = 0;

  for (const c of candidates) {
    const normalized = normalizeWebsite(c.website);

    if (normalized && existingWebsites.has(normalized)) {
      skippedDupes++;
      continue;
    }

    // NCUA's raw name field is the bare trade name with no institutional
    // suffix ("WOODMEN", "CAMPUS") for the vast majority of charters — only
    // ~2% already say "credit union" anywhere. Keep the pre-suffix, title-cased
    // name for rail-participation matching (matchesTable's floor stops at 2
    // words, so a mechanically-appended 2-word suffix on an already-short name
    // would push the true distinguishing word out of reach — the same class of
    // bug the FDIC-import comma fix addressed), and only add the suffix for display.
    const baseName = titleCase(c.name.trim());
    const displayName = /credit union/i.test(baseName) ? baseName : `${baseName} Credit Union`;

    // banks.name has a unique constraint; keep the first-seen charter and
    // drop subsequent collisions rather than fail the batch.
    if (usedNames.has(displayName)) {
      skippedNameCollisions++;
      continue;
    }
    usedNames.add(displayName);

    const baseSlug = slugify(displayName);
    const slug = uniqueSlug(baseSlug, usedSlugs);
    usedSlugs.add(slug);
    if (normalized) existingWebsites.add(normalized);

    toInsert.push({
      name: displayName,
      matchName: baseName,
      slug,
      website: c.website,
      address: c.address,
      phone: c.phone,
      ncua_charter_number: Number(c.charter_number),
      aka_names: computeAkaNamesFromSearchNames(displayName, c.search_names),
    });
  }

  console.log(`Skipped ${skippedDupes} already-present credit unions (matched by website).`);
  console.log(`Skipped ${skippedNameCollisions} credit unions with a duplicate display name (kept the first charter seen).`);
  console.log(`Inserting ${toInsert.length} new credit unions...`);

  const inserted = [];
  const chunkSize = 100;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize).map(({ matchName, ...row }) => row);
    const matchNames = toInsert.slice(i, i + chunkSize).map((row) => row.matchName);
    const { data, error } = await supabase.from("banks").insert(chunk).select("id, name");
    if (error) throw error;
    data.forEach((row, idx) => inserted.push({ ...row, matchName: matchNames[idx] }));
    console.log(`  inserted ${Math.min(i + chunkSize, toInsert.length)}/${toInsert.length}`);
  }

  console.log("Checking rail participation for newly inserted credit unions...");
  let processed = 0;
  for (const cu of inserted) {
    const [fednow, rtp, zelle] = await Promise.all([
      matchesTable("fednow_participants", cu.matchName),
      matchesTable("rtp_participants", cu.matchName),
      matchesTable("zelle_participants", cu.matchName),
    ]);

    await supabase
      .from("banks")
      .update({ fednow_participant: fednow, rtp_participant: rtp, zelle_participant: zelle })
      .eq("id", cu.id);

    processed++;
    if (processed % 100 === 0) console.log(`  rail-checked ${processed}/${inserted.length}`);
  }

  console.log(`Done. Inserted ${inserted.length} credit unions, skipped ${skippedDupes} duplicates.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
