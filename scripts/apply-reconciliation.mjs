// v8.0 §5. Takes a human-approved subset of audit-unlinked-banks.mjs's
// report (--input <path>) and links each approved bank to its FDIC/NCUA
// identifier — but only after re-running that same bank's full match
// search fresh, right now, and confirming the result is byte-identical to
// what was recorded at audit time (via sourceSnapshotHash). FDIC data is
// live and NCUA data resyncs monthly, so time has passed between audit and
// this run by definition — re-verifying is not optional. A mismatch means
// something changed (the bank's own website was edited, the official
// record changed, a new duplicate-name candidate appeared) and that entry
// is skipped as stale, never applied on stale evidence.
//
// Dry-run by default — prints what WOULD be applied and why anything was
// skipped, writes nothing. Only --apply calls apply_bank_reconciliation,
// and only with entries that passed the fresh re-check in THIS run.
//
// Usage: node scripts/apply-reconciliation.mjs --input <path> [--apply]
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import {
  findNcuaCandidates,
  findFdicCandidates,
  isCorroborated,
  snapshotHash,
} from "./lib/unlinkedBankReconciliation.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseArgs(argv) {
  const inputIndex = argv.indexOf("--input");
  const inputPath = inputIndex !== -1 ? argv[inputIndex + 1] : null;
  const apply = argv.includes("--apply");
  return { inputPath, apply };
}

async function main() {
  const { inputPath, apply } = parseArgs(process.argv.slice(2));
  if (!inputPath) {
    console.error("Usage: node scripts/apply-reconciliation.mjs --input <path> [--apply]");
    process.exit(1);
  }

  const raw = await readFile(inputPath, "utf-8");
  const approved = JSON.parse(raw);
  if (!Array.isArray(approved) || approved.length === 0) {
    console.error("Input file must be a non-empty JSON array of approved matches.");
    process.exit(1);
  }

  console.log(`${approved.length} approved match(es) to re-verify.\n`);
  if (!apply) {
    console.log("DRY RUN (pass --apply to actually write) — re-checking every entry against current data...\n");
  }

  const toApply = [];
  const skipped = [];

  for (const entry of approved) {
    const bankId = entry.bankId;
    if (!bankId) {
      skipped.push({ entry, reason: "missing bankId" });
      continue;
    }

    // Re-fetch the bank fresh — never trust the input file's own
    // bankWebsite/bankPhone, which is exactly the kind of stale data this
    // whole re-check exists to catch.
    const { data: bank, error: bankError } = await supabase
      .from("banks")
      .select("id, name, website, phone, fdic_cert, ncua_charter_number")
      .eq("id", bankId)
      .maybeSingle();
    if (bankError) throw bankError;
    if (!bank) {
      skipped.push({ entry, reason: "bank no longer exists" });
      continue;
    }
    if (bank.fdic_cert !== null || bank.ncua_charter_number !== null) {
      skipped.push({ entry, reason: `bank is no longer unlinked (already has fdic_cert=${bank.fdic_cert}, ncua_charter_number=${bank.ncua_charter_number})` });
      continue;
    }

    // Redo the exact same search the audit did — the recorded hash covers
    // the FULL candidate set found then, not just the one corroborated
    // candidate, so a comparable hash requires a comparable search.
    const [ncuaCandidates, fdicCandidates] = await Promise.all([
      findNcuaCandidates(supabase, bank.name),
      findFdicCandidates(bank.name),
    ]);
    const allCandidates = [...ncuaCandidates, ...fdicCandidates];
    const corroborated = allCandidates.filter((c) => isCorroborated(bank, c));
    const freshHash = snapshotHash(bank, allCandidates);

    if (freshHash !== entry.sourceSnapshotHash) {
      skipped.push({ entry, reason: "stale — current data no longer matches what was audited; re-run audit-unlinked-banks.mjs" });
      continue;
    }
    if (corroborated.length !== 1) {
      // Should be unreachable if the hash matched, but checked explicitly
      // rather than trusted implicitly.
      skipped.push({ entry, reason: `re-check found ${corroborated.length} corroborated candidate(s), expected exactly 1` });
      continue;
    }

    const candidate = corroborated[0];
    toApply.push({
      bank_id: bank.id,
      source_authority: candidate.sourceAuthority,
      identifier: candidate.identifier,
      // Only for the printed report below — never sent to the RPC.
      bankName: bank.name,
      candidateName: candidate.name,
    });
  }

  console.log(`${toApply.length} match(es) passed re-verification, ${skipped.length} skipped:\n`);
  for (const s of skipped) {
    console.log(`  SKIP  ${s.entry.bankName ?? s.entry.bankId}: ${s.reason}`);
  }
  for (const a of toApply) {
    console.log(`  OK    ${a.bankName} -> ${a.source_authority}:${a.identifier} (${a.candidateName})`);
  }

  if (toApply.length === 0) {
    console.log("\nNothing to apply.");
    return;
  }

  if (!apply) {
    console.log(`\nDry run complete. ${toApply.length} match(es) would be applied. Re-run with --apply to actually write them.`);
    return;
  }

  console.log(`\nApplying ${toApply.length} match(es) in one transaction...`);
  const { data: result, error } = await supabase.rpc("apply_bank_reconciliation", {
    p_matches: toApply.map(({ bank_id, source_authority, identifier }) => ({ bank_id, source_authority, identifier })),
  });
  if (error) {
    console.error(`Apply failed — the whole batch was rolled back, nothing was written: ${error.message}`);
    process.exit(1);
  }

  console.log(`Done. Applied ${result.applied_count} match(es).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
