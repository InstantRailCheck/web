// v8.0 rollout step 1 (local rehearsal): finalize_sync_run intentionally
// processes an entire run's diff inside one transaction (§6's design —
// "the reviewed diff is exactly what gets applied," which only holds if
// nothing else can interleave). This is a real, deliberate lock-duration
// tradeoff the plan's Risks section calls out for confirmation against a
// realistic ~8,500-row diff — the actual size of the completed directory —
// before ever running this against production. Correctness is covered
// exhaustively in institutionSync.check.mjs; this file only measures scale.
import crypto from "node:crypto";
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

const ROW_COUNT = 8500;
const CHUNK_SIZE = 500;
// A generous ceiling, not a tuned perf budget — this is here to catch a
// genuinely broken plan (e.g. an accidental per-row round trip, a missing
// index making the NOT EXISTS scan quadratic) rather than to assert a
// specific number. If this trips, look at the query plan before assuming
// the number itself needs raising.
const MAX_ELAPSED_MS = 60_000;

const CERT_BASE = Math.floor(Date.now() / 1000);

async function chunkedInsert(table, rows) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + CHUNK_SIZE));
    if (error) throw error;
  }
}

async function main() {
  const certs = Array.from({ length: ROW_COUNT }, (_, i) => CERT_BASE + i);
  let runId;

  try {
    console.log(`\nSeeding ${ROW_COUNT} pre-existing fdic-linked banks...`);
    const bankRows = certs.map((cert) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      return {
        name: `DbTest Scale Bank ${suffix}`,
        slug: `db-test-scale-${suffix}`,
        source_authority: "fdic",
        fdic_cert: cert,
        is_active: true,
        city: "Springfield",
        state: "IL",
        website: "https://stable.example",
        total_assets: 5000,
      };
    });
    await chunkedInsert("banks", bankRows);

    console.log(`Creating a run and staging ${ROW_COUNT} matching valid rows (all unchanged)...`);
    const { data: run, error: runError } = await admin
      .from("sync_runs")
      .insert({ source_scope: "fdic" })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id;

    const stagingRows = bankRows.map((b) => ({
      run_id: runId,
      source_authority: "fdic",
      source_identifier: b.fdic_cert,
      status: "valid",
      name: b.name,
      city: b.city,
      state: b.state,
      website: b.website,
      total_assets: b.total_assets,
      proposed_slug: "unused",
    }));
    await chunkedInsert("sync_staging_institutions", stagingRows);

    const { data: hash, error: hashError } = await admin.rpc("compute_banks_base_snapshot_hash", {
      p_source_scope: "fdic",
    });
    if (hashError) throw hashError;

    const { data: stagedRows, error: stageError } = await admin
      .from("sync_runs")
      .update({ status: "staged", base_snapshot_hash: hash })
      .eq("id", runId)
      .eq("status", "running")
      .select("id");
    if (stageError) throw stageError;
    assert(stagedRows.length === 1, "running -> staged transition succeeds at scale");

    const { data: applyingRows, error: applyingError } = await admin
      .from("sync_runs")
      .update({ status: "applying" })
      .eq("id", runId)
      .eq("status", "staged")
      .select("id");
    if (applyingError) throw applyingError;
    assert(applyingRows.length === 1, "staged -> applying transition succeeds at scale");

    console.log(`Calling finalize_sync_run against ${ROW_COUNT} staged rows...`);
    const startedAt = Date.now();
    const { data: result, error: rpcError } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
    const elapsedMs = Date.now() - startedAt;

    assert(!rpcError, `finalize_sync_run succeeds at ${ROW_COUNT} rows (error: ${rpcError?.message})`);
    assert(result?.unchanged === ROW_COUNT, `all ${ROW_COUNT} rows resolve as unchanged (got ${result?.unchanged})`);
    console.log(`finalize_sync_run completed in ${elapsedMs}ms for ${ROW_COUNT} rows.`);
    assert(elapsedMs < MAX_ELAPSED_MS, `elapsed time (${elapsedMs}ms) is under the sanity ceiling (${MAX_ELAPSED_MS}ms)`);
  } finally {
    console.log("\nCleaning up...");
    if (runId) await admin.from("sync_runs").delete().eq("id", runId);
    await admin.from("banks").delete().gte("fdic_cert", CERT_BASE).lt("fdic_cert", CERT_BASE + ROW_COUNT);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
