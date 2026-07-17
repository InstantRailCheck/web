// v8.0 §5: exercises apply_bank_reconciliation against real Postgres —
// atomic whole-batch apply, rejection of an already-linked bank, rejection
// of an already-claimed identifier, and whole-batch rollback when one
// entry in the batch is invalid (no partial apply).
import crypto from "node:crypto";
import { createAssert } from "./lib/assert.mjs";
import { createLocalAdminClient } from "./lib/env.mjs";

const { assert, report } = createAssert();
const admin = createLocalAdminClient();

const createdBankIds = [];

function bankRow(overrides) {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    name: `DbTest Reconciliation Bank ${suffix}`,
    slug: `db-test-reconciliation-${suffix}`,
    is_active: true,
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

const CERT_BASE = Math.floor(Date.now() / 1000);
let certOffset = 0;
function nextCert() {
  return CERT_BASE + certOffset++;
}

async function main() {
  try {
    console.log("\nApplies a batch of approved matches atomically");
    {
      const bankA = await insertBank({});
      const bankB = await insertBank({});
      const certA = nextCert();
      const certB = nextCert();

      const { data: result, error } = await admin.rpc("apply_bank_reconciliation", {
        p_matches: [
          { bank_id: bankA.id, source_authority: "fdic", identifier: certA },
          { bank_id: bankB.id, source_authority: "fdic", identifier: certB },
        ],
      });
      assert(!error, `batch apply succeeds (error: ${error?.message})`);
      assert(result?.applied_count === 2, `reports applied_count=2 (got ${result?.applied_count})`);

      const refreshedA = await getBank(bankA.id);
      const refreshedB = await getBank(bankB.id);
      assert(refreshedA.fdic_cert === certA, "bank A's fdic_cert is set");
      assert(refreshedA.source_authority === "fdic", "bank A's source_authority is set");
      assert(refreshedA.source_last_synced_at !== null, "bank A's source_last_synced_at is set");
      assert(refreshedB.fdic_cert === certB, "bank B's fdic_cert is set");
    }

    console.log("\nRejects a bank that's already linked (no longer unlinked)");
    {
      const cert1 = nextCert();
      const cert2 = nextCert();
      const alreadyLinked = await insertBank({ fdic_cert: cert1, source_authority: "fdic" });

      const { error } = await admin.rpc("apply_bank_reconciliation", {
        p_matches: [{ bank_id: alreadyLinked.id, source_authority: "fdic", identifier: cert2 }],
      });
      assert(error?.code === "P0001", `rejected as no-longer-unlinked (got code ${error?.code}: ${error?.message})`);

      const unchanged = await getBank(alreadyLinked.id);
      assert(unchanged.fdic_cert === cert1, "the bank's original fdic_cert is untouched");
    }

    console.log("\nRejects an identifier that's already claimed by another bank");
    {
      const cert = nextCert();
      await insertBank({ fdic_cert: cert, source_authority: "fdic" });
      const unlinkedBank = await insertBank({});

      const { error } = await admin.rpc("apply_bank_reconciliation", {
        p_matches: [{ bank_id: unlinkedBank.id, source_authority: "fdic", identifier: cert }],
      });
      assert(error?.code === "P0001", `rejected as already-claimed (got code ${error?.code}: ${error?.message})`);

      const unchanged = await getBank(unlinkedBank.id);
      assert(unchanged.fdic_cert === null, "the unlinked bank was never touched");
    }

    console.log("\nOne invalid entry rolls back the entire batch — no partial apply");
    {
      const validBank = await insertBank({});
      const invalidBank = await insertBank({ fdic_cert: nextCert(), source_authority: "fdic" }); // already linked
      const validCert = nextCert();
      const someOtherCert = nextCert();

      const { error } = await admin.rpc("apply_bank_reconciliation", {
        p_matches: [
          { bank_id: validBank.id, source_authority: "fdic", identifier: validCert },
          { bank_id: invalidBank.id, source_authority: "fdic", identifier: someOtherCert },
        ],
      });
      assert(!!error, "the whole batch call fails");

      const stillUnlinked = await getBank(validBank.id);
      assert(stillUnlinked.fdic_cert === null, "the VALID entry earlier in the batch was rolled back too — no partial apply");
    }
  } finally {
    console.log("\nCleaning up...");
    if (createdBankIds.length) await admin.from("banks").delete().in("id", createdBankIds);
  }

  report();
}

main().catch((err) => {
  console.error("db-test crashed:", err);
  process.exitCode = 1;
});
