import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { replaceTableSafely } from "./lib/syncTableReplace.mjs";
import { fetchWithTimeoutAndRetry } from "./lib/fetchWithTimeout.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FEDNOW_URL =
  "https://www.frbservices.org/binaries/content/assets/crsocms/financial-services/fednow/fednow-live-participants.xlsx";
const RTP_URL =
  "https://www.theclearinghouse.org/payment-systems/rtp/RTP-Participating-Financial-Institutions";

function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

async function syncFedNow() {
  console.log("Downloading FedNow participant list...");
  const res = await fetchWithTimeoutAndRetry(FEDNOW_URL);
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
  await replaceTableSafely(supabase, "fednow_participants", records);
}

async function syncRtp() {
  console.log("Downloading RTP participant list...");
  const res = await fetchWithTimeoutAndRetry(RTP_URL);
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
  await replaceTableSafely(supabase, "rtp_participants", records);
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
