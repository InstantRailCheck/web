// Real-Postgres coverage for user_moderation_status enforcement — runs
// against a local Supabase instance (see scripts/db-tests/lib/env.mjs),
// never production. Proves the DB-level backstop actually blocks a direct,
// RLS-authenticated client insert (bypassing every Server Action), not
// just that the app-level check works — the app-level check is covered by
// mocked Vitest tests instead, since this table's real security boundary
// is RLS + the quota triggers, not the Server Action.
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient, createLocalUserClient } from "./lib/env.mjs";
import { createTestBank, createTestUser, deleteTestUser, deleteTestBanks } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function insertRouteReport(client, fromBankId, toBankId, userId) {
  return client.from("route_reports").insert({
    from_bank_id: fromBankId,
    to_bank_id: toBankId,
    rail_used: "ACH",
    direction: "push",
    status: "success",
    tested_at: new Date().toISOString().slice(0, 10),
    settlement_time_minutes: 30,
    same_day: true,
    notes: null,
    user_id: userId,
  });
}

async function insertEddReport(client, bankId, userId) {
  return client.from("edd_reports").insert({ bank_id: bankId, days_early: 1, user_id: userId });
}

async function main() {
  const target = await createTestUser(admin, "enforce-target");
  const moderator = await createTestUser(admin, "enforce-mod");
  const bankA = await createTestBank(admin, "DbTest Bank A");
  const bankB = await createTestBank(admin, "DbTest Bank B");
  const bankIds = [bankA.id, bankB.id];

  const targetClient = await createLocalUserClient(target.email, target.password);

  try {
    console.log("\nSelf-action is rejected by the RPC directly");
    {
      const { error } = await admin.rpc("moderate_set_user_status", {
        p_user_id: moderator.id,
        p_moderator_id: moderator.id,
        p_status: "restricted",
        p_reason: "self-action check",
        p_reason_category: "other",
        p_ban_hours: null,
      });
      assert(error?.code === "P0003", `self-action raises P0003 (got: ${error?.code})`);
    }

    console.log("\nActive user can submit route_reports/edd_reports directly (RLS-authenticated)");
    {
      const { error: rrError } = await insertRouteReport(targetClient, bankA.id, bankB.id, target.id);
      assert(!rrError, `active user's direct route_reports insert succeeds (error: ${rrError?.message})`);
      const { error: eddError } = await insertEddReport(targetClient, bankA.id, target.id);
      assert(!eddError, `active user's direct edd_reports insert succeeds (error: ${eddError?.message})`);
    }

    console.log("\nRestricted user is blocked at the DB level on both tables");
    {
      const { error: rpcError } = await admin.rpc("moderate_set_user_status", {
        p_user_id: target.id,
        p_moderator_id: moderator.id,
        p_status: "restricted",
        p_reason: "db-test restrict",
        p_reason_category: "spam",
        p_ban_hours: null,
      });
      assert(!rpcError, `restrict RPC succeeds (error: ${rpcError?.message})`);

      const { error: rrError } = await insertRouteReport(targetClient, bankA.id, bankB.id, target.id);
      assert(rrError?.message?.includes("restricted"), `restricted user's route_reports insert is rejected (got: ${rrError?.message})`);

      const { error: eddError } = await insertEddReport(targetClient, bankA.id, target.id);
      assert(eddError?.message?.includes("restricted"), `restricted user's edd_reports insert is rejected (got: ${eddError?.message})`);
    }

    console.log("\nReactivate un-blocks both tables and updates (not deletes) the row");
    {
      const { error: rpcError } = await admin.rpc("moderate_set_user_status", {
        p_user_id: target.id,
        p_moderator_id: moderator.id,
        p_status: "active",
        p_reason: "db-test reactivate",
        p_reason_category: "other",
        p_ban_hours: null,
      });
      assert(!rpcError, `reactivate RPC succeeds (error: ${rpcError?.message})`);

      const { data: row } = await admin.from("user_moderation_status").select("status").eq("user_id", target.id).single();
      assert(row?.status === "active", `row still exists with status 'active' (got: ${row?.status})`);

      const { error: rrError } = await insertRouteReport(targetClient, bankA.id, bankB.id, target.id);
      assert(!rrError, `reactivated user's route_reports insert succeeds (error: ${rrError?.message})`);
    }

    console.log("\nTemporarily banned blocks while unexpired; a synthetically-expired row does not block");
    {
      const { error: rpcError } = await admin.rpc("moderate_set_user_status", {
        p_user_id: target.id,
        p_moderator_id: moderator.id,
        p_status: "temporarily_banned",
        p_reason: "db-test temp ban",
        p_reason_category: "abuse",
        p_ban_hours: 24,
      });
      assert(!rpcError, `temp ban RPC succeeds (error: ${rpcError?.message})`);

      const { error: rrError } = await insertRouteReport(targetClient, bankA.id, bankB.id, target.id);
      assert(rrError?.message?.includes("restricted"), `unexpired temp ban blocks route_reports (got: ${rrError?.message})`);

      // Force the row into an already-expired state directly (not via the
      // RPC) — proves the read-side expiry check, not the RPC's own
      // duration math, and avoids waiting out a real ban in CI.
      await admin
        .from("user_moderation_status")
        .update({ ban_expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("user_id", target.id);

      const { error: rrError2 } = await insertRouteReport(targetClient, bankA.id, bankB.id, target.id);
      assert(!rrError2, `expired temp ban no longer blocks route_reports (error: ${rrError2?.message})`);
    }

    console.log("\nPermanently banned blocks at the DB level");
    {
      const { error: rpcError } = await admin.rpc("moderate_set_user_status", {
        p_user_id: target.id,
        p_moderator_id: moderator.id,
        p_status: "permanently_banned",
        p_reason: "db-test permanent ban",
        p_reason_category: "abuse",
        p_ban_hours: null,
      });
      assert(!rpcError, `permanent ban RPC succeeds (error: ${rpcError?.message})`);

      const { error: rrError } = await insertRouteReport(targetClient, bankA.id, bankB.id, target.id);
      assert(rrError?.message?.includes("restricted"), `permanent ban blocks route_reports (got: ${rrError?.message})`);
      const { error: eddError } = await insertEddReport(targetClient, bankA.id, target.id);
      assert(eddError?.message?.includes("restricted"), `permanent ban blocks edd_reports (got: ${eddError?.message})`);
    }
  } finally {
    console.log("\nCleaning up...");
    await admin.from("route_reports").delete().eq("user_id", target.id);
    await admin.from("edd_reports").delete().eq("user_id", target.id);
    await admin.from("moderation_actions").delete().or(`subject_user_id.eq.${target.id},moderator_user_id.eq.${target.id}`);
    await deleteTestBanks(admin, bankIds);
    await deleteTestUser(admin, target.id);
    await deleteTestUser(admin, moderator.id);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
