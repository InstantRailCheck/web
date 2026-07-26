// Verifies that 20260726000000_add_route_reports_and_moderation_actions_indexes.sql
// actually created the indexes it claims to, against a real local Postgres
// instance with every migration replayed (see .github/workflows/test.yml's
// db-test job) — a CREATE INDEX with a typo'd column name or table name
// still succeeds silently as long as the SQL parses, so this is the only
// thing that would actually catch that.
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

const EXPECTED_INDEXES = {
  route_reports: [
    "route_reports_from_bank_id_to_bank_id_rail_used_idx",
    "route_reports_from_bank_id_idx",
    "route_reports_to_bank_id_idx",
    "route_reports_created_at_id_idx",
  ],
  moderation_actions: ["moderation_actions_subject_user_id_created_at_idx", "moderation_actions_action_type_subject_user_id_idx"],
};

async function main() {
  console.log("\nroute_reports and moderation_actions carry the indexes added in 20260726000000");

  for (const [table, expectedNames] of Object.entries(EXPECTED_INDEXES)) {
    const { data, error } = await admin.rpc("list_indexes_for_table", { p_table: table });
    assert(!error, `list_indexes_for_table('${table}') succeeded (${error?.message ?? ""})`);

    const actualNames = new Set(data ?? []);
    for (const name of expectedNames) {
      assert(actualNames.has(name), `${table} has index "${name}"`);
    }
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
