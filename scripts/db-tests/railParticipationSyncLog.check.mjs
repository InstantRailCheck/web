// v10.1: backfill-rail-participation.mjs now writes a
// rail_participation_sync_log row only when it completes with zero
// per-bank update failures — the whole point of this table is that
// /research/instant-payments can trust its "rail participation last
// verified" date to mean what it says, not just "a download happened."
//
// Unlike ncuaReferenceSyncLog.check.mjs, this invokes the REAL script (not
// just the schema/query mechanism) — unlike sync-ncua-directory.mjs,
// backfill-rail-participation.mjs has no external network fetch of its
// own (it only reads already-seeded participant tables), so running it for
// real against seeded local data is safe and meaningfully stronger
// coverage than a simulated version of its logic.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient, resolveLocalSupabaseEnv } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();
const { url, serviceRoleKey } = resolveLocalSupabaseEnv();

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../backfill-rail-participation.mjs");

const TEST_BANK_NAME = `DbTest Rail Bank ${Date.now()}`;
const TEST_BANK_SLUG = `db-test-rail-bank-${Date.now()}`;
let bankId, fednowParticipantId, logRowId;
let otherBanksSnapshot = [];

// The real backfill script (correctly) processes every active bank in the
// table, not just the one this test seeds — so if any other banks already
// exist when this runs (a leftover from another check.mjs, or a developer's
// own locally-seeded data), their fednow_participant/rtp_participant/
// zelle_participant flags would otherwise be permanently changed by a test
// run and never restored. Snapshotting and restoring them here is what
// keeps this test genuinely self-contained per the fixtures.mjs convention,
// rather than silently depending on "nothing else happens to exist yet."
//
// Also captures each bank's existing bank_rail_history row ids — restoring
// a flag the backfill actually changed is itself a real UPDATE, which
// bank_rail_history_trigger (supabase/migrations/20260708165404_add_bank_rail_history.sql)
// cannot distinguish from a genuine change: it fires again and inserts a
// second, permanent history row for a bank outside this test's own
// fixtures. The id snapshot is what lets cleanup() surgically delete
// exactly the rows this test run created (both the backfill's and the
// restore's) without touching anything that predates it.
async function snapshotOtherBanksRailFlags() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from("banks")
      .select("id, fednow_participant, rtp_participant, zelle_participant")
      .neq("id", bankId)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  if (rows.length > 0) {
    const { data: historyRows, error: historyError } = await admin
      .from("bank_rail_history")
      .select("id")
      .in(
        "bank_id",
        rows.map((r) => r.id)
      );
    if (historyError) throw historyError;
    for (const row of rows) row.originalHistoryIds = new Set((historyRows ?? []).map((h) => h.id));
  }

  return rows;
}

// Restoring a flag is, by construction, a real UPDATE whenever the backfill
// actually changed it — banks_set_updated_at (supabase/migrations/
// 20260713010000_skip_noop_banks_updated_at.sql) therefore re-bumps
// updated_at to the restoration time, and there is no way to set it back to
// the original value from a client: that trigger unconditionally overwrites
// whatever updated_at a caller sends with now() on any real column change,
// by design (it exists specifically so no write path can get this wrong).
// Disabling the trigger to work around that would be a heavier, riskier
// step than this test cleanup should take. Accepted as a known limitation,
// scoped to a disposable local test database and only reachable on banks
// outside this test's own fixtures in the first place (the CI-normal case
// is zero such banks, since every other check.mjs cleans up after itself).
async function restoreOtherBanksRailFlags(snapshot) {
  for (const row of snapshot) {
    const { error } = await admin
      .from("banks")
      .update({
        fednow_participant: row.fednow_participant,
        rtp_participant: row.rtp_participant,
        zelle_participant: row.zelle_participant,
      })
      .eq("id", row.id);
    if (error) throw error;
  }
}

