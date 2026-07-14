// Proves the FK erasure guarantees hold for every action type this
// feature adds, not just one: deleting an auth user cascades their
// user_moderation_status row away entirely (on delete cascade — it's an
// enforcement row, no reason to keep it once there's no account left to
// enforce against) and nulls subject_user_id on every moderation_actions
// row that referenced them (on delete set null — the audit row itself
// persists; only the identity link is erased), across every action type:
// a status change, a content-deletion (via moderate_delete_submission),
// and the two admin-initiated action types that write moderation_actions
// directly (account deletion, email reveal).
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";
import { createTestBank, createTestUser, deleteTestUser, deleteTestBanks } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function main() {
  const target = await createTestUser(admin, "cascade-target");
  const moderator = await createTestUser(admin, "cascade-mod");
  const bankA = await createTestBank(admin, "DbTest Cascade Bank A");
  const bankB = await createTestBank(admin, "DbTest Cascade Bank B");
  const bankIds = [bankA.id, bankB.id];

  try {
    // (a) a content deletion, mirroring moderate_delete_submission. Seed
    // this before restricting the user: the enforcement trigger is supposed
    // to reject new reports once the status change below has landed.
    const { data: reportRow, error: seedError } = await admin
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
        notes: "cascade check",
        user_id: target.id,
      })
      .select("id")
      .single();
    assert(!seedError, `seed route_reports insert succeeds (error: ${seedError?.message})`);
    const { error: deleteError } = await admin.rpc("moderate_delete_submission", {
      p_target_table: "route_reports",
      p_target_id: reportRow.id,
      p_moderator_id: moderator.id,
      p_reason: "cascade check — content deletion",
      p_reason_category: "other",
    });
    assert(!deleteError, `seed content deletion succeeds (error: ${deleteError?.message})`);

    // (b) a status change
    const { error: statusError } = await admin.rpc("moderate_set_user_status", {
      p_user_id: target.id,
      p_moderator_id: moderator.id,
      p_status: "restricted",
      p_reason: "cascade check — status change",
      p_reason_category: "other",
      p_ban_hours: null,
    });
    assert(!statusError, `seed status change succeeds (error: ${statusError?.message})`);

    // (c) an account-deletion-style audit row, mirroring
    // moderateDeleteUserAccount.ts's pre-attempt insert
    const { error: acctAuditError } = await admin.from("moderation_actions").insert({
      moderator_user_id: moderator.id,
      action_type: "delete_account",
      target_table: "auth_users",
      target_id: null,
      subject_user_id: target.id,
      reason: "cascade check — account deletion audit",
      reason_category: "other",
      snapshot: { outcome: "attempted" },
    });
    assert(!acctAuditError, `seed account-deletion audit row succeeds (error: ${acctAuditError?.message})`);

    // (d) an email-reveal audit row, mirroring revealUserEmail.ts
    const { error: revealAuditError } = await admin.from("moderation_actions").insert({
      moderator_user_id: moderator.id,
      action_type: "reveal_email",
      target_table: "auth_users",
      target_id: null,
      subject_user_id: target.id,
      reason: "Viewed on user profile page",
      reason_category: "other",
      snapshot: {},
    });
    assert(!revealAuditError, `seed email-reveal audit row succeeds (error: ${revealAuditError?.message})`);

    console.log("\nDeleting the auth user cascades correctly across every row type");
    {
      const { error: userDeleteError } = await admin.auth.admin.deleteUser(target.id);
      assert(!userDeleteError, `deleteUser succeeds (error: ${userDeleteError?.message})`);

      const { data: statusRow } = await admin.from("user_moderation_status").select("user_id").eq("user_id", target.id).maybeSingle();
      assert(!statusRow, "user_moderation_status row is gone (ON DELETE CASCADE)");

      const { data: actions } = await admin
        .from("moderation_actions")
        .select("action_type, subject_user_id")
        .in("action_type", ["restrict", "delete", "delete_account", "reveal_email"])
        .or(`subject_user_id.is.null,subject_user_id.eq.${target.id}`);

      const byType = Object.fromEntries((actions ?? []).map((a) => [a.action_type, a]));

      for (const type of ["restrict", "delete", "delete_account", "reveal_email"]) {
        assert(byType[type], `a "${type}" audit row still exists after deletion`);
        assert(
          byType[type] && byType[type].subject_user_id === null,
          `"${type}" audit row's subject_user_id is null after deletion (got: ${byType[type]?.subject_user_id})`
        );
      }
    }
  } finally {
    console.log("\nCleaning up...");
    await admin.from("moderation_actions").delete().eq("moderator_user_id", moderator.id);
    await deleteTestBanks(admin, bankIds);
    await deleteTestUser(admin, moderator.id);
    // target was already deleted as part of the test itself.
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
