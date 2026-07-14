// Proves add_bank_with_attribution is atomic: a nonexistent p_user_id
// (well-formed UUID, no matching auth.users row) makes the second insert
// (bank_attributions.added_by_user_id's FK) fail, and the whole
// transaction — including the banks insert — rolls back. Deliberately
// doesn't touch the FK constraint itself to force the failure; a
// nonexistent user id is the real condition this atomicity guards
// against.
import crypto from "node:crypto";
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

async function main() {
  const bankName = `DbTest Rollback Bank ${crypto.randomUUID().slice(0, 8)}`;
  const slug = `db-test-rollback-${crypto.randomUUID().slice(0, 8)}`;
  const nonexistentUserId = crypto.randomUUID();

  console.log("\nadd_bank_with_attribution rolls back the bank insert when attribution fails");
  {
    const { error } = await admin
      .rpc("add_bank_with_attribution", { p_name: bankName, p_slug: slug, p_user_id: nonexistentUserId })
      .single();

    assert(
      error?.code === "23503",
      `RPC fails specifically on the attribution foreign key (got ${error?.code ?? "no code"}: ${error?.message ?? "unexpected success"})`
    );

    const { data: orphan } = await admin.from("banks").select("id").eq("slug", slug).maybeSingle();
    assert(!orphan, "no orphaned bank row was left behind after the failed attribution insert");
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
