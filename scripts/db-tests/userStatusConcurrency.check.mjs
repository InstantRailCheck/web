// Proves moderate_set_user_status's advisory lock actually serializes
// concurrent calls for the same user — two calls racing should never both
// read the same "previous status," and the audit trail should reflect a
// single coherent chain, not a lost update. Same two-connection-race
// technique as v7.1.2's regression script for the pair-level lock.
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";
import { createTestUser, deleteTestUser } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

function callStatus(status, extra = {}) {
  return admin.rpc("moderate_set_user_status", {
    p_status: status,
    p_reason: `concurrency check — ${status}`,
    p_reason_category: "other",
    p_ban_hours: null,
    ...extra,
  });
}

async function main() {
  const target = await createTestUser(admin, "concurrency-target");
  const moderator = await createTestUser(admin, "concurrency-mod");

  try {
    console.log("\nTwo concurrent status changes for the same user serialize correctly");
    {
      const [r1, r2] = await Promise.all([
        callStatus("restricted", { p_user_id: target.id, p_moderator_id: moderator.id }),
        callStatus("temporarily_banned", { p_user_id: target.id, p_moderator_id: moderator.id, p_ban_hours: 24 }),
      ]);
      assert(!r1.error, `first concurrent call succeeds (error: ${r1.error?.message})`);
      assert(!r2.error, `second concurrent call succeeds (error: ${r2.error?.message})`);

      const { data: actions } = await admin
        .from("moderation_actions")
        .select("action_type, snapshot, created_at")
        .eq("subject_user_id", target.id)
        .order("created_at", { ascending: true });

      assert(actions.length === 2, `exactly two audit rows recorded (got ${actions.length})`);

      // Whichever call the lock let through second must have observed the
      // FIRST call's already-committed resulting_status as its own
      // previous_status — never the pre-transaction 'active' default both
      // calls would have seen without serialization.
      const secondRow = actions[1];
      const firstRow = actions[0];
      const firstResultingStatus = firstRow.snapshot.resulting_status;
      assert(
        secondRow.snapshot.previous_status === firstResultingStatus,
        `second call's previous_status ("${secondRow.snapshot.previous_status}") matches the first call's resulting_status ("${firstResultingStatus}") — no lost update`
      );

      const { data: finalRow } = await admin
        .from("user_moderation_status")
        .select("status")
        .eq("user_id", target.id)
        .single();
      assert(
        finalRow.status === secondRow.snapshot.resulting_status,
        `final row status matches whichever call actually landed second (got: ${finalRow.status})`
      );
    }
  } finally {
    console.log("\nCleaning up...");
    await admin.from("moderation_actions").delete().eq("subject_user_id", target.id);
    await deleteTestUser(admin, target.id);
    await deleteTestUser(admin, moderator.id);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
