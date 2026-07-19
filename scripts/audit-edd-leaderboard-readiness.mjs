// Read-only preflight for the proposed /early-direct-deposit leaderboard.
// Answers, against real production data: is a 5-distinct-reporter
// leaderboard threshold practical today, which deposit-type/provider
// filters have enough evidence to be worth shipping, and how much the
// public ranking would actually change if it switched from mean to
// median. Writes nothing.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EDD_PROVIDER_MIN_REPORTERS = 3;
const NON_PAYROLL_DEPOSIT_TYPES = new Set(["government_benefit", "tax_refund", "pension"]);
const STALE_DAYS = 180;

async function fetchAll(table, select) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(select).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

// Mirrors lib/routeConfidence.ts's dedupeToNewestPerReporter (can't import
// a .ts file from a plain node script) — same rule: drop unattributed
// (userId null) rows, keep each reporter's newest report only.
function dedupeToNewestPerReporter(reports) {
  const newestByReporter = new Map();
  for (const r of reports) {
    if (r.userId === null) continue;
    const testedAtMs = new Date(r.testedAt).getTime();
    const existing = newestByReporter.get(r.userId);
    if (!existing || testedAtMs > existing.testedAtMs) {
      newestByReporter.set(r.userId, { ...r, testedAtMs });
    }
  }
  return [...newestByReporter.values()];
}

