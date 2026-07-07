import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";

const QUARTER = process.argv[2] ?? "2026-03";
const ZIP_URL = `https://www.ncua.gov/files/publications/analysis/call-report-data-${QUARTER}.zip`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

  const websiteByCharter = new Map();
  for (const row of fs220d) {
    const site = (row.Acct_891 || "").trim();
    if (site) websiteByCharter.set(row.CU_NUMBER, normalizeWebsite(site));
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
