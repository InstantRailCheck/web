import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL = "https://www.zelle.com/search";
const DELAY_MS = 300;

// A harmless upstream HTML/layout change could otherwise parse zero or
// very few records, and a naive delete-then-insert would then wipe out a
// fully populated table with almost nothing. Below this fraction of the
// table's current size, abort instead of proceeding — this list only
// grows gradually (banks onboarding), so a large drop means the parser
// broke, not that thousands of institutions left the network overnight.
const MIN_RETENTION_FRACTION = 0.8;

function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(page, attempt = 1) {
  const res = await fetch(`${BASE_URL}?page=${page}`);
  if (!res.ok) throw new Error(`Page ${page} failed: ${res.status}`);
  const html = await res.text();

  const totalMatch = html.match(/Displaying \d+ - \d+ of (\d+) results?/);
  const items = [...html.matchAll(/<a href="\/partners\/([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => ({
    slug: m[1],
    name: m[2].trim(),
  }));

  if (!totalMatch && attempt < 3) {
    console.log(`  page ${page}: unexpected response, retrying in 2s (attempt ${attempt})...`);
    await sleep(2000);
    return fetchPage(page, attempt + 1);
  }

  return { total: totalMatch ? Number(totalMatch[1]) : null, items };
}

// Never leaves the table empty at any intermediate point: inserts the new
// rows first (stamped with this run's timestamp), and only removes the
// previous rows — identified by predating that timestamp — once every new
// row has been inserted successfully. A failure partway through an insert
// throws before any deletion happens, so the table still holds the last
// good sync's data rather than a partially-replaced mix.
async function replaceTable(table, records) {
  const { count: currentCount, error: countError } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;

  if (currentCount > 0 && records.length < currentCount * MIN_RETENTION_FRACTION) {
    throw new Error(
      `${table}: parsed ${records.length} records, but ${currentCount} are currently stored — ` +
        `a drop below ${MIN_RETENTION_FRACTION * 100}% looks like a parsing failure, not a real change. Aborting without touching the table.`
    );
  }

  const syncStartedAt = new Date().toISOString();
  const stamped = records.map((r) => ({ ...r, updated_at: syncStartedAt }));

  console.log(`${table}: inserting ${stamped.length} new records...`);
  const chunkSize = 500;
  for (let i = 0; i < stamped.length; i += chunkSize) {
    const chunk = stamped.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
    console.log(`  inserted ${Math.min(i + chunkSize, stamped.length)}/${stamped.length}`);
  }

  console.log(`${table}: removing rows from before this sync...`);
  const { error: deleteError } = await supabase.from(table).delete().lt("updated_at", syncStartedAt);
  if (deleteError) throw deleteError;
}

async function main() {
  console.log("Fetching page 0 to determine total count...");
  const first = await fetchPage(0);
  if (!first.total) throw new Error("Could not determine total result count from page 0");

  const totalPages = Math.ceil(first.total / 10);
  console.log(`Total: ${first.total} results across ${totalPages} pages.`);

  const records = new Map();
  for (const item of first.items) {
    records.set(item.slug, item);
  }

  for (let page = 1; page < totalPages; page++) {
    await sleep(DELAY_MS);
    const { items } = await fetchPage(page);
    for (const item of items) {
      records.set(item.slug, item);
    }
    if (page % 20 === 0) console.log(`  page ${page}/${totalPages}, ${records.size} unique so far`);
  }

  const finalRecords = Array.from(records.values()).map((item) => ({
    name: item.name,
    search_name: normalize(item.name),
    slug: item.slug,
  }));

  console.log(`Parsed ${finalRecords.length} unique Zelle participants.`);
  await replaceTable("zelle_participants", finalRecords);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
