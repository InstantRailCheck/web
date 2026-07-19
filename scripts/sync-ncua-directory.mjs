import { createClient } from "@supabase/supabase-js";
import { readZipCsvEntry } from "./lib/zipCsv.mjs";
import { computeAkaNamesFromSearchNames, deriveDomainInitialsAka, mergeAkaNames } from "./lib/bankAkaNames.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function zipUrlFor(quarter) {
  return `https://www.ncua.gov/files/publications/analysis/call-report-data-${quarter}.zip`;
}

// ncua.gov has been observed to intermittently fail to accept connections
// within Node's default 10s timeout from some networks (e.g. GitHub Actions
// runners) — retry a few times with backoff before giving up, since a
// transient blip shouldn't fail the whole sync.
async function fetchWithRetry(url, options, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const delayMs = 2 ** i * 1000;
        console.log(`  fetch failed (${err.message}), retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
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
    const res = await fetchWithRetry(zipUrlFor(quarter), { method: "HEAD" });
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

async function main() {
  console.log(`Downloading ${ZIP_URL}...`);
  const res = await fetchWithRetry(ZIP_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const readEntry = (name) => readZipCsvEntry(buffer, name);

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
      city: row.PhysicalAddressCity || null,
      state: row.PhysicalAddressStateCode || null,
    });
  }

  const tradeNamesByCharter = new Map();
  for (const row of tradeNames) {
    const list = tradeNamesByCharter.get(row.CU_NUMBER) ?? [];
    if (row.TradeName) list.push(row.TradeName);
    tradeNamesByCharter.set(row.CU_NUMBER, list);
  }

  // v8.0 closure detection (§7): ncua_credit_unions only ever upserts by
  // charter_number and never removes/flags a charter absent from this
  // run's file, so the directory sync can't detect a closure by reading
  // ncua_credit_unions itself — it has no concept of "not in the latest
  // file." Fixed by recording an independently-sourced row count here,
  // before any ncua_credit_unions write, and stamping every row this run
  // upserts with this run's log id. A truncated/corrupted download is
  // caught the same way production-drift/retention guards work elsewhere
  // in this project: compare against the last known-good count and abort
  // rather than silently treat a partial file as this quarter's truth.
  console.log("Checking FOICU row count against the last successful sync...");
  const { data: previousLog, error: previousLogError } = await supabase
    .from("ncua_reference_sync_log")
    .select("id, foicu_row_count")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousLogError) throw previousLogError;

  if (previousLog) {
    const ratio = foicu.length / previousLog.foicu_row_count;
    if (ratio < 0.97) {
      throw new Error(
        `FOICU row count (${foicu.length}) is under 97% of the last successful sync's count ` +
          `(${previousLog.foicu_row_count}) — aborting before writing ncua_reference_sync_log or ` +
          `touching ncua_credit_unions. This looks like a truncated or corrupted download, not a real ` +
          `quarter-over-quarter change.`
      );
    }
  } else {
    console.log("No prior ncua_reference_sync_log row found — treating this as the first-ever run (no retention check).");
  }

  const { data: newLog, error: newLogError } = await supabase
    .from("ncua_reference_sync_log")
    .insert({ quarter: QUARTER, foicu_row_count: foicu.length })
    .select("id")
    .single();
  if (newLogError) throw newLogError;
  const syncLogId = newLog.id;

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
      city: branch?.city ?? null,
      state: branch?.state ?? null,
      total_assets: totalAssetsByCharter.get(charterNumber) ?? null,
      updated_at: new Date().toISOString(),
      last_seen_sync_id: syncLogId,
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

  // Keep already-linked banks' aka_names current on every sync (not just at
  // initial backfill time) - new trade names NCUA adds for an already-linked
  // credit union would otherwise only ever be reflected in
  // ncua_credit_unions itself, never on the actual bank profile page.
  console.log("Refreshing aka_names for banks already linked to an NCUA charter...");
  const searchNamesByCharter = new Map(records.map((r) => [r.charter_number, r.search_names]));
  // Supabase caps a single select() at 1000 rows by default - with 3,770+
  // banks now linked, an unpaginated query here would silently refresh only
  // the first 1000 and leave the rest stale (the exact bug class v2.2.0
  // fixed for the bulk import scripts).
  const linkedBanks = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, name, website, ncua_charter_number")
      .not("ncua_charter_number", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    linkedBanks.push(...data);
    if (data.length < 1000) break;
  }

  let refreshed = 0;
  for (const bank of linkedBanks) {
    const searchNames = searchNamesByCharter.get(bank.ncua_charter_number);
    if (!searchNames) continue; // charter no longer in this run's data - leave as is

    // computeAkaNamesFromSearchNames alone would silently erase any
    // domain-derived acronym (FNFCU, OTPFCU, ASCU, ...) on every sync, since
    // NCUA's own TradeNames.txt never contained those in the first place -
    // confirmed live. Re-derive it fresh from the bank's current
    // name/website (not just carried forward from the old array) so it
    // also stays correct if either one ever changes, rather than going
    // stale silently.
    const ncuaAka = computeAkaNamesFromSearchNames(bank.name, searchNames);
    const domainAka = deriveDomainInitialsAka(bank.name, bank.website);
    const merged = mergeAkaNames(ncuaAka, domainAka);

    const { error } = await supabase.from("banks").update({ aka_names: merged }).eq("id", bank.id);
    if (error) throw error;
    refreshed++;
  }
  console.log(`Refreshed aka_names for ${refreshed} linked bank(s).`);

  console.log("Done.");
}

function normalizeWebsite(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // .startsWith("http") is case-sensitive - NCUA's own FS220D data has at
  // least one row (charter 67486, Reed Credit Union) with the protocol
  // submitted as "HTTPS://..." in all-caps, which this check failed to
  // recognize as already having a protocol, prepending a second
  // "https://" on top of it ("https://HTTPS://WWW.REEDCREDITUNION.COM").
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