function median(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  console.log("Loading edd_reports and banks...\n");
  const [eddRows, banks] = await Promise.all([
    fetchAll("edd_reports", "id, bank_id, user_id, days_early, created_at, deposit_type, payroll_provider"),
    fetchAll("banks", "id, slug, name, is_active"),
  ]);
  const bankById = new Map(banks.map((b) => [b.id, b]));

  console.log(`Total edd_reports rows: ${eddRows.length}`);
  const nullUserRows = eddRows.filter((r) => r.user_id === null).length;
  console.log(`  - of which user_id is null (never count): ${nullUserRows}`);

  const attributableRows = eddRows.filter((r) => r.user_id !== null);
  const distinctReporters = new Set(attributableRows.map((r) => r.user_id));
  console.log(`Total distinct reporters (attributable rows): ${distinctReporters.size}\n`);

  // Same dedup unit as dedupeEddReportsByReporterAndBank: newest report per
  // reporter per bank.
  const byBank = new Map();
  for (const r of attributableRows) {
    if (!byBank.has(r.bank_id)) byBank.set(r.bank_id, []);
    byBank.get(r.bank_id).push(r);
  }

  const perBank = []; // { bankId, name, isActive, days: number[], rows: [...] }
  for (const [bankId, rows] of byBank) {
    const deduped = dedupeToNewestPerReporter(
      rows.map((r) => ({ ...r, userId: r.user_id, testedAt: r.created_at }))
    );
    const bank = bankById.get(bankId);
    perBank.push({
      bankId,
      name: bank?.name ?? "(unknown bank)",
      isActive: bank?.is_active ?? false,
      rows: deduped,
      days: deduped.map((r) => r.days_early),
    });
  }

  const active = perBank.filter((b) => b.isActive);
  const inactiveWithEvidence = perBank.filter((b) => !b.isActive && b.rows.length > 0);
  console.log(`Institutions with >=1 qualifying (deduped, attributable) reporter: ${perBank.length}`);
  console.log(`  - active: ${active.length}, inactive (excluded from leaderboard): ${inactiveWithEvidence.length}\n`);

  for (const threshold of [2, 5, 10, 25]) {
    const count = active.filter((b) => b.days.length >= threshold).length;
    console.log(`Active institutions with >=${threshold} distinct reporters: ${count}`);
  }
  console.log();

  console.log("Distribution by deposit_type (attributable rows, before dedup):");
  const byDepositType = new Map();
  for (const r of attributableRows) {
    const key = r.deposit_type ?? "(null)";
    byDepositType.set(key, (byDepositType.get(key) ?? 0) + 1);
  }
  for (const [type, count] of [...byDepositType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();

  console.log(`Qualifying payroll_provider counts (deduped per reporter+provider, >= ${EDD_PROVIDER_MIN_REPORTERS} to be publicly showable):`);
  const eligibleForProvider = attributableRows.filter(
    (r) =>
      r.payroll_provider &&
      r.payroll_provider !== "unknown" &&
      r.payroll_provider !== "other" &&
      r.deposit_type &&
      !NON_PAYROLL_DEPOSIT_TYPES.has(r.deposit_type)
  );
  const byProvider = new Map();
  for (const r of eligibleForProvider) {
    if (!byProvider.has(r.payroll_provider)) byProvider.set(r.payroll_provider, []);
    byProvider.get(r.payroll_provider).push(r);
  }
  for (const [provider, rows] of [...byProvider.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const dedupedProvider = dedupeToNewestPerReporter(
      rows.map((r) => ({ ...r, userId: r.user_id, testedAt: r.created_at }))
    );
    const qualifies = dedupedProvider.length >= EDD_PROVIDER_MIN_REPORTERS;
    console.log(`  ${provider}: ${dedupedProvider.length} distinct reporters ${qualifies ? "(qualifies)" : "(below threshold)"}`);
  }
  if (byProvider.size === 0) console.log("  (none)");
  console.log();

  const allCreatedAt = attributableRows.map((r) => new Date(r.created_at).getTime()).filter((t) => !Number.isNaN(t));
  if (allCreatedAt.length > 0) {
    const now = Date.now();
    const ages = allCreatedAt.map((t) => (now - t) / (1000 * 60 * 60 * 24)).sort((a, b) => a - b);
    const newest = ages[0];
    const med = median(ages);
    const staleCount = ages.filter((a) => a > STALE_DAYS).length;
    console.log(`Newest evidence age: ${newest.toFixed(1)} days`);
    console.log(`Median evidence age: ${med.toFixed(1)} days`);
    console.log(`Rows older than STALE_DAYS (${STALE_DAYS}d): ${staleCount} / ${ages.length}\n`);
  }

  // Existing getEddRankedBanks ranking (avg, EDD_MIN_REPORTERS=2, no
  // is_active filter, no dedup-by-bank-only correction) vs. a median-based
  // ranking restricted to active banks at the current EDD_MIN_REPORTERS=2
  // threshold, to see how much re-ranking a switch to median causes among
  // banks that already qualify today.
  const currentRanked = perBank
    .filter((b) => b.days.length >= 2)
    .map((b) => ({
      name: b.name,
      avg: b.days.reduce((a, c) => a + c, 0) / b.days.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  const medianRanked = perBank
    .filter((b) => b.days.length >= 2)
    .map((b) => ({
      name: b.name,
      med: median([...b.days].sort((a, c) => a - c)),
    }))
    .sort((a, b) => b.med - a.med);

  const currentOrder = new Map(currentRanked.map((e, i) => [e.name, i]));
  const medianOrder = new Map(medianRanked.map((e, i) => [e.name, i]));
  let changedRank = 0;
  for (const [name, idx] of currentOrder) {
    if (medianOrder.get(name) !== idx) changedRank++;
  }
  console.log(`Institutions currently qualifying (>=2 reporters): ${currentRanked.length}`);
  console.log(`  - of which rank position changes when switching avg -> median: ${changedRank}\n`);

  console.log("Sample of active institutions with >=5 distinct reporters (for a leaderboard preview):");
  const top = active
    .filter((b) => b.days.length >= 5)
    .sort((a, b) => b.days.length - a.days.length)
    .slice(0, 15);
  if (top.length === 0) console.log("  (none)");
  for (const b of top) {
    const sorted = [...b.days].sort((a, c) => a - c);
    console.log(`  ${b.name}: n=${b.days.length}, median=${median(sorted)}, days=[${sorted.join(",")}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
