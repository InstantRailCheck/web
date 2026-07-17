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
        .select("action_type, snapshot")
        .eq("subject_user_id", target.id);

      assert(actions.length === 2, `exactly two audit rows recorded (got ${actions.length})`);

      // moderation_actions.created_at defaults to now(), which Postgres
      // freezes at each transaction's BEGIN — not at the moment the row is
      // actually written. Since PostgREST opens a transaction per RPC call
      // and both calls here begin within microseconds of each other, the
      // one that loses the pg_advisory_xact_lock race can still have the
      // SMALLER created_at, making "order by created_at" an unreliable
      // (and, confirmed live, flaky ~30-50% of the time) way to tell which
      // call actually ran first. The snapshot chain itself is reliable —
      // whichever row's previous_status is the pre-test 'active' baseline
      // is definitionally the call that actually acquired the lock first
      // (both target statuses here are non-'active', so this is
      // unambiguous).
      const firstRow = actions.find((a) => a.snapshot.previous_status === "active");
      const secondRow = actions.find((a) => a !== firstRow);
      assert(!!firstRow && !!secondRow, "exactly one row's previous_status is the original 'active' baseline (the true first call)");
      assert(
        secondRow.snapshot.previous_status === firstRow.snapshot.resulting_status,
        `the other call's previous_status ("${secondRow?.snapshot.previous_status}") matches the first call's resulting_status ("${firstRow?.snapshot.resulting_status}") — no lost update`
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
