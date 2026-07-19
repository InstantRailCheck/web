// One-time production correction for the FDIC-side half of the website
// cleanup shipped alongside v8.11.2's NCUA fix. Unlike NCUA, there's no
// persistent raw FDIC mirror table in this DB to recompute from - FDIC
// data is fetched live from its own public API each sync - so this
// re-fetches WEBADDR live, by cert, only for the banks already known (via
// isValidWebsiteDomain) to have an invalid stored value, then applies the
// exact same repairFdicWebsite() the regular sync now uses. Confirmed live
// against FDIC's API before writing this: these are FDIC's own current,
// persistent data-entry mistakes (colon/comma typos, "n/a", two websites
// crammed into one field), not something that fixed itself since the last
// sync. Dry-run by default; --apply to write.
import { createClient } from "@supabase/supabase-js";
import { isValidWebsiteDomain, repairFdicWebsite, normalizeWebsite } from "./lib/bankAkaNames.mjs";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchInvalidFdicBanks() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("banks")
      .select("id, slug, name, website, fdic_cert")
      .not("website", "is", null)
      .not("fdic_cert", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows.filter((b) => !isValidWebsiteDomain(b.website));
}

async function fetchLiveWebaddr(cert) {
  const res = await fetch(`https://api.fdic.gov/banks/institutions?filters=CERT:${cert}&fields=WEBADDR`);
  if (!res.ok) throw new Error(`FDIC fetch failed for cert ${cert}: ${res.status}`);
  const json = await res.json();
  return json.data?.[0]?.data?.WEBADDR ?? null;
}

async function main() {
  console.log(APPLY ? "Running in APPLY mode — will write to production.\n" : "Running in DRY-RUN mode (pass --apply to write).\n");

  console.log("Loading FDIC-linked banks with an invalid stored website...");
  const banks = await fetchInvalidFdicBanks();
  console.log(`${banks.length} bank(s) found.\n`);

  let plannedCount = 0;
  let appliedCount = 0;
  let failedCount = 0;

  for (const bank of banks) {
    const liveRaw = await fetchLiveWebaddr(bank.fdic_cert);
    const normalized = liveRaw ? normalizeWebsite(liveRaw.startsWith("http") ? liveRaw : `https://${liveRaw}`) : null;
    const newWebsite = repairFdicWebsite(normalized);

    if (newWebsite === bank.website) continue; // no change (still invalid, or already matches)

    plannedCount++;
    console.log(`- ${bank.name} (${bank.slug}): website: ${JSON.stringify(bank.website)} -> ${JSON.stringify(newWebsite)}`);

    if (!APPLY) continue;

    const { error } = await supabase.from("banks").update({ website: newWebsite }).eq("id", bank.id);
    if (error) {
      failedCount++;
      console.log(`    FAILED: ${error.message}`);
    } else {
      appliedCount++;
    }
  }

  console.log(
    APPLY
      ? `\nDone. ${appliedCount}/${plannedCount} bank(s) updated${failedCount ? `, ${failedCount} FAILED` : ""}.`
      : `\nDry run complete. ${plannedCount} bank(s) would be updated. Re-run with --apply to write.`
  );

  if (failedCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
