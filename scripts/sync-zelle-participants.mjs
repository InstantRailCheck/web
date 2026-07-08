import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL = "https://www.zelle.com/search";
const DELAY_MS = 300;

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
    updated_at: new Date().toISOString(),
  }));

  console.log(`Parsed ${finalRecords.length} unique Zelle participants. Replacing table...`);
  await supabase.from("zelle_participants").delete().neq("id", 0);

  const chunkSize = 500;
  for (let i = 0; i < finalRecords.length; i += chunkSize) {
    const chunk = finalRecords.slice(i, i + chunkSize);
    const { error } = await supabase.from("zelle_participants").insert(chunk);
    if (error) throw error;
    console.log(`  inserted ${Math.min(i + chunkSize, finalRecords.length)}/${finalRecords.length}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
