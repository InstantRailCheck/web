// v8.0 §7 (NCUA closure detection): ncua_credit_unions only ever upserts by
// charter_number and never removes/flags a row absent from the newest
// FOICU file — read the whole table and a closed charter is
// indistinguishable from an active one. Fixed by stamping every row a
// successful sync-ncua-directory.mjs run touches with that run's
// ncua_reference_sync_log id, so a query scoped to the latest log id
// correctly excludes anything not re-confirmed by the most recent run.
//
// This exercises the schema/query-level mechanism directly (two simulated
// sync runs, one dropping a charter) rather than the real script, which
// does a live network fetch from ncua.gov and isn't something a db-test
// can or should invoke. Per the plan's Risks section, this must pass
// before any production schema change.
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

const CHARTER_BASE = Math.floor(Date.now() / 1000);
const charterA = CHARTER_BASE;
const charterB = CHARTER_BASE + 1;

async function insertLog(quarter, foicuRowCount) {
  const { data, error } = await admin
    .from("ncua_reference_sync_log")
    .insert({ quarter, foicu_row_count: foicuRowCount })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function upsertCreditUnion(charterNumber, syncLogId) {
  const { error } = await admin.from("ncua_credit_unions").upsert(
    {
      charter_number: charterNumber,
      name: `DbTest Credit Union ${charterNumber}`,
      last_seen_sync_id: syncLogId,
    },
    { onConflict: "charter_number" }
  );
  if (error) throw error;
}

async function latestRunCandidates() {
  const { data: latestLog, error: latestLogError } = await admin
    .from("ncua_reference_sync_log")
    .select("id")
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();
  if (latestLogError) throw latestLogError;

  const { data, error } = await admin
    .from("ncua_credit_unions")
    .select("charter_number")
    .eq("last_seen_sync_id", latestLog.id);
  if (error) throw error;
  return data.map((r) => r.charter_number);
}

async function main() {
  let log1Id, log2Id;

  try {
    console.log("\nRun 1 (baseline): two charters seen, both stamped with this run's log id");
    log1Id = await insertLog("2026-03", 2);
    await upsertCreditUnion(charterA, log1Id);
    await upsertCreditUnion(charterB, log1Id);

    const candidatesAfterRun1 = await latestRunCandidates();
    assert(candidatesAfterRun1.includes(charterA), "charter A is a candidate after run 1");
    assert(candidatesAfterRun1.includes(charterB), "charter B is a candidate after run 1");

    console.log("\nRun 2: charter B is absent from this run's FOICU file (simulating a real closure) — only charter A is re-upserted");
    log2Id = await insertLog("2026-06", 1);
    await upsertCreditUnion(charterA, log2Id);

    const candidatesAfterRun2 = await latestRunCandidates();
    assert(candidatesAfterRun2.includes(charterA), "charter A is still a candidate after run 2 (re-confirmed)");
    assert(
      !candidatesAfterRun2.includes(charterB),
      "charter B is correctly excluded from the latest run's candidate set after going missing — this is the closure signal"
    );

    const { data: charterBRow, error: charterBError } = await admin
      .from("ncua_credit_unions")
      .select("charter_number, last_seen_sync_id")
      .eq("charter_number", charterB)
      .single();
    if (charterBError) throw charterBError;
    assert(charterBRow !== null, "charter B's row still physically exists in ncua_credit_unions — never deleted");
    assert(charterBRow.last_seen_sync_id === log1Id, "charter B's last_seen_sync_id is untouched, still pointing at run 1 (not silently advanced)");

    const { data: logs, error: logsError } = await admin
      .from("ncua_reference_sync_log")
      .select("id, quarter")
      .order("synced_at", { ascending: true });
    if (logsError) throw logsError;
    assert(logs.length === 2, `exactly two log rows recorded (got ${logs.length})`);
    assert(logs[0].id === log1Id && logs[1].id === log2Id, "log rows are in the order they were created");
  } finally {
    console.log("\nCleaning up...");
    // ncua_credit_unions.last_seen_sync_id has no ON DELETE CASCADE — the
    // referencing rows must go first.
    await admin.from("ncua_credit_unions").delete().in("charter_number", [charterA, charterB]);
    const logIds = [log1Id, log2Id].filter((id) => id != null);
    if (logIds.length) await admin.from("ncua_reference_sync_log").delete().in("id", logIds);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
