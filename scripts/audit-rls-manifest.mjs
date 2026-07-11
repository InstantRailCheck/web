import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import {
  EXPECTED_RLS_ENABLED_TABLES,
  EXPECTED_POLICIES,
  EXPECTED_SECURITY_DEFINER_EXECUTE,
} from "./rlsManifest.mjs";

function sameRoles(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

// Pure diff — no network/DB access — so it's directly unit-testable without
// mocking supabase.rpc(). Returns a list of human-readable drift messages;
// an empty array means the manifest and the actual state agree.
export function diffManifest(actual, { expectedRlsEnabledTables, expectedPolicies, expectedSecurityDefinerExecute }) {
  const findings = [];

  for (const table of expectedRlsEnabledTables) {
    if (actual.rls_enabled[table] !== true) {
      findings.push(`${table}: RLS is not enabled (expected enabled)`);
    }
  }
  for (const table of Object.keys(actual.rls_enabled)) {
    if (!expectedRlsEnabledTables.includes(table)) {
      findings.push(`${table}: table exists but isn't in EXPECTED_RLS_ENABLED_TABLES — add it to scripts/rlsManifest.mjs`);
    }
  }

  const actualByTable = {};
  for (const p of actual.policies) {
    (actualByTable[p.table] ??= []).push(p);
  }

  const allTables = new Set([...Object.keys(expectedPolicies), ...Object.keys(actualByTable)]);
  for (const table of allTables) {
    const expected = expectedPolicies[table] ?? [];
    const actualPolicies = actualByTable[table] ?? [];

    for (const exp of expected) {
      const match = actualPolicies.find((a) => a.name === exp.name && a.cmd === exp.cmd);
      if (!match) {
        findings.push(`${table}: missing expected policy "${exp.name}" (${exp.cmd})`);
        continue;
      }
      if (!sameRoles(match.roles, exp.roles)) {
        findings.push(`${table}: policy "${exp.name}" has roles [${match.roles}], expected [${exp.roles}]`);
      }
    }

    for (const act of actualPolicies) {
      if (!expected.some((e) => e.name === act.name && e.cmd === act.cmd)) {
        findings.push(`${table}: unexpected policy "${act.name}" (${act.cmd}), roles [${act.roles}] — not in the manifest`);
      }
    }
  }

  for (const [fn, expectedRoles] of Object.entries(expectedSecurityDefinerExecute)) {
    const grants = actual.security_definer_grants[fn];
    if (!grants) {
      findings.push(`${fn}: SECURITY DEFINER function not found (expected to exist)`);
      continue;
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      const shouldHave = expectedRoles.includes(role);
      const has = grants[role];
      if (shouldHave !== has) {
        findings.push(`${fn}: role "${role}" ${has ? "CAN" : "cannot"} execute — expected ${shouldHave ? "able to" : "unable to"}`);
      }
    }
  }
  for (const fn of Object.keys(actual.security_definer_grants)) {
    if (!(fn in expectedSecurityDefinerExecute)) {
      findings.push(`${fn}: SECURITY DEFINER function exists but isn't in EXPECTED_SECURITY_DEFINER_EXECUTE — add it to scripts/rlsManifest.mjs`);
    }
  }

  return findings;
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase.rpc("audit_rls_manifest");
  if (error) throw error;

  const findings = diffManifest(data, {
    expectedRlsEnabledTables: EXPECTED_RLS_ENABLED_TABLES,
    expectedPolicies: EXPECTED_POLICIES,
    expectedSecurityDefinerExecute: EXPECTED_SECURITY_DEFINER_EXECUTE,
  });

  for (const f of findings) console.error(`DRIFT: ${f}`);

  if (findings.length > 0) {
    console.error("\nRLS/privilege manifest check FAILED.");
    console.error("If this drift is intentional, update scripts/rlsManifest.mjs in its own reviewed commit.");
    console.error("If it isn't, someone/something changed production outside migration review — investigate before anything else.");
    process.exit(1);
  }

  console.log("RLS/privilege manifest check passed — production matches scripts/rlsManifest.mjs.");
}

// pathToFileURL normalizes a relative-or-absolute argv[1] into the same
// form as import.meta.url before comparing — a plain `file://${argv[1]}`
// string-build only matches when the script happens to be invoked with an
// absolute path, silently never running main() otherwise (e.g. exactly how
// the workflow invokes it: `node scripts/audit-rls-manifest.mjs`).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