// Deletes exactly the bank_rail_history rows this test run created for
// "other" banks — both the backfill's real changes and the restore step's
// re-triggered inserts above — leaving any history that predates this test
// untouched. See snapshotOtherBanksRailFlags for why this exists.
async function pruneNewBankRailHistoryRows(snapshot) {
  const bankIds = snapshot.map((r) => r.id);
  if (bankIds.length === 0) return;

  const { data: currentRows, error } = await admin.from("bank_rail_history").select("id").in("bank_id", bankIds);
  if (error) throw error;

  const originalIds = new Set(snapshot.flatMap((r) => [...r.originalHistoryIds]));
  const newIds = (currentRows ?? []).map((r) => r.id).filter((id) => !originalIds.has(id));
  if (newIds.length === 0) return;

  const { error: deleteError } = await admin.from("bank_rail_history").delete().in("id", newIds);
  if (deleteError) throw deleteError;
}

async function seed() {
  const { data: bank, error: bankError } = await admin
    .from("banks")
    .insert({ name: TEST_BANK_NAME, slug: TEST_BANK_SLUG, city: "Testville", state: "ZZ", is_active: true })
    .select("id")
    .single();
  if (bankError) throw bankError;
  bankId = bank.id;

  // Matches scripts/sync-rail-participants.mjs's real normalize() exactly
  // (lowercase + trim + collapse whitespace, NOT strip-to-alphanumeric —
  // findNameMatches's word-truncation matching in
  // lib/railParticipationMatch.ts compares space-joined lowercase words, so
  // a stripped search_name would never match anything real).
  const { data: participant, error: participantError } = await admin
    .from("fednow_participants")
    .insert({
      name: TEST_BANK_NAME,
      search_name: TEST_BANK_NAME.toLowerCase().trim().replace(/\s+/g, " "),
      city: "Testville",
      state: "ZZ",
    })
    .select("id")
    .single();
  if (participantError) throw participantError;
  fednowParticipantId = participant.id;
}

async function cleanup() {
  if (otherBanksSnapshot.length > 0) {
    await restoreOtherBanksRailFlags(otherBanksSnapshot);
    await pruneNewBankRailHistoryRows(otherBanksSnapshot);
  }
  if (bankId) await admin.from("banks").delete().eq("id", bankId);
  if (fednowParticipantId) await admin.from("fednow_participants").delete().eq("id", fednowParticipantId);
  if (logRowId) await admin.from("rail_participation_sync_log").delete().eq("id", logRowId);
}

async function main() {
  try {
    console.log("\nSeeding a test bank that should match a FedNow participant...");
    await seed();

    otherBanksSnapshot = await snapshotOtherBanksRailFlags();
    if (otherBanksSnapshot.length > 0) {
      console.log(
        `\nSnapshotted rail-participant flags for ${otherBanksSnapshot.length} other bank(s) already present — will restore after this run.`
      );
    }

    const logRowsBefore = await admin.from("rail_participation_sync_log").select("id");
    const countBefore = logRowsBefore.data?.length ?? 0;

    console.log("\nRunning the real backfill script against local Supabase...");
    const output = execFileSync(process.execPath, [scriptPath], {
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey },
      encoding: "utf-8",
    });
    console.log(output);

    const { data: updatedBank, error: bankReadError } = await admin
      .from("banks")
      .select("fednow_participant, rtp_participant, zelle_participant")
      .eq("id", bankId)
      .single();
    if (bankReadError) throw bankReadError;
    assert(updatedBank.fednow_participant === true, "test bank's fednow_participant flag was set true by the real backfill run");
    assert(updatedBank.rtp_participant === false, "test bank's rtp_participant correctly resolved false (no matching RTP participant seeded)");

    const { data: logRowsAfter, error: logError } = await admin
      .from("rail_participation_sync_log")
      .select("*")
      .order("synced_at", { ascending: false });
    if (logError) throw logError;
    assert(logRowsAfter.length === countBefore + 1, "exactly one new rail_participation_sync_log row was written after a clean run");
    assert(logRowsAfter[0].banks_updated >= 1, "banks_updated reflects at least the one bank this test changed");
    assert(typeof logRowsAfter[0].banks_processed === "number", "banks_processed was recorded");
    logRowId = logRowsAfter[0].id;
  } finally {
    console.log("\nCleaning up...");
    await cleanup();
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
