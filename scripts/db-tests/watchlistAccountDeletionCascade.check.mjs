// v11.0 Phase 1: watchlist_bank_follows/watchlist_route_follows are
// on delete cascade on user_id (unlike route_reports/edd_reports, which
// anonymize instead) — a watchlist is purely personal with no communal
// evidence value once its owner is gone, same treatment as webhooks. This
// proves the cascade actually fires, not just that the migration compiles.
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";
import { createTestBank, createTestUser, deleteTestBanks } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function main() {
  const user = await createTestUser(admin, "watchlist-cascade");
  const bankA = await createTestBank(admin, "DbTest Watchlist Cascade Bank A");
  const bankB = await createTestBank(admin, "DbTest Watchlist Cascade Bank B");
  const bankIds = [bankA.id, bankB.id];

  try {
    const { error: bankFollowError } = await admin
      .from("watchlist_bank_follows")
      .insert({ user_id: user.id, bank_id: bankA.id });
    assert(!bankFollowError, `seed bank follow succeeds (error: ${bankFollowError?.message})`);

    const { error: routeFollowError } = await admin
      .from("watchlist_route_follows")
      .insert({ user_id: user.id, from_bank_id: bankA.id, to_bank_id: bankB.id });
    assert(!routeFollowError, `seed route follow succeeds (error: ${routeFollowError?.message})`);

    console.log("\nDeleting the auth user cascades both watchlist tables...");
    const { error: userDeleteError } = await admin.auth.admin.deleteUser(user.id);
    assert(!userDeleteError, `deleteUser succeeds (error: ${userDeleteError?.message})`);

    const { data: bankFollowsAfter } = await admin
      .from("watchlist_bank_follows")
      .select("id")
      .eq("bank_id", bankA.id);
    assert(bankFollowsAfter?.length === 0, "watchlist_bank_follows row is gone (ON DELETE CASCADE)");

    const { data: routeFollowsAfter } = await admin
      .from("watchlist_route_follows")
      .select("id")
      .eq("from_bank_id", bankA.id)
      .eq("to_bank_id", bankB.id);
    assert(routeFollowsAfter?.length === 0, "watchlist_route_follows row is gone (ON DELETE CASCADE)");
  } finally {
    console.log("\nCleaning up...");
    await deleteTestBanks(admin, bankIds);
    // user was already deleted as part of the test itself.
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
