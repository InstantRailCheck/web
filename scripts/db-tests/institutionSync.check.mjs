// v8.0 rollout step 1 (local rehearsal, before any production schema
// change): exercises finalize_sync_run and its supporting state-machine
// transitions against real Postgres, covering every behavior called out in
// the plan — insert / update / unchanged / reactivation / manually-inactive
// (never auto-reactivated) / a rejected duplicate identifier that must
// never trigger inactivation / a real closure / base_snapshot_hash drift /
// concurrent double-finalize / the override gate / the partial unique
// index on staged valid identifiers. Scale (an ~8,500-row single run, to
// gauge lock/transaction duration) is covered separately in
// institutionSyncScale.check.mjs — this file is about correctness, not size.
import crypto from "node:crypto";
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

// Seconds-since-epoch, safely under int4 max until 2038 — unique enough
// across separate test runs without risking overflow. A same-second
// collision just fails loudly with a real unique-constraint error rather
// than silently reusing another run's identifier, matching this project's
// "blank over wrong" rule.
const CERT_BASE = Math.floor(Date.now() / 1000);
let certOffset = 0;
function nextCert() {
  return CERT_BASE + certOffset++;
}

const createdBankIds = [];
const createdRunIds = [];

function bankRow(overrides) {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    name: `DbTest Sync Bank ${suffix}`,
    slug: `db-test-sync-${suffix}`,
    is_active: true,
    ...overrides,
  };
}

async function insertBank(overrides) {
  const { data, error } = await admin.from("banks").insert(bankRow(overrides)).select("*").single();
  if (error) throw error;
  createdBankIds.push(data.id);
  return data;
}

const createdCharterNumbers = [];

// banks.ncua_charter_number is a real foreign key into ncua_credit_unions
// (confirmed live — a bank fixture using an arbitrary charter number with
// no backing row fails with a 23503 violation, exactly as it should:
// scripts/sync-institution-directory.mjs only ever stages ncua-scope rows
// sourced from ncua_credit_unions in the first place, so this is never a
// gap in practice, only something a test fixture has to respect too).
async function insertNcuaCreditUnion(charterNumber) {
  const { error } = await admin
    .from("ncua_credit_unions")
    .insert({ charter_number: charterNumber, name: `DbTest NCUA ${charterNumber}` });
  if (error) throw error;
  createdCharterNumbers.push(charterNumber);
}

async function createRun(sourceScope) {
  const { data, error } = await admin
    .from("sync_runs")
    .insert({ source_scope: sourceScope })
    .select("id")
    .single();
  if (error) throw error;
  createdRunIds.push(data.id);
  return data.id;
}

// Mirrors the CLI's own atomic compare-and-set transitions — WHERE
// status = <expected>, zero rows affected is a real conflict, never
// treated as success.
async function transition(runId, from, to, extra = {}) {
  const { data, error } = await admin
    .from("sync_runs")
    .update({ status: to, ...extra })
    .eq("id", runId)
    .eq("status", from)
    .select("id");
  if (error) throw error;
  return data.length === 1;
}

// Mirrors what scripts/sync-institution-directory.mjs itself now does at
// staging time — finalize_sync_run (post code-review hardening) verifies
// the staged row count against fdic_collected_count/ncua_collected_count
// and recomputes compute_staging_snapshot_hash against source_snapshot_hash,
// so a test run that skips either would fail those checks regardless of
// what it's actually trying to exercise.
async function stageRun(runId, sourceScope) {
  const { count: fdicCount, error: fdicCountError } = await admin
    .from("sync_staging_institutions")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("source_authority", "fdic");
  if (fdicCountError) throw fdicCountError;
  const { count: ncuaCount, error: ncuaCountError } = await admin
    .from("sync_staging_institutions")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("source_authority", "ncua");
  if (ncuaCountError) throw ncuaCountError;

  const { data: hash, error: hashError } = await admin.rpc("compute_banks_base_snapshot_hash", {
    p_source_scope: sourceScope,
  });
  if (hashError) throw hashError;
  const { data: stagingHash, error: stagingHashError } = await admin.rpc("compute_staging_snapshot_hash", {
    p_run_id: runId,
  });
  if (stagingHashError) throw stagingHashError;

  const ok = await transition(runId, "running", "staged", {
    base_snapshot_hash: hash,
    source_snapshot_hash: stagingHash,
    fdic_collected_count: fdicCount,
    ncua_collected_count: ncuaCount,
  });
  if (!ok) throw new Error(`could not transition run ${runId} running -> staged`);
  return hash;
}

