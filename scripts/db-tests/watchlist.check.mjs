// v11.0 Phase 1: proves the raw table mechanics for watchlist_bank_follows/
// watchlist_route_follows against a real, freshly-replayed local Postgres —
// the unique constraints, the directional distinct-banks check, and that a
// repeat follow is idempotent (no duplicate row), same guarantee the
// Server Actions rely on (a 23505 unique_violation is treated as success,
// not an error).
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";
import { createTestBank, createTestUser, deleteTestUser, deleteTestBanks } from "./lib/fixtures.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function main() {
  const user = await createTestUser(admin, "watchlist");
  const bankA = await createTestBank(admin, "DbTest Watchlist Bank A");
  const bankB = await createTestBank(admin, "DbTest Watchlist Bank B");
  const bankIds = [bankA.id, bankB.id];

  try {
    console.log("\nFollowing a bank...");
    const { error: followError } = await admin
      .from("watchlist_bank_follows")
      .insert({ user_id: user.id, bank_id: bankA.id });
    assert(!followError, `bank follow insert succeeds (error: ${followError?.message})`);

    console.log("\nFollowing the same bank again (repeat click)...");
    const { error: dupeError } = await admin
      .from("watchlist_bank_follows")
      .insert({ user_id: user.id, bank_id: bankA.id });
    assert(dupeError?.code === "23505", `repeat bank follow violates the unique constraint (got code: ${dupeError?.code})`);

    const { data: bankFollows } = await admin
      .from("watchlist_bank_follows")
      .select("id")
      .eq("user_id", user.id)
      .eq("bank_id", bankA.id);
    assert(bankFollows?.length === 1, `exactly one bank follow row exists after the repeat click (got ${bankFollows?.length})`);

    console.log("\nUnfollowing the bank...");
    const { error: unfollowError } = await admin
      .from("watchlist_bank_follows")
      .delete()
      .eq("user_id", user.id)
      .eq("bank_id", bankA.id);
    assert(!unfollowError, `bank unfollow succeeds (error: ${unfollowError?.message})`);

    const { data: afterUnfollow } = await admin
      .from("watchlist_bank_follows")
      .select("id")
      .eq("user_id", user.id)
      .eq("bank_id", bankA.id);
    assert(afterUnfollow?.length === 0, "bank follow row is gone after unfollow");

    console.log("\nWatching a route...");
    const { error: routeFollowError } = await admin
      .from("watchlist_route_follows")
      .insert({ user_id: user.id, from_bank_id: bankA.id, to_bank_id: bankB.id });
    assert(!routeFollowError, `route follow insert succeeds (error: ${routeFollowError?.message})`);

    console.log("\nWatching the same route again (repeat click)...");
    const { error: routeDupeError } = await admin
      .from("watchlist_route_follows")
      .insert({ user_id: user.id, from_bank_id: bankA.id, to_bank_id: bankB.id });
    assert(
      routeDupeError?.code === "23505",
      `repeat route follow violates the unique constraint (got code: ${routeDupeError?.code})`
    );

    console.log("\nA route follow with identical from/to banks is rejected...");
    const { error: selfRouteError } = await admin
      .from("watchlist_route_follows")
      .insert({ user_id: user.id, from_bank_id: bankA.id, to_bank_id: bankA.id });
    assert(!!selfRouteError, "a self-referential route follow (from == to) is rejected by the check constraint");

    console.log("\nUnwatching the route...");
    const { error: routeUnfollowError } = await admin
      .from("watchlist_route_follows")
      .delete()
      .eq("user_id", user.id)
      .eq("from_bank_id", bankA.id)
      .eq("to_bank_id", bankB.id);
    assert(!routeUnfollowError, `route unfollow succeeds (error: ${routeUnfollowError?.message})`);

    const { data: afterRouteUnfollow } = await admin
      .from("watchlist_route_follows")
      .select("id")
      .eq("user_id", user.id)
      .eq("from_bank_id", bankA.id)
      .eq("to_bank_id", bankB.id);
    assert(afterRouteUnfollow?.length === 0, "route follow row is gone after unwatch");
  } finally {
    console.log("\nCleaning up...");
    await admin.from("watchlist_bank_follows").delete().eq("user_id", user.id);
    await admin.from("watchlist_route_follows").delete().eq("user_id", user.id);
    await deleteTestBanks(admin, bankIds);
    await deleteTestUser(admin, user.id);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
