// Read-only. Reports what would change for every NCUA-linked bank's public
// aka_names once classifyAlias() (scripts/lib/bankAkaNames.mjs) is applied
// to NCUA's raw TradeNames-derived search_names — the fix for the real,
// confirmed ANECA data quirk (charter 3212's TradeNames row lists "morgan
// stanley"/"jp morgan" with no discoverable relationship to either
// company). Nothing is written here; scripts/backfill-ncua-derived-fields.mjs
// is the corresponding apply step, run only after this report is reviewed.
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAlias, computeAkaNamesFromSearchNames, deriveDomainInitialsAka, mergeAkaNames } from "./lib/bankAkaNames.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "reports");

function normalizedBlob(name, akaNames) {
  return (name + " " + (akaNames ?? []).join(" ")).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchAll(table, select) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(select).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log("Loading NCUA-linked banks and ncua_credit_unions...");
  const banks = await fetchAll("banks", "id, slug, name, website, aka_names, ncua_charter_number, name_normalized, is_active");
  const ncuaLinked = banks.filter((b) => b.ncua_charter_number !== null);

  const ncuaRows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("ncua_credit_unions")
      .select("charter_number, search_names")
      .order("charter_number", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    ncuaRows.push(...data);
    if (data.length < 1000) break;
  }
  const searchNamesByCharter = new Map(ncuaRows.map((r) => [r.charter_number, r.search_names ?? []]));

  console.log(`${ncuaLinked.length} NCUA-linked bank(s). ${ncuaLinked.filter((b) => b.aka_names?.length).length} currently carry a public aka_names value.\n`);

  const brandCollisions = [];
  const noLexicalRelation = [];
  const changedProfiles = [];
  // Cross-institution collision: does any current aka_names entry exactly
  // match another distinct, ACTIVE institution's own primary name or alias?
  // Inactive/merged banks are deliberately excluded here — the duplicate-
  // institution merge (v8.10.0) intentionally leaves an old, now-inactive
  // bank's own name identical to an alias it contributed to its surviving
  // twin, which is correct by design, not a collision worth flagging.
  const activeBanks = banks.filter((b) => b.is_active);
  const nameOwners = new Map(); // normalized name/alias -> [{id, name, kind}]
  for (const b of activeBanks) {
    const norm = b.name.toLowerCase().trim();
    if (!nameOwners.has(norm)) nameOwners.set(norm, []);
    nameOwners.get(norm).push({ id: b.id, name: b.name, kind: "primary" });
    for (const aka of b.aka_names ?? []) {
      const akaNorm = aka.toLowerCase().trim();
      if (!nameOwners.has(akaNorm)) nameOwners.set(akaNorm, []);
      nameOwners.get(akaNorm).push({ id: b.id, name: b.name, kind: "alias" });
    }
  }
  const crossInstitutionCollisions = [];
  for (const b of ncuaLinked) {
    if (!b.is_active) continue;
    for (const aka of b.aka_names ?? []) {
      const owners = (nameOwners.get(aka.toLowerCase().trim()) ?? []).filter((o) => o.id !== b.id);
      if (owners.length > 0) {
        crossInstitutionCollisions.push({ bank: { id: b.id, slug: b.slug, name: b.name }, alias: aka, collidesWith: owners });
      }
    }
  }

  for (const b of ncuaLinked) {
    const rawSearchNames = searchNamesByCharter.get(b.ncua_charter_number) ?? [];
    for (const candidate of rawSearchNames) {
      if (candidate.toLowerCase().trim() === b.name.toLowerCase().trim()) continue;
      const result = classifyAlias(b.name, candidate);
      if (result.safe) continue;
      const entry = { bank: { id: b.id, slug: b.slug, name: b.name }, alias: candidate, reason: result.reason };
      if (result.reason.startsWith("contains unrelated major-brand")) brandCollisions.push(entry);
      else noLexicalRelation.push(entry);
    }

    const ncuaAka = computeAkaNamesFromSearchNames(b.name, rawSearchNames);
    const domainAka = deriveDomainInitialsAka(b.name, b.website);
    const newAka = mergeAkaNames(ncuaAka, domainAka);
    const currentAka = b.aka_names ?? null;
    const changed = JSON.stringify((currentAka ?? []).slice().sort()) !== JSON.stringify((newAka ?? []).slice().sort());
    if (changed) {
      const stillCollides = (newAka ?? [])
        .map((aka) => ({ aka, owners: (nameOwners.get(aka.toLowerCase().trim()) ?? []).filter((o) => o.id !== b.id) }))
        .filter((r) => r.owners.length > 0);
      changedProfiles.push({
        bank: { id: b.id, slug: b.slug, name: b.name },
        currentAkaNames: currentAka,
        newAkaNames: newAka,
        currentNameNormalized: b.name_normalized,
        newNameNormalizedPreview: normalizedBlob(b.name, newAka),
        stillCollidesAfterFix: stillCollides.length > 0 ? stillCollides : undefined,
      });
    }
  }

  console.log(`Aliases rejected — unrelated major-brand term: ${brandCollisions.length}`);
  console.log(`Aliases rejected — no lexical relationship to primary name: ${noLexicalRelation.length}`);
  console.log(`Aliases that exactly collide with another institution's own name/alias: ${crossInstitutionCollisions.length}`);
  console.log(`NCUA-linked bank profiles whose public aka_names would change: ${changedProfiles.length}\n`);

  if (brandCollisions.length) {
    console.log("--- Unrelated major-brand collisions ---");
    for (const c of brandCollisions) console.log(`  ${c.bank.name} (${c.bank.slug}): "${c.alias}" — ${c.reason}`);
    console.log("");
  }
  if (crossInstitutionCollisions.length) {
    console.log("--- Cross-institution name collisions (active banks only) ---");
    for (const c of crossInstitutionCollisions) {
      console.log(`  ${c.bank.name} (${c.bank.slug}): "${c.alias}" also names ${c.collidesWith.map((o) => `${o.name} (${o.kind})`).join(", ")}`);
    }
    console.log("");
  }

  const stillCollidingAfterFix = changedProfiles.filter((p) => p.stillCollidesAfterFix);
  console.log(`Changed profiles whose NEW aka_names would still collide after the fix: ${stillCollidingAfterFix.length}`);
  for (const p of stillCollidingAfterFix) {
    console.log(`  ${p.bank.name} (${p.bank.slug}): ${JSON.stringify(p.stillCollidesAfterFix)}`);
  }
  console.log("");

  const auditedAt = new Date().toISOString();
  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `ncua-trade-name-alias-audit-${auditedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(
    reportPath,
    JSON.stringify({ auditedAt, totalNcuaLinked: ncuaLinked.length, brandCollisions, noLexicalRelation, crossInstitutionCollisions, changedProfiles }, null, 2)
  );
  console.log(`Full report written to ${reportPath}`);
  console.log("No changes were made — this script is read-only.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