async function stageInstitutions(runId, rows) {
  const { error } = await admin.from("sync_staging_institutions").insert(
    rows.map((r) => ({ run_id: runId, ...r }))
  );
  if (error) throw error;
}

async function getRun(runId) {
  const { data, error } = await admin.from("sync_runs").select("*").eq("id", runId).single();
  if (error) throw error;
  return data;
}

async function getBank(id) {
  const { data, error } = await admin.from("banks").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function main() {
  try {
    console.log("\nScenario A: a single run exercises insert/update/unchanged/reactivate/manually-inactive/rejected-duplicate/closure together");
    {
      const certUpdate = nextCert();
      const certUnchanged = nextCert();
      const certReactivate = nextCert();
      const certManuallyInactive = nextCert();
      const certRejectedDuplicate = nextCert();
      const certClose = nextCert();
      const certNew = nextCert();
      const ncuaCharterUnrelated = nextCert();
      await insertNcuaCreditUnion(ncuaCharterUnrelated);

      const bankToUpdate = await insertBank({
        source_authority: "fdic", fdic_cert: certUpdate,
        website: "https://old-website.example", total_assets: 1000,
      });
      const unchangedFields = { website: "https://stable.example", total_assets: 5000, city: "Springfield", state: "IL" };
      const bankUnchanged = await insertBank({ source_authority: "fdic", fdic_cert: certUnchanged, ...unchangedFields });
      const bankToReactivate = await insertBank({
        source_authority: "fdic", fdic_cert: certReactivate,
        is_active: false, inactive_reason: "unlisted",
      });
      const bankManuallyInactive = await insertBank({
        source_authority: "fdic", fdic_cert: certManuallyInactive,
        is_active: false, inactive_reason: "closed",
      });
      const bankRejectedDuplicateTarget = await insertBank({
        source_authority: "fdic", fdic_cert: certRejectedDuplicate, website: "https://untouched.example",
      });
      const bankToClose = await insertBank({ source_authority: "fdic", fdic_cert: certClose });
      const bankUnrelatedScope = await insertBank({ source_authority: "ncua", ncua_charter_number: ncuaCharterUnrelated });
      const bankUnlinkedCommunity = await insertBank({});

      const beforeUnchangedUpdatedAt = bankUnchanged.updated_at;

      const runId = await createRun("fdic");
      await stageInstitutions(runId, [
        { source_authority: "fdic", source_identifier: certUpdate, status: "valid", name: "Updated Name", website: "https://new-website.example", total_assets: 2000, proposed_slug: "unused" },
        { source_authority: "fdic", source_identifier: certUnchanged, status: "valid", name: bankUnchanged.name, ...unchangedFields, proposed_slug: "unused" },
        { source_authority: "fdic", source_identifier: certReactivate, status: "valid", name: "Reactivated Bank", proposed_slug: "unused" },
        { source_authority: "fdic", source_identifier: certManuallyInactive, status: "valid", name: "Should Not Reactivate", proposed_slug: "unused" },
        { source_authority: "fdic", source_identifier: certRejectedDuplicate, status: "rejected", reject_reason: "duplicate_identifier_in_source" },
        { source_authority: "fdic", source_identifier: certRejectedDuplicate, status: "rejected", reject_reason: "duplicate_identifier_in_source" },
        { source_authority: "fdic", source_identifier: certNew, status: "valid", name: "Brand New Bank", proposed_slug: `db-test-sync-new-${crypto.randomUUID().slice(0, 8)}` },
        { source_authority: "fdic", source_identifier: null, status: "rejected", reject_reason: "missing_identifier" },
      ]);

      await stageRun(runId, "fdic");
      const applyingOk = await transition(runId, "staged", "applying");
      assert(applyingOk, "staged -> applying transition succeeds");

      const { data: result, error: rpcError } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
      assert(!rpcError, `finalize_sync_run succeeds (error: ${rpcError?.message})`);
      assert(result?.status === "applied", `RPC result reports status=applied (got ${result?.status})`);
      assert(result?.inserted === 1, `exactly one insert (got ${result?.inserted})`);
      assert(result?.updated === 1, `exactly one update (got ${result?.updated})`);
      assert(result?.unchanged === 1, `exactly one unchanged (got ${result?.unchanged})`);
      assert(result?.reactivated === 1, `exactly one reactivation (got ${result?.reactivated})`);
      assert(result?.inactivated === 1, `exactly one inactivation (got ${result?.inactivated})`);
      assert(result?.reappeared_manually_inactive === 1, `exactly one manually-inactive reappearance flagged (got ${result?.reappeared_manually_inactive})`);

      const run = await getRun(runId);
      assert(run.status === "applied", "sync_runs.status is applied after finalize");
      assert(run.finished_at !== null, "sync_runs.finished_at is set after finalize");

      const updated = await getBank(bankToUpdate.id);
      assert(updated.website === "https://new-website.example", "updated bank's website reflects the staged value");
      assert(updated.total_assets === 2000, "updated bank's total_assets reflects the staged value");
      assert(updated.source_last_synced_at !== null, "updated bank's source_last_synced_at is set");

      const unchanged = await getBank(bankUnchanged.id);
      assert(unchanged.updated_at === beforeUnchangedUpdatedAt, "unchanged bank's updated_at is untouched (no-op guard covers source_last_synced_at correctly)");
      assert(unchanged.source_last_synced_at !== null, "unchanged bank's source_last_synced_at is still bumped despite no content change");

      const reactivated = await getBank(bankToReactivate.id);
      assert(reactivated.is_active === true, "reactivated bank is active again");
      assert(reactivated.inactive_reason === null, "reactivated bank's inactive_reason is cleared");
      assert(reactivated.id === bankToReactivate.id, "reactivation preserves the original bank id");

      const stillManuallyInactive = await getBank(bankManuallyInactive.id);
      assert(stillManuallyInactive.is_active === false, "manually-inactive bank was never auto-reactivated");
      assert(stillManuallyInactive.inactive_reason === "closed", "manually-inactive bank's reason is untouched");

      const rejectedDuplicateTarget = await getBank(bankRejectedDuplicateTarget.id);
      assert(rejectedDuplicateTarget.is_active === true, "a rejected-duplicate-identifier row's existing bank is never inactivated");
      assert(rejectedDuplicateTarget.website === "https://untouched.example", "a rejected-duplicate-identifier row's existing bank is left completely untouched");

      const closed = await getBank(bankToClose.id);
      assert(closed.is_active === false, "a bank absent from staging entirely is inactivated");
      assert(closed.inactive_reason === "unlisted", "an automated closure is always reason='unlisted'");

      const unrelated = await getBank(bankUnrelatedScope.id);
      assert(unrelated.is_active === true, "an ncua-scoped bank is untouched by an fdic-scoped run");

      const community = await getBank(bankUnlinkedCommunity.id);
      assert(community.is_active === true, "an unlinked community bank is never touched by any sync run");

      const { data: inserted } = await admin.from("banks").select("*").eq("fdic_cert", certNew).single();
      assert(inserted?.is_active === true, "the brand new bank was inserted and is active");
      assert(inserted?.source_authority === "fdic", "the brand new bank's source_authority is set");
      if (inserted) createdBankIds.push(inserted.id);
    }

    console.log("\nScenario B: base_snapshot_hash drift aborts finalize entirely, and the CLI's own failure-transition still works afterward");
    {
      const cert = nextCert();
      const bank = await insertBank({ source_authority: "fdic", fdic_cert: cert });

      const runId = await createRun("fdic");
      await stageInstitutions(runId, [
        { source_authority: "fdic", source_identifier: cert, status: "valid", name: bank.name, proposed_slug: "unused" },
      ]);
      await stageRun(runId, "fdic");

      // Simulate a concurrent write to production landing between staging
      // and apply — the exact scenario base_snapshot_hash exists to catch.
      const { error: driftError } = await admin.from("banks").update({ phone: "555-0100" }).eq("id", bank.id);
      if (driftError) throw driftError;

      const applyingOk = await transition(runId, "staged", "applying");
      assert(applyingOk, "staged -> applying transition succeeds even though drift will be caught downstream");

      const { data: result, error: rpcError } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
      assert(!result && !!rpcError, "finalize_sync_run rejects a run whose in-scope production state has drifted");
      assert(
        /changed since staging/i.test(rpcError?.message ?? ""),
        `error message names the drift (got: ${rpcError?.message})`
      );

      const runAfterAbort = await getRun(runId);
      assert(runAfterAbort.status === "applying", "an aborted finalize leaves status exactly where it was (transaction rolled back)");

      const untouchedBank = await getBank(bank.id);
      assert(untouchedBank.phone === "555-0100", "the drifted bank itself is unaffected by the aborted finalize (only the earlier direct update)");

      // What the real CLI does on RPC failure: its own statement, outside
      // the rolled-back transaction.
      const failedOk = await transition(runId, "applying", "failed", { guard_reason: "production_state_drifted_since_review" });
      assert(failedOk, "the CLI's own applying -> failed transition succeeds after an aborted finalize");
    }

    console.log("\nScenario C: two concurrent finalize_sync_run calls for the same run only ever apply once");
    {
      const cert = nextCert();
      const bank = await insertBank({ source_authority: "fdic", fdic_cert: cert });

      const runId = await createRun("fdic");
      await stageInstitutions(runId, [
        { source_authority: "fdic", source_identifier: cert, status: "valid", name: bank.name, proposed_slug: "unused" },
      ]);
      await stageRun(runId, "fdic");
      await transition(runId, "staged", "applying");

      const [r1, r2] = await Promise.all([
        admin.rpc("finalize_sync_run", { p_run_id: runId }),
        admin.rpc("finalize_sync_run", { p_run_id: runId }),
      ]);

      const succeeded = [r1, r2].filter((r) => !r.error);
      const failed = [r1, r2].filter((r) => r.error);
      assert(succeeded.length === 1, `exactly one of the two concurrent calls succeeds (got ${succeeded.length})`);
      assert(failed.length === 1, `exactly one of the two concurrent calls is rejected (got ${failed.length})`);
      assert(
        /not in applying status/i.test(failed[0]?.error?.message ?? ""),
        `the rejected call fails because the run is no longer 'applying' (got: ${failed[0]?.error?.message})`
      );

      const finalRun = await getRun(runId);
      assert(finalRun.status === "applied", "the run ends up applied exactly once");
      assert(finalRun.unchanged_count + finalRun.updated_count + finalRun.inserted_count === 1, "the single staged row was applied exactly once, not twice");
    }

    console.log("\nScenario D: the inactivation-cap override gate is enforced by finalize_sync_run itself, not just the CLI");
    {
      // Uses source_scope='ncua' (not 'fdic', already carrying leftover
      // fixture banks from earlier scenarios in this same run of the file)
      // and includes a real staged row for its own fixture bank, so the
      // second (post-override) finalize call exercises a normal apply —
      // not an incidental mass-inactivation of unrelated fixture banks —
      // while still genuinely proving the gate itself.
      const cert = nextCert();
      await insertNcuaCreditUnion(cert);
      const bank = await insertBank({ source_authority: "ncua", ncua_charter_number: cert });

      const runId = await createRun("ncua");
      await stageInstitutions(runId, [
        { source_authority: "ncua", source_identifier: cert, status: "valid", name: bank.name, proposed_slug: "unused" },
      ]);
      await stageRun(runId, "ncua");
      await admin
        .from("sync_runs")
        .update({ requires_override_reason: "inactivation_cap_exceeded" })
        .eq("id", runId);
      const applyingOk = await transition(runId, "staged", "applying");
      assert(applyingOk, "a run requiring an override can still reach 'applying' (the CLI is the first gate, not the only one)");

      const { data: result, error: rpcError } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
      assert(!result && !!rpcError, "finalize_sync_run itself refuses to apply an unoverridden inactivation-cap run");
      assert(
        /requires an unapplied override/i.test(rpcError?.message ?? ""),
        `error message names the override gate (got: ${rpcError?.message})`
      );

      const runAfter = await getRun(runId);
      assert(runAfter.status === "applying", "the run status is untouched by the rejected finalize attempt");

      const overrideOk = await admin
        .from("sync_runs")
        .update({ override_applied: true })
        .eq("id", runId)
        .eq("status", "applying")
        .select("id");
      assert(overrideOk.data?.length === 1, "override_applied can be set while still 'applying' (mirrors the real staged -> applying transition setting it atomically)");

      const { data: result2, error: rpcError2 } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
      assert(!rpcError2, `finalize_sync_run succeeds once override_applied is true (error: ${rpcError2?.message})`);
      assert(result2?.status === "applied", "the overridden run applies cleanly");
      assert(result2?.unchanged === 1, "the overridden run's own staged row applies as a normal unchanged match, not a mass-inactivation");
    }

    console.log("\nScenario E: the partial unique index rejects a second VALID row for the same identifier, but permits any number of rejected ones");
    {
      const cert = nextCert();
      const runId = await createRun("fdic");

      const { error: firstValidError } = await admin.from("sync_staging_institutions").insert({
        run_id: runId, source_authority: "fdic", source_identifier: cert, status: "valid", name: "First", proposed_slug: "unused",
      });
      assert(!firstValidError, `first valid row for an identifier inserts cleanly (error: ${firstValidError?.message})`);

      const { error: secondValidError } = await admin.from("sync_staging_institutions").insert({
        run_id: runId, source_authority: "fdic", source_identifier: cert, status: "valid", name: "Second", proposed_slug: "unused",
      });
      assert(secondValidError?.code === "23505", `a second VALID row for the same identifier is rejected by the partial unique index (got code ${secondValidError?.code})`);

      const { error: rejectedOneError } = await admin.from("sync_staging_institutions").insert({
        run_id: runId, source_authority: "fdic", source_identifier: cert, status: "rejected", reject_reason: "duplicate_identifier_in_source",
      });
      const { error: rejectedTwoError } = await admin.from("sync_staging_institutions").insert({
        run_id: runId, source_authority: "fdic", source_identifier: cert, status: "rejected", reject_reason: "duplicate_identifier_in_source",
      });
      assert(!rejectedOneError && !rejectedTwoError, "any number of REJECTED rows for the same identifier coexist fine (the partial index only covers status='valid')");
    }

    console.log("\nScenario F: finalize_sync_run's staging-integrity checks (post code-review hardening)");
    {
      const cert = nextCert();
      const bank = await insertBank({});

      console.log("  rejects a staged row whose source_authority is outside the run's own scope");
      {
        const runId = await createRun("fdic");
        await stageInstitutions(runId, [
          { source_authority: "fdic", source_identifier: nextCert(), status: "valid", name: bank.name, proposed_slug: "unused" },
        ]);
        // Simulates a bug (or direct tampering) that staged an ncua-authority
        // row under an fdic-scoped run — finalize_sync_run must catch this
        // itself, not just trust that only its own CLI ever writes here.
        await admin.from("sync_staging_institutions").insert({
          run_id: runId, source_authority: "ncua", source_identifier: cert, status: "valid", name: "Out Of Scope", proposed_slug: "unused",
        });
        await stageRun(runId, "fdic");
        await transition(runId, "staged", "applying");

        const { error } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
        assert(error?.code === "P0001", `rejected for an out-of-scope staged authority (got code ${error?.code}: ${error?.message})`);
        assert(/outside its own scope/i.test(error?.message ?? ""), `error message names the scope mismatch (got: ${error?.message})`);
      }

      console.log("  rejects a run whose staged row count doesn't match its recorded collected counts");
      {
        const runId = await createRun("fdic");
        await stageInstitutions(runId, [
          { source_authority: "fdic", source_identifier: nextCert(), status: "valid", name: bank.name, proposed_slug: "unused" },
        ]);
        await stageRun(runId, "fdic");
        // Simulate drift after staging: a row silently added (or removed)
        // post-review without the recorded count ever being updated to match.
        await admin.from("sync_staging_institutions").insert({
          run_id: runId, source_authority: "fdic", source_identifier: nextCert(), status: "valid", name: "Snuck In Afterward", proposed_slug: "unused",
        });
        await transition(runId, "staged", "applying");

        const { error } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
        assert(error?.code === "P0001", `rejected for a staged-count mismatch (got code ${error?.code}: ${error?.message})`);
        assert(/does not match what was reviewed/i.test(error?.message ?? ""), `error message names the count mismatch (got: ${error?.message})`);
      }

      console.log("  catches a compensating cross-authority count error a combined sum check would miss");
      {
        const ncuaCharter = nextCert();
        await insertNcuaCreditUnion(ncuaCharter);
        const runId = await createRun("both");
        // 2 fdic rows + 1 ncua row staged (3 total), but recorded as
        // fdic=1/ncua=2 — the SUM still matches (3), so only a per-
        // authority check (not the old combined-total one) can catch this.
        await stageInstitutions(runId, [
          { source_authority: "fdic", source_identifier: nextCert(), status: "valid", name: "Fdic One", proposed_slug: "unused" },
          { source_authority: "fdic", source_identifier: nextCert(), status: "valid", name: "Fdic Two", proposed_slug: "unused" },
          { source_authority: "ncua", source_identifier: ncuaCharter, status: "valid", name: "Ncua One", proposed_slug: "unused" },
        ]);
        const { data: baseHash } = await admin.rpc("compute_banks_base_snapshot_hash", { p_source_scope: "both" });
        const { data: stagingHash } = await admin.rpc("compute_staging_snapshot_hash", { p_run_id: runId });
        await transition(runId, "running", "staged", {
          base_snapshot_hash: baseHash,
          source_snapshot_hash: stagingHash,
          fdic_collected_count: 1,
          ncua_collected_count: 2,
        });
        await transition(runId, "staged", "applying");

        const { error } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
        assert(error?.code === "P0001", `rejected despite the combined total matching (got code ${error?.code}: ${error?.message})`);
        assert(/staged fdic row/i.test(error?.message ?? ""), `error message specifically names the fdic mismatch (got: ${error?.message})`);
      }

      console.log("  rejects a run whose staging rows changed since they were reviewed (source_snapshot_hash mismatch)");
      {
        const runId = await createRun("fdic");
        await stageInstitutions(runId, [
          { source_authority: "fdic", source_identifier: nextCert(), status: "valid", name: bank.name, proposed_slug: "unused" },
        ]);
        await stageRun(runId, "fdic");
        // Simulate a staged row's content changing after review (count
        // stays the same, so only the hash check can catch this).
        const { data: stagedRow } = await admin.from("sync_staging_institutions").select("id").eq("run_id", runId).single();
        await admin.from("sync_staging_institutions").update({ name: "Tampered Name" }).eq("id", stagedRow.id);
        await transition(runId, "staged", "applying");

        const { error } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
        assert(error?.code === "P0001", `rejected for a staging-content hash mismatch (got code ${error?.code}: ${error?.message})`);
        assert(/changed since they were reviewed/i.test(error?.message ?? ""), `error message names the staging drift (got: ${error?.message})`);
      }

      console.log("  rejects a run with no source_snapshot_hash recorded at all (predates this integrity check)");
      {
        const runId = await createRun("fdic");
        await stageInstitutions(runId, [
          { source_authority: "fdic", source_identifier: nextCert(), status: "valid", name: bank.name, proposed_slug: "unused" },
        ]);
        const { data: hash } = await admin.rpc("compute_banks_base_snapshot_hash", { p_source_scope: "fdic" });
        await transition(runId, "running", "staged", { base_snapshot_hash: hash, fdic_collected_count: 1 });
        await transition(runId, "staged", "applying");

        const { error } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
        assert(error?.code === "P0001", `rejected for a missing source_snapshot_hash (got code ${error?.code}: ${error?.message})`);
        assert(/no source_snapshot_hash recorded/i.test(error?.message ?? ""), `error message names the missing hash (got: ${error?.message})`);
      }
    }

    console.log("\nScenario G: sync_protected_fields keeps a manually-verified field untouched through finalize_sync_run (the real Richland Credit Union case)");
    {
      const cert = nextCert();
      const bank = await insertBank({
        source_authority: "fdic", fdic_cert: cert,
        website: "https://verified-by-a-human.example", total_assets: 1000,
        sync_protected_fields: ["website"],
      });

      const runId = await createRun("fdic");
      await stageInstitutions(runId, [
        {
          source_authority: "fdic", source_identifier: cert, status: "valid", name: bank.name,
          website: "https://truncated-source-value.example", total_assets: 2000, proposed_slug: "unused",
        },
      ]);
      await stageRun(runId, "fdic");
      await transition(runId, "staged", "applying");

      const { data: result, error } = await admin.rpc("finalize_sync_run", { p_run_id: runId });
      assert(!error, `finalize_sync_run succeeds (error: ${error?.message})`);
      assert(result?.updated === 1, `reports the row as updated, since total_assets genuinely changed (got ${result?.updated})`);

      const refreshed = await getBank(bank.id);
      assert(refreshed.website === "https://verified-by-a-human.example", "the protected website field was left completely untouched");
      assert(refreshed.total_assets === 2000, "an unprotected field (total_assets) still updates normally on the same row");
      assert(
        JSON.stringify(refreshed.sync_protected_fields) === JSON.stringify(["website"]),
        "sync_protected_fields itself is untouched by finalize_sync_run"
      );
    }
  } finally {
    console.log("\nCleaning up...");
    if (createdRunIds.length) await admin.from("sync_runs").delete().in("id", createdRunIds);
    if (createdBankIds.length) await admin.from("banks").delete().in("id", createdBankIds);
    // Must run after banks cleanup — banks.ncua_charter_number references
    // these rows.
    if (createdCharterNumbers.length) await admin.from("ncua_credit_unions").delete().in("charter_number", createdCharterNumbers);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
