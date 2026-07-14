// Runs every *.check.mjs file in this directory sequentially against a
// local Supabase instance (see lib/env.mjs) and fails loudly if any of
// them exits non-zero. Named `.check.mjs`, not `.test.mjs` — these are
// plain assert-and-exit scripts, not part of the vitest suite `npm test`
// runs (that suite is fully mocked and has no real Postgres to talk to).
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".check.mjs"))
  .sort();

if (files.length === 0) {
  console.error("No *.check.mjs files found in scripts/db-tests/");
  process.exit(1);
}

let failed = false;
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(dir, file)], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
