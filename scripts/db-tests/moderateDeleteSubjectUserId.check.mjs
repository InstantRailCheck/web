// Proves the third revision of moderate_delete_submission
// (20260714020000_add_user_moderation_status.sql) populates
// moderation_actions.subject_user_id from the deleted row's own user_id,
// while target_id/target_table stay exactly as before (content-deletion
// actions are the first branch of moderation_actions_target_shape_check).
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";
import { createTestBank, createTestUser, deleteTestUser, deleteTestBanks } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function main() {
  const submitter = await createTestUser(admin, "delete-subject");
  const moderator = await createTestUser(admin, "delete-mod");
  const bankA = await createTestBank(admin, "DbTest Delete Bank A");
  const bankB = await createTestBank(admin, "DbTest Delete Bank B");
  const bankIds = [bankA.id, bankB.id];

  try {
    const { data: report_, error: insertError } = await admin
      .from("route_reports")
      .insert({
        from_bank_id: bankA.id,
        to_bank_id: bankB.id,
        rail_used: "ACH",
        direction: "push",
        status: "success",
        tested_at: new Date().toISOString().slice(0, 10),
        settlement_time_minutes: 30,
        same_day: true,
        notes: "db-test subject_user_id check",
        user_id: submitter.id,
      })
      .select("id")
      .single();
    assert(!insertError, `seed route_reports insert succeeds (error: ${insertError?.message})`);

    console.log("\nDeleting an attributable report populates subject_user_id");
    {
      const { error: deleteError } = await admin.rpc("moderate_delete_submission", {
        p_target_table: "route_reports",
        p_target_id: report_.id,
        p_moderator_id: moderator.id,
        p_reason: "db-test delete",
        p_reason_category: "other",
      });
      assert(!deleteError, `delete succeeds (error: ${deleteError?.message})`);

      const { data: action } = await admin
        .from("moderation_actions")
        .select("target_id, target_table, subject_user_id, snapshot")
        .eq("target_id", report_.id)
        .single();

      assert(action.target_table === "route_reports", `target_table unaffected (got: ${action.target_table})`);
      assert(action.target_id === report_.id, "target_id still the deleted submission's own id");
      assert(action.subject_user_id === submitter.id, `subject_user_id populated from the submission's user_id (got: ${action.subject_user_id})`);
      assert(!("user_id" in action.snapshot), "snapshot itself stays identity-free (no user_id key)");
    }
  } finally {
    console.log("\nCleaning up...");
    await admin.from("moderation_actions").delete().eq("subject_user_id", submitter.id);
    await deleteTestBanks(admin, bankIds);
    await deleteTestUser(admin, submitter.id);
    await deleteTestUser(admin, moderator.id);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
