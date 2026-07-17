// v8.0 institution lifecycle (§11) — proves the two trigger functions added
// in 20260716001000 actually enforce inactive-bank rejection at the table,
// not just in application code, using a REAL authenticated-role client
// (not the admin client, which bypasses RLS and triggers alike would still
// run for, but wouldn't prove anything about what a direct browser insert
// can or can't do). Deliberately never chains .select() after .insert() on
// route_reports/edd_reports as the authenticated user — both tables have
// no SELECT policy for authenticated, and doing so surfaces a RETURNING-
// clause RLS error unrelated to what this test is checking (see
// 20260711035000's history of that exact false alarm).
import crypto from "node:crypto";
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient, createLocalUserClient } from "./lib/env.mjs";
import { createTestUser, deleteTestUser } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function insertBank(overrides) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { data, error } = await admin
    .from("banks")
    .insert({ name: `DbTest Enforcement Bank ${suffix}`, slug: `db-test-enforcement-${suffix}`, ...overrides })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function main() {
  const testUser = await createTestUser(admin, "inactive-bank-enforcement");
  const userClient = await createLocalUserClient(testUser.email, testUser.password);
  const bankIds = [];
  const today = new Date().toISOString().slice(0, 10);

  try {
    const activeBankId = await insertBank({ is_active: true });
    const inactiveBankId = await insertBank({ is_active: false, inactive_reason: "unlisted" });
    bankIds.push(activeBankId, inactiveBankId);

    console.log("\nroute_reports: INSERT enforcement");
    {
      const { error: rejectError } = await userClient.from("route_reports").insert({
        user_id: testUser.id, from_bank_id: inactiveBankId, status: "success", rail_used: "ACH", tested_at: today,
      });
      assert(
        rejectError?.code === "P0001",
        `insert against an inactive bank is rejected by the trigger, not RLS (got code ${rejectError?.code}: ${rejectError?.message})`
      );

      const marker = `enforcement-marker-${crypto.randomUUID().slice(0, 8)}`;
      const { error: acceptError } = await userClient.from("route_reports").insert({
        user_id: testUser.id, from_bank_id: activeBankId, status: "success", rail_used: "ACH", tested_at: today, notes: marker,
      });
      assert(!acceptError, `insert against an active bank succeeds (error: ${acceptError?.message})`);

      const { data: row, error: lookupError } = await admin
        .from("route_reports")
        .select("id, from_bank_id")
        .eq("notes", marker)
        .single();
      if (lookupError) throw lookupError;

      console.log("route_reports: UPDATE enforcement (only checked when the reference actually changes)");
      await admin.from("banks").update({ is_active: false, inactive_reason: "unlisted" }).eq("id", activeBankId);

      const { error: unrelatedUpdateError } = await admin
        .from("route_reports")
        .update({ notes: `${marker}-edited` })
        .eq("id", row.id);
      assert(
        !unrelatedUpdateError,
        `an update that leaves from_bank_id/to_bank_id untouched succeeds even though the referenced bank is now inactive (error: ${unrelatedUpdateError?.message})`
      );

      const { error: changedUpdateError } = await admin
        .from("route_reports")
        .update({ from_bank_id: inactiveBankId })
        .eq("id", row.id);
      assert(
        changedUpdateError?.code === "P0001",
        `an update that changes from_bank_id to an inactive bank is rejected (got code ${changedUpdateError?.code}: ${changedUpdateError?.message})`
      );

      await admin.from("route_reports").delete().eq("id", row.id);
    }

    console.log("\nedd_reports: INSERT enforcement");
    {
      const activeBankId2 = await insertBank({ is_active: true });
      const inactiveBankId2 = await insertBank({ is_active: false, inactive_reason: "unlisted" });
      bankIds.push(activeBankId2, inactiveBankId2);

      const { error: rejectError } = await userClient.from("edd_reports").insert({
        user_id: testUser.id, bank_id: inactiveBankId2, days_early: 1,
      });
      assert(
        rejectError?.code === "P0001",
        `insert against an inactive bank is rejected by the trigger, not RLS (got code ${rejectError?.code}: ${rejectError?.message})`
      );

      const { error: acceptError } = await userClient.from("edd_reports").insert({
        user_id: testUser.id, bank_id: activeBankId2, days_early: 1,
      });
      assert(!acceptError, `insert against an active bank succeeds (error: ${acceptError?.message})`);

      const { data: row, error: lookupError } = await admin
        .from("edd_reports")
        .select("id")
        .eq("user_id", testUser.id)
        .eq("bank_id", activeBankId2)
        .single();
      if (lookupError) throw lookupError;

      console.log("edd_reports: UPDATE enforcement (only checked when the reference actually changes)");
      await admin.from("banks").update({ is_active: false, inactive_reason: "unlisted" }).eq("id", activeBankId2);

      const { error: unrelatedUpdateError } = await admin
        .from("edd_reports")
        .update({ days_early: 2 })
        .eq("id", row.id);
      assert(
        !unrelatedUpdateError,
        `an update that leaves bank_id untouched succeeds even though the referenced bank is now inactive (error: ${unrelatedUpdateError?.message})`
      );

      const { error: changedUpdateError } = await admin
        .from("edd_reports")
        .update({ bank_id: inactiveBankId2 })
        .eq("id", row.id);
      assert(
        changedUpdateError?.code === "P0001",
        `an update that changes bank_id to an inactive bank is rejected (got code ${changedUpdateError?.code}: ${changedUpdateError?.message})`
      );

      await admin.from("edd_reports").delete().eq("id", row.id);
    }
  } finally {
    console.log("\nCleaning up...");
    await admin.from("route_reports").delete().eq("user_id", testUser.id);
    await admin.from("edd_reports").delete().eq("user_id", testUser.id);
    if (bankIds.length) await admin.from("banks").delete().in("id", bankIds);
    await deleteTestUser(admin, testUser.id);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
