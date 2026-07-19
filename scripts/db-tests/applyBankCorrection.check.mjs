// Code review finding (post-v8.3.4, extended post-v8.5.0): exercises
// apply_bank_correction against real Postgres — runtime field allowlist,
// inactive-bank rejection, atomic insert+update on a match, insert-only on
// a non-match, whole-transaction rollback when the correction insert fails
// (a nonexistent user_id violates bank_corrections.user_id's FK — the same
// technique addBankAttribution.check.mjs uses to force a real rollback
// without touching the constraint itself), and rejection of a stale
// previous_value (a concurrent write landed between submitCorrection.ts's
// read and this RPC call).
import crypto from "node:crypto";
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

const createdBankIds = [];
const createdUserIds = [];

function bankRow(overrides) {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    name: `DbTest Correction Bank ${suffix}`,
    slug: `db-test-correction-${suffix}`,
    is_active: true,
    website: "https://old.example.com",
    phone: "555-0000",
    ...overrides,
  };
}

async function insertBank(overrides) {
  const { data, error } = await admin.from("banks").insert(bankRow(overrides)).select("*").single();
  if (error) throw error;
  createdBankIds.push(data.id);
  return data;
}

async function getBank(id) {
  const { data, error } = await admin.from("banks").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function createUser() {
  const email = `db-test-correction-${crypto.randomUUID()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function correctionsFor(bankId) {
  const { data, error } = await admin.from("bank_corrections").select("*").eq("bank_id", bankId);
  if (error) throw error;
  return data;
}

async function main() {
  try {
    const userId = await createUser();

    console.log("\nRejects a field outside the runtime allowlist");
    {
      const bank = await insertBank({});
      const { error } = await admin.rpc("apply_bank_correction", {
        p_bank_id: bank.id,
        p_user_id: userId,
        p_field: "is_active",
        p_submitted_value: "false",
        p_previous_value: null,
        p_matched: true,
        p_official_value: "false",
      });
      assert(error?.code === "P0001", `rejected as invalid field (got ${error?.code}: ${error?.message})`);
      assert((await correctionsFor(bank.id)).length === 0, "no bank_corrections row was created");
    }

    console.log("\nRejects a correction against an inactive institution");
    {
      const bank = await insertBank({ is_active: false, inactive_reason: "unlisted" });
      const { error } = await admin.rpc("apply_bank_correction", {
        p_bank_id: bank.id,
        p_user_id: userId,
        p_field: "website",
        p_submitted_value: "https://new.example.com",
        p_previous_value: "https://old.example.com",
        p_matched: true,
        p_official_value: "https://new.example.com",
      });
      assert(error?.code === "P0001", `rejected as inactive (got ${error?.code}: ${error?.message})`);
      assert((await correctionsFor(bank.id)).length === 0, "no bank_corrections row was created for the inactive bank");
    }

    console.log("\nOn a match, atomically inserts the correction record and updates the bank column");
    {
      const bank = await insertBank({});
      const { data, error } = await admin
        .rpc("apply_bank_correction", {
          p_bank_id: bank.id,
          p_user_id: userId,
          p_field: "website",
          p_submitted_value: "https://real-charter.example.com",
          p_previous_value: bank.website,
          p_matched: true,
          p_official_value: "https://real-charter.example.com",
        })
        .single();
      assert(!error, `apply succeeds (error: ${error?.message})`);
      assert(data?.status === "auto_applied", `reports status=auto_applied (got ${data?.status})`);

      const refreshed = await getBank(bank.id);
      assert(refreshed.website === "https://real-charter.example.com", "the bank's website was updated");
      assert(refreshed.phone === "555-0000", "the bank's phone (a different column) was left untouched");

      const corrections = await correctionsFor(bank.id);
      assert(corrections.length === 1 && corrections[0].status === "auto_applied", "one auto_applied correction row was recorded");
    }

    console.log("\nOn a non-match, records pending_review without touching the bank");
    {
      const bank = await insertBank({});
      const { data, error } = await admin
        .rpc("apply_bank_correction", {
          p_bank_id: bank.id,
          p_user_id: userId,
          p_field: "phone",
          p_submitted_value: "555-9999",
          p_previous_value: bank.phone,
          p_matched: false,
          p_official_value: null,
        })
        .single();
      assert(!error, `apply succeeds (error: ${error?.message})`);
      assert(data?.status === "pending_review", `reports status=pending_review (got ${data?.status})`);

      const refreshed = await getBank(bank.id);
      assert(refreshed.phone === "555-0000", "the bank's phone was left untouched pending review");

      const corrections = await correctionsFor(bank.id);
      assert(corrections.length === 1 && corrections[0].status === "pending_review", "one pending_review correction row was recorded");
    }

    console.log("\nA nonexistent user_id rolls back the whole transaction — no bank update survives a failed correction insert");
    {
      const bank = await insertBank({});
      const nonexistentUserId = crypto.randomUUID();
      const { error } = await admin
        .rpc("apply_bank_correction", {
          p_bank_id: bank.id,
          p_user_id: nonexistentUserId,
          p_field: "website",
          p_submitted_value: "https://real-charter.example.com",
          p_previous_value: bank.website,
          p_matched: true,
          p_official_value: "https://real-charter.example.com",
        })
        .single();
      assert(
        error?.code === "23503",
        `fails specifically on bank_corrections.user_id's FK (got ${error?.code ?? "no code"}: ${error?.message ?? "unexpected success"})`
      );

      const refreshed = await getBank(bank.id);
      assert(refreshed.website === "https://old.example.com", "the bank update was rolled back along with the failed insert");
      assert((await correctionsFor(bank.id)).length === 0, "no orphaned correction row was left behind");
    }

    console.log("\nRejects a stale previous_value — a concurrent write is never clobbered or misrecorded");
    {
      const bank = await insertBank({});
      const staleWebsite = bank.website;

      // Simulates a concurrent write landing between submitCorrection.ts's
      // read of the bank row and its later call into this RPC.
      const { error: concurrentUpdateError } = await admin
        .from("banks")
        .update({ website: "https://concurrent-write.example.com" })
        .eq("id", bank.id);
      if (concurrentUpdateError) throw concurrentUpdateError;

      const { error } = await admin
        .rpc("apply_bank_correction", {
          p_bank_id: bank.id,
          p_user_id: userId,
          p_field: "website",
          p_submitted_value: "https://real-charter.example.com",
          p_previous_value: staleWebsite,
          p_matched: true,
          p_official_value: "https://real-charter.example.com",
        })
        .single();
      assert(error?.code === "P0001", `rejected as stale (got ${error?.code}: ${error?.message})`);

      const refreshed = await getBank(bank.id);
      assert(refreshed.website === "https://concurrent-write.example.com", "the concurrent write was never clobbered");
      assert((await correctionsFor(bank.id)).length === 0, "no correction row was recorded against the stale previous_value");
    }
  } finally {
    console.log("\nCleaning up...");
    // bank_corrections.bank_id has no ON DELETE action (unlike user_id) —
    // clear correction rows before deleting their banks or the delete
    // below fails on the FK.
    if (createdBankIds.length) await admin.from("bank_corrections").delete().in("bank_id", createdBankIds);
    if (createdBankIds.length) await admin.from("banks").delete().in("id", createdBankIds);
    for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
