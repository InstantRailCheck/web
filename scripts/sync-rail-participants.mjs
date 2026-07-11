import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FEDNOW_URL =
  "https://www.frbservices.org/binaries/content/assets/crsocms/financial-services/fednow/fednow-live-participants.xlsx";
const RTP_URL =
  "https://www.theclearinghouse.org/payment-systems/rtp/RTP-Participating-Financial-Institutions";

// A harmless upstream HTML/layout change could otherwise parse zero or
// very few records, and a naive delete-then-insert would then wipe out a
// fully populated table with almost nothing. Below this fraction of the
// table's current size, abort instead of proceeding — these lists only
// grow gradually (banks onboarding), so a large drop means the parser
// broke, not that hundreds of institutions left the network overnight.
const MIN_RETENTION_FRACTION = 0.8;

function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
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
    console.log(`  ${Math.min(i + chunkSize, stamped.length)}/${stamped.length}`);
  }

  console.log(`${table}: removing rows from before this sync...`);
  const { error: deleteError } = await supabase.from(table).delete().lt("updated_at", syncStartedAt);
  if (deleteError) throw deleteError;
}

async function syncFedNow() {
  console.log("Downloading FedNow participant list...");
  const res = await fetch(FEDNOW_URL);
  if (!res.ok) throw new Error(`FedNow download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const records = rows
    .filter((r) => r.length >= 3 && r[0] && r[0] !== "Organization Name")
    .map((r) => ({
      name: String(r[0]).trim(),
      search_name: normalize(String(r[0])),
      city: r[1] ? String(r[1]).trim() : null,
      state: r[2] ? String(r[2]).trim() : null,
    }));

  console.log(`Parsed ${records.length} FedNow participants.`);
  await replaceTable("fednow_participants", records);
}

async function syncRtp() {
  console.log("Downloading RTP participant list...");
  const res = await fetch(RTP_URL);
  if (!res.ok) throw new Error(`RTP download failed: ${res.status}`);
  const html = await res.text();

  const matches = [...html.matchAll(/<div class="fi-company">([^<]+)<br/g)];
  const records = matches
    .map((m) => m[1].trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, state] = entry.split(" - ").map((s) => s.trim());
      return {
        name: name || entry,
        search_name: normalize(name || entry),
        state: state || null,
      };
    });

  console.log(`Parsed ${records.length} RTP participants.`);
  await replaceTable("rtp_participants", records);
}

async function main() {
  await syncFedNow();
  await syncRtp();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
