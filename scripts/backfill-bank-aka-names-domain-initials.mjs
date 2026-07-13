// Supplements the NCUA/FDIC official-source aka_names with one narrow,
// mechanically-verified case neither source covers: an institution's own
// domain spelling out the exact initials of its own name (see
// deriveDomainInitialsAka in lib/bankAkaNames.mjs for why this isn't a
// guess). Additive - merges into whatever aka_names a bank already has
// from the NCUA/FDIC backfills, never overwrites it.
import { createClient } from "@supabase/supabase-js";
import { deriveDomainInitialsAka } from "./lib/bankAkaNames.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchAll(table, columns) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log("Loading banks with a website on file...");
  const banks = await fetchAll("banks", "id, name, website, aka_names");
  const candidates = banks.filter((b) => b.website);
  console.log(`${candidates.length} of ${banks.length} bank(s) have a website to check.`);

  let added = 0;
  let alreadyPresent = 0;

  for (const bank of candidates) {
    const derived = deriveDomainInitialsAka(bank.name, bank.website);
    if (!derived) continue;

    const existing = bank.aka_names ?? [];
    if (existing.some((n) => n.toLowerCase() === derived.toLowerCase())) {
      alreadyPresent++;
      continue;
    }

    const akaNames = [...existing, derived];
    const { error } = await supabase.from("banks").update({ aka_names: akaNames }).eq("id", bank.id);
    if (error) {
      console.log(`- ${bank.name}: update failed - ${error.message}`);
      continue;
    }
    console.log(`- ${bank.name}: added "${derived}" (domain: ${bank.website})`);
    added++;
  }

  console.log(`Done. Added ${added} domain-derived initials, ${alreadyPresent} already had it.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
