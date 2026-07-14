// Proves 20260715000000_add_review_flag_action_type.sql actually widened
// the real constraint (not just a local TypeScript type) — a real Postgres
// insert with action_type = 'review_flag' must succeed, and the CHECK must
// still reject an unrecognized value.
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";
import { createTestUser, deleteTestUser } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function main() {
  const admin_ = await createTestUser(admin, "review-flag-admin");
  const subject = await createTestUser(admin, "review-flag-subject");
  let insertedId = null;

  try {
    console.log("\naction_type = 'review_flag' is accepted by the widened CHECK constraint");
    {
      const { data, error } = await admin
        .from("moderation_actions")
        .insert({
          moderator_user_id: admin_.id,
          action_type: "review_flag",
          target_table: "route_reports",
          target_id: crypto.randomUUID(),
          subject_user_id: subject.id,
          reason: "db-test review",
          reason_category: "other",
          snapshot: { signals: [{ signal: "velocity", severity: "high", reason: "test" }], score: 3 },
        })
        .select("id")
        .single();
      assert(!error, `insert with action_type='review_flag' succeeds (error: ${error?.message})`);
      insertedId = data?.id ?? null;
    }

    console.log("\nAn unrecognized action_type is still rejected");
    {
      const { error } = await admin.from("moderation_actions").insert({
        moderator_user_id: admin_.id,
        action_type: "not_a_real_action_type",
        target_table: "route_reports",
        target_id: crypto.randomUUID(),
        subject_user_id: subject.id,
        reason: "db-test invalid",
        reason_category: "other",
        snapshot: {},
      });
      assert(Boolean(error), "insert with an invalid action_type is rejected");
      assert(error?.code === "23514", `rejection is specifically the CHECK constraint (got ${error?.code ?? "no code"})`);
    }
  } finally {
    console.log("\nCleaning up...");
    if (insertedId) await admin.from("moderation_actions").delete().eq("id", insertedId);
    await deleteTestUser(admin, admin_.id);
    await deleteTestUser(admin, subject.id);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
