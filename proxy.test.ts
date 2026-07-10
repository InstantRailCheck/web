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
      "connect-src 'self' https://*.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]) {
      expect(value).toContain(directive);
    }
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
