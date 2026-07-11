import { describe, it, expect } from "vitest";
import { diffManifest } from "./audit-rls-manifest.mjs";

const baseExpected = {
  expectedRlsEnabledTables: ["t1", "t2"],
  expectedPolicies: {
    t1: [{ name: "p1", cmd: "SELECT", roles: ["public"] }],
    t2: [],
  },
  expectedSecurityDefinerExecute: {
    fn1: ["service_role"],
  },
};

const baseActual = {
  rls_enabled: { t1: true, t2: true },
  policies: [{ table: "t1", name: "p1", cmd: "SELECT", roles: ["public"] }],
  security_definer_grants: {
    fn1: { anon: false, authenticated: false, service_role: true },
  },
};

describe("diffManifest", () => {
  it("finds no drift when actual matches expected exactly", () => {
    expect(diffManifest(baseActual, baseExpected)).toEqual([]);
  });

  it("flags a table that should have RLS enabled but doesn't", () => {
    const actual = { ...baseActual, rls_enabled: { ...baseActual.rls_enabled, t1: false } };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining("t1: RLS is not enabled"));
  });

  it("flags a table with RLS enabled that isn't in the manifest at all", () => {
    const actual = { ...baseActual, rls_enabled: { ...baseActual.rls_enabled, t3: true } };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining("t3: table exists but isn't in EXPECTED_RLS_ENABLED_TABLES"));
  });

  it("flags a missing expected policy", () => {
    const actual = { ...baseActual, policies: [] };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining('t1: missing expected policy "p1"'));
  });

  it("flags an unexpected extra policy", () => {
    const actual = {
      ...baseActual,
      policies: [...baseActual.policies, { table: "t2", name: "sneaky", cmd: "INSERT", roles: ["authenticated"] }],
    };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining('t2: unexpected policy "sneaky"'));
  });

  it("flags a policy whose roles don't match, in either direction", () => {
    const actual = {
      ...baseActual,
      policies: [{ table: "t1", name: "p1", cmd: "SELECT", roles: ["public", "extra_role"] }],
    };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining('t1: policy "p1" has roles'));
  });

  it("does not flag roles that are just listed in a different order", () => {
    const expected = {
      ...baseExpected,
      expectedPolicies: { ...baseExpected.expectedPolicies, t1: [{ name: "p1", cmd: "SELECT", roles: ["b", "a"] }] },
    };
    const actual = { ...baseActual, policies: [{ table: "t1", name: "p1", cmd: "SELECT", roles: ["a", "b"] }] };
    expect(diffManifest(actual, expected)).toEqual([]);
  });

  it("flags a SECURITY DEFINER function that gained an unexpected role's EXECUTE grant", () => {
    const actual = {
      ...baseActual,
      security_definer_grants: { fn1: { anon: true, authenticated: false, service_role: true } },
    };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining('fn1: role "anon" CAN execute — expected unable to'));
  });

  it("flags a SECURITY DEFINER function that lost an expected role's EXECUTE grant", () => {
    const actual = {
      ...baseActual,
      security_definer_grants: { fn1: { anon: false, authenticated: false, service_role: false } },
    };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining('fn1: role "service_role" cannot execute — expected able to'));
  });

  it("flags a missing SECURITY DEFINER function entirely", () => {
    const actual = { ...baseActual, security_definer_grants: {} };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining("fn1: SECURITY DEFINER function not found"));
  });

  it("flags a SECURITY DEFINER function that exists but isn't in the manifest", () => {
    const actual = {
      ...baseActual,
      security_definer_grants: {
        ...baseActual.security_definer_grants,
        fn2: { anon: false, authenticated: false, service_role: true },
      },
    };
    const findings = diffManifest(actual, baseExpected);
    expect(findings).toContainEqual(expect.stringContaining("fn2: SECURITY DEFINER function exists but isn't in EXPECTED_SECURITY_DEFINER_EXECUTE"));
  });
});
