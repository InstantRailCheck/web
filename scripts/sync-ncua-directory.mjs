import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function zipUrlFor(quarter) {
  return `https://www.ncua.gov/files/publications/analysis/call-report-data-${quarter}.zip`;
}

// NCUA publishes quarterly (Mar/Jun/Sep/Dec) but with a lag of several weeks
// to a few months after quarter-end, so "the current quarter" often isn't
// published yet. Without this, an unattended cron run would need a manually
// updated quarter argument every time — defeating the point of automating
// it — so instead walk backward from the current quarter until a ZIP
// actually exists.
async function findLatestQuarter() {
  const explicit = process.argv[2];
  if (explicit) return explicit;

  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1; // 1-12
  const quarterMonth = Math.ceil(month / 3) * 3; // 3, 6, 9, or 12
  let candidate = { year, month: quarterMonth };

  for (let i = 0; i < 8; i++) {
    const quarter = `${candidate.year}-${String(candidate.month).padStart(2, "0")}`;
    const res = await fetch(zipUrlFor(quarter), { method: "HEAD" });
    if (res.ok) return quarter;

    candidate.month -= 3;
    if (candidate.month < 1) {
      candidate.month = 12;
      candidate.year -= 1;
    }
  }

  throw new Error("Could not find a published NCUA call report ZIP in the last 8 quarters.");
}

const QUARTER = await findLatestQuarter();
const ZIP_URL = zipUrlFor(QUARTER);
console.log(`Using quarter: ${QUARTER}`);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((key, i) => (row[key] = values[i]));
    return row;
  });
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  console.log(`Downloading ${ZIP_URL}...`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const zip = new AdmZip(buffer);
  const readEntry = (name) => {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`Missing file in ZIP: ${name}`);
    return parseCsv(entry.getData().toString("utf8"));
  };

  console.log("Parsing FOICU (names)...");
  const foicu = readEntry("FOICU.txt");

  console.log("Parsing TradeNames (aliases)...");
  const tradeNames = readEntry("TradeNames.txt");

  console.log("Parsing Credit Union Branch Information (address, phone)...");
  const branches = readEntry("Credit Union Branch Information.txt");

  console.log("Parsing FS220D (website)...");
  const fs220d = readEntry("FS220D.txt");

  console.log("Parsing FS220 (total assets)...");
  const fs220 = readEntry("FS220.txt");

  const websiteByCharter = new Map();
  for (const row of fs220d) {
    const site = (row.Acct_891 || "").trim();
    if (site) websiteByCharter.set(row.CU_NUMBER, normalizeWebsite(site));
  }

  // ACCT_010 is the standard NCUA 5300 call report account code for Total
  // Assets — verified against Navy Federal's real reported figure ($203.6B)
  // before trusting it, not assumed from the field name alone.
  const totalAssetsByCharter = new Map();
  for (const row of fs220) {
    const assets = Number(row.ACCT_010);
    if (Number.isFinite(assets) && assets > 0) {
      totalAssetsByCharter.set(row.CU_NUMBER, assets);
    }
  }

  const branchByCharter = new Map();
  for (const row of branches) {
    if (row.MainOffice !== "Yes") continue;
    const address = [
      row.PhysicalAddressLine1,
      row.PhysicalAddressCity,
      row.PhysicalAddressStateCode,
      row.PhysicalAddressPostalCode,
    ]
      .filter(Boolean)
      .join(", ");
    branchByCharter.set(row.CU_NUMBER, {
      address: address || null,
      phone: row.PhoneNumber || null,
    });
  }

  const tradeNamesByCharter = new Map();
  for (const row of tradeNames) {
    const list = tradeNamesByCharter.get(row.CU_NUMBER) ?? [];
    if (row.TradeName) list.push(row.TradeName);
    tradeNamesByCharter.set(row.CU_NUMBER, list);
  }

  const records = foicu.map((row) => {
    const charterNumber = row.CU_NUMBER;
    const name = row.CU_NAME;
    const aliases = tradeNamesByCharter.get(charterNumber) ?? [];
    const branch = branchByCharter.get(charterNumber);

    return {
      charter_number: Number(charterNumber),
      name,
      search_names: Array.from(
        new Set([name, ...aliases].map((n) => n.toLowerCase().trim()))
      ),
      website: websiteByCharter.get(charterNumber) ?? null,
      address: branch?.address ?? null,
      phone: branch?.phone ?? null,
      total_assets: totalAssetsByCharter.get(charterNumber) ?? null,
      updated_at: new Date().toISOString(),
    };
  });

  console.log(`Upserting ${records.length} credit unions...`);
  const chunkSize = 500;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("ncua_credit_unions")
      .upsert(chunk, { onConflict: "charter_number" });
    if (error) throw error;
    console.log(`  ${Math.min(i + chunkSize, records.length)}/${records.length}`);
  }

  console.log("Done.");
}

function normalizeWebsite(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
