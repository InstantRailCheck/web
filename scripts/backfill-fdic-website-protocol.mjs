// One-time production correction: every FDIC-linked bank's website was
// stored as a bare domain (no protocol, e.g. "ozk.com") because
// fdicRecordToSourceInstitution used to store normalizeWebsite's bare-
// domain output directly - a bare domain in an <a href> or JSON-LD `url`
// renders as a RELATIVE link, not an external one, so every FDIC bank's
// website link silently 404'd back onto this site's own domain (confirmed
// live: /banks/bank-ozk's link resolved to instantrailcheck.com/banks/ozk.com).
// NCUA-sourced websites already include a protocol and are unaffected.
//
// This is a purely mechanical fix - every value here already passed
// isValidWebsiteDomain (it's a real, validated domain), so prepending
// "https://" is not a guess about content, only about the missing scheme.
// The sync pipeline itself is fixed alongside this (see
// fdicRecordToSourceInstitution), so a future sync can't reintroduce a
// bare value. Dry-run by default; --apply to write.
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchBareFdicWebsites() {
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
  return rows.filter((b) => !/^https?:\/\//i.test(b.website));
}

async function main() {
  console.log(APPLY ? "Running in APPLY mode — will write to production.\n" : "Running in DRY-RUN mode (pass --apply to write).\n");

  console.log("Loading FDIC-linked banks with a bare (protocol-less) website...");
  const banks = await fetchBareFdicWebsites();
  console.log(`${banks.length} bank(s) found.\n`);

  let appliedCount = 0;
  let failedCount = 0;

  for (const bank of banks) {
    const newWebsite = `https://${bank.website}`;

    if (!APPLY) continue;

    const { error } = await supabase.from("banks").update({ website: newWebsite }).eq("id", bank.id);
    if (error) {
      failedCount++;
      console.log(`- FAILED ${bank.name} (${bank.slug}): ${error.message}`);
    } else {
      appliedCount++;
    }
  }

  console.log(
    APPLY
      ? `\nDone. ${appliedCount}/${banks.length} bank(s) updated${failedCount ? `, ${failedCount} FAILED` : ""}.`
      : `\nDry run complete. ${banks.length} bank(s) would be updated (bare domain -> https://<domain>). Re-run with --apply to write.`
  );

  if (failedCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
