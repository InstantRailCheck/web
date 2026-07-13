import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCspHeader } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildCspHeader", () => {
  it("generates a fresh nonce on every call", () => {
    const first = buildCspHeader();
    const second = buildCspHeader();
    expect(first.nonce).not.toBe(second.nonce);
  });

  it("includes the nonce in both script-src and style-src", () => {
    const { nonce, value } = buildCspHeader();
    expect(value).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(value).toContain(`style-src 'self' 'nonce-${nonce}'`);
  });

  it("includes every expected directive", () => {
    const { value } = buildCspHeader();
    // Regression guard for ADR-0003's finding: an earlier draft of that ADR
    // omitted img-src/font-src from its documented policy even though
    // they're real, present directives — this test would have caught it.
    for (const directive of [
      "default-src 'self'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://api.instantrailcheck.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]) {
      expect(value).toContain(directive);
    }
  });

  // lib/apiResponse.ts's legacyApiRedirect 308-redirects any /api/* request
  // on www.instantrailcheck.com to api.instantrailcheck.com — including the
  // browser's own same-origin fetch('/api/routes') from HomeRouteChecker.tsx.
  // Without the API subdomain in connect-src, that redirected fetch is
  // blocked by CSP and the route checker hangs forever on "Checking...".
  it("allows connect-src to the API subdomain so the legacy /api/* redirect doesn't get CSP-blocked", () => {
    const { value } = buildCspHeader();
    expect(value).toContain("connect-src 'self' https://*.supabase.co https://api.instantrailcheck.com");
  });

  it("does not include 'unsafe-eval' outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { value } = buildCspHeader();
    expect(value).not.toContain("unsafe-eval");
  });

  it("includes 'unsafe-eval' only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const { value } = buildCspHeader();
    expect(value).toContain("'unsafe-eval'");
  });

  it("returns a single-line header with no newlines or doubled whitespace", () => {
    const { value } = buildCspHeader();
    expect(value).not.toMatch(/\n/);
    expect(value).not.toMatch(/\s{2,}/);
  });
});
