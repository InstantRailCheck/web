// v10.4: bank_asset_backfill_log lets /research/instant-payments's
// dateModified reflect scripts/backfill-bank-assets.mjs's runs — total_assets
// drives the coverage report's byAssetTier breakdown, and previously no
// timestamp anywhere reflected when that data last changed.
//
// backfill-bank-assets.mjs does a live fetch against the FDIC API, so — same
// reasoning as ncuaReferenceSyncLog.check.mjs — this exercises the schema/
// query mechanism directly (real inserts against real local Supabase, real
// "most recent by synced_at" query) rather than invoking the real script.
// This is what actually proves the migration's grants work on a fresh
// replay — exactly the bug class route_requests had (missing an explicit
// service_role grant, only working in production via legacy dashboard-
// inherited privileges).
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function insertLog(minutesAgo, banksProcessed, matched, cleared) {
  const syncedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const { data, error } = await admin
    .from("bank_asset_backfill_log")
    .insert({ synced_at: syncedAt, banks_processed: banksProcessed, matched, cleared })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function latestSyncedAt() {
  const { data, error } = await admin
    .from("bank_asset_backfill_log")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.synced_at ?? null;
}

async function main() {
  let olderLogId, newerLogId;

  try {
    console.log("\nInserting an older log row...");
    olderLogId = await insertLog(60, 9000, 8000, 50);

    const afterFirst = await latestSyncedAt();
    assert(afterFirst !== null, "latest-synced_at query returns a row after the first insert");

    console.log("\nInserting a newer log row...");
    newerLogId = await insertLog(1, 9010, 8100, 45);

    const afterSecond = await latestSyncedAt();
    const { data: newerRow, error: newerRowError } = await admin
      .from("bank_asset_backfill_log")
      .select("synced_at")
      .eq("id", newerLogId)
      .single();
    if (newerRowError) throw newerRowError;
    assert(afterSecond === newerRow.synced_at, "the most-recent-by-synced_at query returns the newer row, not just the last inserted");

    const { data: allRows, error: allRowsError } = await admin
      .from("bank_asset_backfill_log")
      .select("id, banks_processed, matched, cleared")
      .in("id", [olderLogId, newerLogId])
      .order("id", { ascending: true });
    if (allRowsError) throw allRowsError;
    assert(allRows.length === 2, "both rows were written and are independently readable");
    assert(allRows[0].banks_processed === 9000 && allRows[0].matched === 8000 && allRows[0].cleared === 50, "older row's counts round-trip correctly");
    assert(allRows[1].banks_processed === 9010 && allRows[1].matched === 8100 && allRows[1].cleared === 45, "newer row's counts round-trip correctly");
  } finally {
    console.log("\nCleaning up...");
    const ids = [olderLogId, newerLogId].filter((id) => id != null);
    if (ids.length) await admin.from("bank_asset_backfill_log").delete().in("id", ids);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
